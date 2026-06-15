/* lib/providers.tsx — app-shell React context providers.
 *
 * Two contexts, composed by <AppProviders>:
 *
 *  1. SessionProvider — the source of truth for "who is signed in and what they
 *     can see". Exposes { session, profile, membership, loading, refresh,
 *     signOut }. On auth state change it (re-)fetches the caller's profile and
 *     their (first) membership via RLS. A user who has authed but never joined a
 *     pool gets membership === null — the routing gate sends them to profile.
 *
 *  2. LangProvider — language state. Pre-auth: auto-detect from the device
 *     (es* → 'es', else 'en'), persisted to AsyncStorage so it survives reloads.
 *     Once a profile exists, profile.lang wins (single source of truth) and any
 *     in-app language change writes through to profiles.lang. Exposes useLang()
 *     and useT() (a memoised makeT(lang) translator).
 *
 * The providers are intentionally decoupled: LangProvider reads the profile via
 * useSession(), so SessionProvider must wrap it (handled in AppProviders).
 */

import type { Session } from '@supabase/supabase-js';
import * as Localization from 'expo-localization';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { makeT, type Translate } from './i18n';
import { registerAppStateAutoRefresh, supabase } from './supabase';
import { clearSnapshots, readSnapshot, writeSnapshot } from './cache';
import type { Lang, Membership, Profile } from './types';

/* ------------------------------------------------------------------ *
 * Session / profile / membership context
 * ------------------------------------------------------------------ */

interface SessionContextValue {
  session: Session | null;
  profile: Profile | null;
  /** First active membership, or null if the user has joined no pool yet. */
  membership: Membership | null;
  /** True until the initial session + (if authed) profile/membership resolve. */
  loading: boolean;
  /** Re-fetch profile + membership for the current session (after join_pool). */
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

/** Fetch the caller's profile row, or null if none exists yet. */
async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, name, emoji, lang')
    .eq('id', userId)
    .maybeSingle();
  if (error) {
    // A user with no profile/membership trips no error here (maybeSingle), but
    // an RLS denial would. Treat any failure as "no profile" — the gate routes
    // them to onboarding rather than crashing.
    return null;
  }
  return (data as Profile | null) ?? null;
}

/** Fetch the caller's first active (non-hidden) membership, or null. */
async function fetchMembership(userId: string): Promise<Membership | null> {
  const { data, error } = await supabase
    .from('memberships')
    .select('pool_id, user_id, role, hidden')
    .eq('user_id', userId)
    .eq('hidden', false)
    .limit(1)
    .maybeSingle();
  if (error) {
    return null;
  }
  return (data as Membership | null) ?? null;
}

/** What SessionProvider persists under the 'session' slot. */
interface SessionSnapshot {
  profile: Profile;
  membership: Membership | null;
}

