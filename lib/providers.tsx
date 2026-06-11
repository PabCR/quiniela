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

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [membership, setMembership] = useState<Membership | null>(null);
  const [loading, setLoading] = useState(true);

  // Guards against a stale async resolve overwriting a newer auth state.
  const loadSeq = useRef(0);

  const loadFor = useCallback(async (next: Session | null) => {
    const seq = ++loadSeq.current;
    if (!next) {
      if (seq === loadSeq.current) {
        setProfile(null);
        setMembership(null);
      }
      return;
    }
    const [p, m] = await Promise.all([
      fetchProfile(next.user.id),
      fetchMembership(next.user.id),
    ]);
    if (seq === loadSeq.current) {
      setProfile(p);
      setMembership(m);
    }
  }, []);

  // Initial session + subscription to auth changes.
  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      setSession(data.session);
      await loadFor(data.session);
      if (active) setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, next) => {
      if (!active) return;
      setSession(next);
      await loadFor(next);
      if (active) setLoading(false);
    });

    const unregisterRefresh = registerAppStateAutoRefresh();

    return () => {
      active = false;
      subscription.unsubscribe();
      unregisterRefresh();
    };
  }, [loadFor]);

  const refresh = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    setSession(data.session);
    await loadFor(data.session);
  }, [loadFor]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    // onAuthStateChange clears state, but clear eagerly for snappy UI.
    setProfile(null);
    setMembership(null);
  }, []);

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