/** Last-resort guard: force loading=false if the boot sequence never resolves. */
const BOOT_TIMEOUT_MS = 20_000;

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [membership, setMembership] = useState<Membership | null>(null);
  const [loading, setLoading] = useState(true);
  // Bumped only on SIGNED_IN / INITIAL_SESSION so re-login re-fetches even when
  // user.id is unchanged; NOT bumped on TOKEN_REFRESHED (no refetch needed).
  const [authGen, setAuthGen] = useState(0);

  const loadSeq = useRef(0); // guards against a stale async resolve winning
  const resolvedRef = useRef(false); // has loading been resolved legitimately?

  // ── Boot: register the (sync) auth subscription, then seed session from disk.
  useEffect(() => {
    let active = true;

    // Arm the last-resort timeout before any async work.
    const timeoutId = setTimeout(() => {
      if (active && !resolvedRef.current) {
        resolvedRef.current = true;
        setLoading(false);
      }
    }, BOOT_TIMEOUT_MS);

    // SYNC-ONLY callback: no await, no supabase.* calls. Any supabase call here
    // re-acquires the held GoTrue lock and deadlocks the app (spec §2).
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, next) => {
      if (!active) return;
      setSession(next);
      if (next) {
        if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
          setAuthGen((g) => g + 1);
        }
      } else {
        // SIGNED_OUT: clear eagerly and resolve the gate. No clearTimeout here —
        // resolvedRef=true makes the pending boot timeout a no-op when it fires.
        setProfile(null);
        setMembership(null);
        resolvedRef.current = true;
        setLoading(false);
      }
    });

    // Seed session from disk (local, no network, no GoTrue lock held here).
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      if (data.session) {
        setAuthGen((g) => g + 1);
      } else {
        setProfile(null);
        setMembership(null);
        resolvedRef.current = true;
        setLoading(false);
        clearTimeout(timeoutId);
      }
    });

    const unregisterRefresh = registerAppStateAutoRefresh();

    return () => {
      active = false;
      clearTimeout(timeoutId);
      subscription.unsubscribe();
      unregisterRefresh();
    };
  }, []);

  // ── Profile/membership load — runs OUTSIDE the GoTrue lock (the deadlock fix).
  useEffect(() => {
    const userId = session?.user.id;
    if (!userId) return;

    const seq = ++loadSeq.current;
    let active = true;

    (async () => {
      // 1) Cache-first (disk, ~ms): hydrate and resolve the gate immediately.
      const snap = await readSnapshot<SessionSnapshot>(userId, 'session');
      if (!active || seq !== loadSeq.current) return;
      if (snap) {
        setProfile(snap.profile);
        setMembership(snap.membership);
        resolvedRef.current = true;
        setLoading(false);
      }

      // 2) Revalidate over the network (outside the lock).
      const [p, m] = await Promise.all([
        fetchProfile(userId),
        fetchMembership(userId),
      ]);
      if (!active || seq !== loadSeq.current) return;

      // Update on a successful fetch (profile present) or when there was no
      // cache to fall back on. If both came back null AND we already showed a
      // cache snapshot, keep the cached values (likely a transient failure).
      if (p !== null || m !== null || !snap) {
        setProfile(p);
        setMembership(m);
        resolvedRef.current = true;
        setLoading(false);
      }

      // Persist fresh data for the next cold launch (only when a profile exists;
      // a not-yet-onboarded user stays a cache miss so the gate re-checks).
      if (p !== null) {
        writeSnapshot<SessionSnapshot>(userId, 'session', {
          profile: p,
          membership: m,
        });
      }
    })();

    return () => {
      active = false;
    };
  }, [session?.user.id, authGen]);

  const refresh = useCallback(async () => {
    const userId = session?.user.id;
    if (!userId) return;
    const seq = ++loadSeq.current;
    const [p, m] = await Promise.all([
      fetchProfile(userId),
      fetchMembership(userId),
    ]);
    if (seq !== loadSeq.current) return;
    setProfile(p);
    setMembership(m);
    if (p !== null) {
      writeSnapshot<SessionSnapshot>(userId, 'session', {
        profile: p,
        membership: m,
      });
    }
  }, [session?.user.id]);

  const signOut = useCallback(async () => {
    const userId = session?.user.id;
    // ORDERING: clear cache BEFORE signOut so a pending flush can't reinstate it
    // and the next user starts clean.
    await clearSnapshots(userId);
    setProfile(null);
    setMembership(null);
    await supabase.auth.signOut();
  }, [session?.user.id]);

  const value = useMemo<SessionContextValue>(
    () => ({ session, profile, membership, loading, refresh, signOut }),
    [session, profile, membership, loading, refresh, signOut],
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error('useSession must be used within <SessionProvider>');
  }
  return ctx;
}

/* ------------------------------------------------------------------ *
 * Language context
 * ------------------------------------------------------------------ */

const LANG_STORAGE_KEY = 'quiniela.lang';

interface LangContextValue {
  lang: Lang;
  /** Set the active language; persists to AsyncStorage and (if authed) profile. */
  setLang: (lang: Lang) => void;
}

const LangContext = createContext<LangContextValue | null>(null);

/** Auto-detect from device locale: es* → 'es', otherwise 'en'. */
function detectDeviceLang(): Lang {
  const locales = Localization.getLocales();
  const tag = locales?.[0]?.languageCode ?? locales?.[0]?.languageTag ?? 'en';
  return tag.toLowerCase().startsWith('es') ? 'es' : 'en';
}

export function LangProvider({ children }: { children: ReactNode }) {
  const { profile } = useSession();
  const [stored, setStored] = useState<Lang | null>(null);
  const [detected] = useState<Lang>(detectDeviceLang);

  // Hydrate the persisted pre-auth preference once.
  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(LANG_STORAGE_KEY).then((v) => {
      if (active && (v === 'es' || v === 'en')) setStored(v);
    });
    return () => {
      active = false;
    };
  }, []);

  // Profile language wins once a profile exists; else stored; else detected.
  const lang: Lang = profile?.lang ?? stored ?? detected;

  const setLang = useCallback(
    (next: Lang) => {
      setStored(next);
      AsyncStorage.setItem(LANG_STORAGE_KEY, next).catch(() => {});
      // If signed in with a profile, write through so the board reflects it.
      if (profile) {
        supabase
          .from('profiles')
          .update({ lang: next })
          .eq('id', profile.id)
          .then(() => {});
      }
    },
    [profile],
  );

  const value = useMemo<LangContextValue>(() => ({ lang, setLang }), [lang, setLang]);

  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useLang(): LangContextValue {
  const ctx = useContext(LangContext);
  if (!ctx) {
    throw new Error('useLang must be used within <LangProvider>');
  }
  return ctx;
}

/** Memoised translator for the active language. */
export function useT(): Translate {
  const { lang } = useLang();
  return useMemo(() => makeT(lang), [lang]);
}

/* ------------------------------------------------------------------ *
 * Composed provider tree
 * ------------------------------------------------------------------ */

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <LangProvider>{children}</LangProvider>
    </SessionProvider>
  );
}
