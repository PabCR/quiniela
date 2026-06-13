/* lib/data.tsx — the pool data layer (no react-query; plain context + hooks).
 *
 * One PoolDataProvider mounted at the root layout (app/_layout.tsx), wrapping
 * the whole Stack above the auth gate, loads everything the Matches list + Match
 * detail need, keyed to the signed-in user's first active membership (pool):
 *
 *   teams     TeamsMap            — reference data (code → Team)
 *   pool      Pool                — the caller's pool (pts config, scoring_locked)
 *   games     Game[]              — all games of the pool's tournament
 *   members   PoolMember[]        — active memberships joined to profiles
 *   myGuesses Record<gameId,Guess>— the caller's own picks (always visible)
 *   guessesByGame                 — everyone's guesses the caller may see
 *                                   (RLS reveals others' rows only post-kickoff)
 *
 * Exposed hooks:
 *   useTeams() usePool() useGames() useMembers() useMyGuesses()
 *   useGuessesForGame(gameId)  — picks for one game (RLS-gated reveal)
 *   useWhoPicked(gameId)       — uuids of pickers pre-lock via who_picked RPC
 *   usePendingGames()          — engine.pendingMatches over my guesses
 *   usePoolData()              — the whole context (loading, refetch, applyMyGuess)
 *
 * Realtime: a single supabase channel subscribes to postgres_changes on `games`
 * and `guesses`; payloads patch local state in place (brief §9). As a fallback
 * we refetch on app foreground (AppState) — useFocusEffect-based refetch is
 * wired per-screen where it matters. RLS still applies to realtime, so a member
 * only receives rows they may see.
 */

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
import { AppState, type AppStateStatus } from 'react-native';

import { useSession } from './providers';
import { supabase } from './supabase';
import { readSnapshot, removeSnapshot, writeSnapshot } from './cache';
import { pendingMatches, type PicksByGame } from './engine';
import { useNow } from './now';
import type {
  Game,
  Guess,
  Pool,
  Profile,
  TeamCode,
  TeamsMap,
} from './types';

/* ------------------------------------------------------------------ *
 * Shapes
 * ------------------------------------------------------------------ */

/** An active membership joined to its profile — what the roster/table render. */
export interface PoolMember {
  user_id: string;
  role: 'admin' | 'player';
  hidden: boolean;
  name: string;
  emoji: string | null;
}

/** Guesses keyed by game id (one member's worth). */
export type GuessesByGame = Record<number, Guess>;

/** Everyone's visible guesses: gameId → (userId → Guess). */
export type AllGuesses = Record<number, Record<string, Guess>>;

interface PoolDataValue {
  loading: boolean;
  error: string | null;

  teams: TeamsMap;
  pool: Pool | null;
  games: Game[];
  members: PoolMember[];
  /** Caller's own picks, keyed by game id. */
  myGuesses: GuessesByGame;
  /** Everyone's visible picks: gameId → userId → Guess (RLS-gated). */
  guessesByGame: AllGuesses;

  /** Force a full reload of every collection. */
  refetch: () => Promise<void>;
  /**
   * Optimistically merge the caller's own guess for a game into local state
   * (used by the match-detail autosave so the UI reflects the pick instantly
   * before the round-trip + realtime echo). Pass null to remove (retract).
   */
  applyMyGuess: (gameId: number, guess: Guess | null) => void;
}

/** Everything PoolDataProvider persists under the `pool-<poolId>` slot. */
interface PoolCachePayload {
  teams: TeamsMap;
  pool: Pool;
  games: Game[];
  members: PoolMember[];
  allGuesses: Guess[];
  tournamentId: number;
}

const PoolDataContext = createContext<PoolDataValue | null>(null);

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function indexTeams(rows: { code: TeamCode; name_en: string; name_es: string; flag: string }[]): TeamsMap {
  const map: TeamsMap = {};
  for (const r of rows) map[r.code] = r;
  return map;
}

function indexMyGuesses(rows: Guess[], myId: string): GuessesByGame {
  const out: GuessesByGame = {};
  for (const g of rows) {
    if (g.user_id === myId) out[g.game_id] = g;
  }
  return out;
}

function indexAllGuesses(rows: Guess[]): AllGuesses {
  const out: AllGuesses = {};
  for (const g of rows) {
    (out[g.game_id] ??= {})[g.user_id] = g;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Provider
 * ------------------------------------------------------------------ */

export function PoolDataProvider({ children }: { children: ReactNode }) {
  const { session, membership } = useSession();
  const myId = session?.user.id ?? null;
  const poolId = membership?.pool_id ?? null;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [teams, setTeams] = useState<TeamsMap>({});
  const [pool, setPool] = useState<Pool | null>(null);
  const [games, setGames] = useState<Game[]>([]);
  const [members, setMembers] = useState<PoolMember[]>([]);
  const [allGuesses, setAllGuesses] = useState<Guess[]>([]);

  // Guards against a stale async resolve overwriting newer state.
  const loadSeq = useRef(0);
  // The loaded pool's tournament id — used to scope realtime game patches (the
  // games SELECT policy is member-gated, not tournament-gated, so a realtime
  // game event could be for another tournament in a multi-tournament DB).
  const tournamentIdRef = useRef<number | null>(null);
  // Detects a pool switch so we can drop the previous pool's cached slot.
  const prevPoolIdRef = useRef<number | null>(null);
  // Mirrors current state for the realtime debounced cache flush.
  const latestSnapshotRef = useRef<{
    poolId: number | null;
    payload: PoolCachePayload | null;
  }>({ poolId: null, payload: null });
  // Trailing-debounce handle for realtime-driven cache writes.
  const cacheFlushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      const silent = opts?.silent ?? false;
      if (!myId || !poolId) {
        setLoading(false);
        return;
      }
      // Non-silent (cache miss / first run / pull-to-refresh) shows the spinner;
      // silent background revalidation leaves on-screen data untouched. Without
      // this, the context's `refetch: load` (pull-to-refresh) shows no spinner
      // and the load-timeout effect never arms.
      if (!silent) setLoading(true);
      const seq = ++loadSeq.current;
      if (!silent) setError(null);

      // The pool row first — we need its tournament_id to scope games.
      const poolRes = await supabase
        .from('pools')
        .select(
          'id, tournament_id, name, invite_code, pts_full, pts_partial, scoring_locked, created_by',
        )
        .eq('id', poolId)
        .maybeSingle();

      if (poolRes.error || !poolRes.data) {
        if (seq === loadSeq.current) {
          if (!silent) setError(poolRes.error?.message ?? 'Pool not found');
          setLoading(false);
        }
        return;
      }
      const poolRow = poolRes.data as Pool;
      const tournamentId = poolRow.tournament_id;
      tournamentIdRef.current = tournamentId;

      const [teamsRes, gamesRes, membersRes, guessesRes] = await Promise.all([
        supabase.from('teams').select('code, name_en, name_es, flag'),
        supabase
          .from('games')
          .select(
            'id, tournament_id, external_id, stage, home, away, kickoff, location, score_home, score_away, advancer, result_status, confirmed_at, voided, postponed, corrected, updated_at',
          )
          .eq('tournament_id', tournamentId)
          .order('kickoff', { ascending: true }),
        supabase
          .from('memberships')
          .select('user_id, role, hidden, profiles!inner(name, emoji)')
          .eq('pool_id', poolId)
          .eq('hidden', false),
        supabase
          .from('guesses')
          .select(
            'pool_id, user_id, game_id, home, away, advancer, points, tag, updated_at',
          )
          .eq('pool_id', poolId),
      ]);

      if (seq !== loadSeq.current) return;

      const firstErr =
        teamsRes.error || gamesRes.error || membersRes.error || guessesRes.error;
      // On failure we leave on-screen/cached data untouched (no setState here) —
      // a silent revalidation that fails keeps what the cache hydrated. Mirrors
      // SessionProvider's keep-cache-on-transient-failure.
      if (firstErr) {
        if (!silent) setError(firstErr.message);
        setLoading(false);
        return;
      }

      const teamsMap = indexTeams((teamsRes.data ?? []) as never);
      const gamesData = (gamesRes.data ?? []) as Game[];
      const membersData = (
        (membersRes.data ?? []) as Array<{
          user_id: string;
          role: 'admin' | 'player';
          hidden: boolean;
          profiles:
            | Pick<Profile, 'name' | 'emoji'>
            | Pick<Profile, 'name' | 'emoji'>[];
        }>
      ).map((m) => {
        const prof = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
        return {
          user_id: m.user_id,
          role: m.role,
          hidden: m.hidden,
          name: prof?.name ?? '',
          emoji: prof?.emoji ?? null,
        };
      });
      const guessesData = (guessesRes.data ?? []) as Guess[];

      // Clear any stale error unconditionally — covers a silent revalidation
      // that succeeds after a previous non-silent failure left an error banner.
      setError(null);
      setPool(poolRow);
      setTeams(teamsMap);
      setGames(gamesData);
      setMembers(membersData);
      setAllGuesses(guessesData);
      setLoading(false);

      // Persist the fresh snapshot for the next cold launch.
      writeSnapshot<PoolCachePayload>(myId, `pool-${poolId}`, {
        teams: teamsMap,
        pool: poolRow,
        games: gamesData,
        members: membersData,
        allGuesses: guessesData,
        tournamentId,
      });
    },
    [myId, poolId],
  );

  // Hydrate from cache (instant), then revalidate. Keyed on [poolId] (see below).
  useEffect(() => {
    if (!poolId) {
      // Abandon any in-flight load() started for the previous pool: bump loadSeq
      // so a silent revalidation that resolves AFTER sign-out / pool-exit fails
      // its `seq === loadSeq.current` guard and cannot re-write (resurrect) that
      // pool's cache slot. (SessionProvider.signOut already cleared it.)
      loadSeq.current += 1;
      if (prevPoolIdRef.current !== null && myId) {
        removeSnapshot(myId, `pool-${prevPoolIdRef.current}`);
      }
      prevPoolIdRef.current = null;
      setLoading(false);
      setError(null);
      setPool(null);
      setGames([]);
      setMembers([]);
      setAllGuesses([]);
      setTeams({});
      return;
    }

    // Pool switch: drop the previous pool's snapshot (storage hygiene only).
    if (
      prevPoolIdRef.current !== null &&
      prevPoolIdRef.current !== poolId &&
      myId
    ) {
      removeSnapshot(myId, `pool-${prevPoolIdRef.current}`);
    }
    prevPoolIdRef.current = poolId;

    let cancelled = false;
    (async () => {
      setLoading(true);
      const cached = myId
        ? await readSnapshot<PoolCachePayload>(myId, `pool-${poolId}`)
        : null;
      if (cancelled) return;

      if (cached) {
        setError(null);
        setTeams(cached.teams);
        setPool(cached.pool);
        setGames(cached.games);
        setMembers(cached.members);
        setAllGuesses(cached.allGuesses);
        tournamentIdRef.current = cached.tournamentId;
        setLoading(false);
        load({ silent: true }); // silent background revalidation
      } else {
        load({ silent: false }); // normal spinner path
      }
    })();

    return () => {
      cancelled = true;
    };
    // Keyed on [poolId] only (spec §6.3). myId is intentionally excluded: it is
    // always set whenever poolId is set, and any user switch cycles poolId
    // through null, so this effect re-runs and re-captures the current myId.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poolId]);

  // Mirror state into latestSnapshotRef for the realtime debounced flush.
  useEffect(() => {
    if (!pool || tournamentIdRef.current == null) {
      latestSnapshotRef.current = { poolId, payload: null };
      return;
    }
    latestSnapshotRef.current = {
      poolId,
      payload: {
        teams,
        pool,
        games,
        members,
        allGuesses,
        tournamentId: tournamentIdRef.current,
      },
    };
  }, [poolId, pool, teams, games, members, allGuesses]);

  // myId via a ref so scheduleCacheFlush stays reference-stable (empty deps) and
  // does NOT churn the realtime channel subscription when myId changes.
  const myIdRef = useRef(myId);
  useEffect(() => {
    myIdRef.current = myId;
  }, [myId]);

  // Debounced cache write driven by realtime patches (2 s trailing). load()
  // writes the cache directly on its own success; this covers in-place patches.
  const scheduleCacheFlush = useCallback(() => {
    if (cacheFlushTimer.current) clearTimeout(cacheFlushTimer.current);
    cacheFlushTimer.current = setTimeout(() => {
      const { poolId: pid, payload } = latestSnapshotRef.current;
      const uid = myIdRef.current;
      // Don't resurrect a slot for a pool we've already switched away from — a
      // late realtime callback can re-arm this timer after the switch cleanup.
      if (pid && payload && uid && pid === prevPoolIdRef.current) {
        writeSnapshot<PoolCachePayload>(uid, `pool-${pid}`, payload);
      }
    }, 2_000);
  }, []);

  /* ---- realtime: patch games + guesses in place ---- */
  useEffect(() => {
    if (!poolId) return;

    const upsertGame = (row: Game) => {
      setGames((prev) => {
        if (
          tournamentIdRef.current != null &&
          row.tournament_id !== tournamentIdRef.current
        ) {
          return prev;
        }
        const i = prev.findIndex((g) => g.id === row.id);
        if (i === -1)
          return [...prev, row].sort(
            (a, b) => +new Date(a.kickoff) - +new Date(b.kickoff),
          );
        const next = prev.slice();
        next[i] = { ...next[i], ...row };
        return next;
      });
      scheduleCacheFlush();
    };

    const upsertGuess = (row: Guess) => {
      setAllGuesses((prev) => {
        const i = prev.findIndex(
          (g) =>
            g.game_id === row.game_id &&
            g.user_id === row.user_id &&
            g.pool_id === row.pool_id,
        );
        if (i === -1) return [...prev, row];
        const next = prev.slice();
        next[i] = { ...next[i], ...row };
        return next;
      });
      scheduleCacheFlush();
    };

    const removeGuess = (row: Partial<Guess>) => {
      setAllGuesses((prev) =>
        prev.filter(
          (g) =>
            !(
              g.game_id === row.game_id &&
              g.user_id === row.user_id &&
              g.pool_id === row.pool_id
            ),
        ),
      );
      scheduleCacheFlush();
    };

    const channel = supabase
      .channel(`pool-${poolId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'games' },
        (payload) => {
          if (payload.eventType === 'DELETE') return;
          upsertGame(payload.new as Game);
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'guesses', filter: `pool_id=eq.${poolId}` },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            removeGuess(payload.old as Partial<Guess>);
          } else {
            upsertGuess(payload.new as Guess);
          }
        },
      )
      .subscribe();

    return () => {
      if (cacheFlushTimer.current) clearTimeout(cacheFlushTimer.current);
      supabase.removeChannel(channel);
    };
    // scheduleCacheFlush is reference-stable (useCallback([]) + myIdRef), so the
    // channel re-subscribes only when poolId changes — no myId-driven churn.
  }, [poolId, scheduleCacheFlush]);

  /* ---- fallback: refetch on app foreground (silent — data already on screen) ---- */
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') load({ silent: true });
    });
    return () => sub.remove();
  }, [load]);

  /* ---- defense-in-depth: never let the spinner wedge ---- */
  useEffect(() => {
    if (!loading) return;
    const t = setTimeout(() => {
      loadSeq.current += 1; // abandon any in-flight load() so it can't overwrite
      setLoading(false);
      setError('Load timeout. Pull down to retry.');
    }, 10_000);
    return () => clearTimeout(t);
  }, [loading]);

  /* ---- optimistic own-guess merge for the autosave path ---- */
  const applyMyGuess = useCallback(
    (gameId: number, guess: Guess | null) => {
      if (!myId || !poolId) return;
      setAllGuesses((prev) => {
        const without = prev.filter(
          (g) => !(g.game_id === gameId && g.user_id === myId && g.pool_id === poolId),
        );
        return guess ? [...without, guess] : without;
      });
    },
    [myId, poolId],
  );

  const myGuesses = useMemo(
    () => (myId ? indexMyGuesses(allGuesses, myId) : {}),
    [allGuesses, myId],
  );
  const guessesByGame = useMemo(() => indexAllGuesses(allGuesses), [allGuesses]);

  const value = useMemo<PoolDataValue>(
    () => ({
      loading,
      error,
      teams,
      pool,
      games,
      members,
      myGuesses,
      guessesByGame,
      refetch: load,
      applyMyGuess,
    }),
    [loading, error, teams, pool, games, members, myGuesses, guessesByGame, load, applyMyGuess],
  );

  return <PoolDataContext.Provider value={value}>{children}</PoolDataContext.Provider>;
}

/* ------------------------------------------------------------------ *
 * Hooks
 * ------------------------------------------------------------------ */

export function usePoolData(): PoolDataValue {
  const ctx = useContext(PoolDataContext);
  if (!ctx) throw new Error('usePoolData must be used within <PoolDataProvider>');
  return ctx;
}

export function useTeams(): TeamsMap {
  return usePoolData().teams;
}

export function usePool(): Pool | null {
  return usePoolData().pool;
}

export function useGames(): Game[] {
  return usePoolData().games;
}

export function useMembers(): PoolMember[] {
  return usePoolData().members;
}

export function useMyGuesses(): GuessesByGame {
  return usePoolData().myGuesses;
}

/** Find a single game by id (string or number from route params). */
export function useGame(gameId: number | string | undefined): Game | undefined {
  const games = useGames();
  const id = typeof gameId === 'string' ? Number(gameId) : gameId;
  return useMemo(() => games.find((g) => g.id === id), [games, id]);
}

/**
 * Everyone's visible picks for one game: userId → Guess.
 * RLS reveals others' rows only post-kickoff; before that this contains only
 * the caller's own guess. Realtime flips the reveal in place at kickoff.
 */
export function useGuessesForGame(gameId: number | undefined): Record<string, Guess> {
  const { guessesByGame } = usePoolData();
  return useMemo(
    () => (gameId == null ? {} : guessesByGame[gameId] ?? {}),
    [guessesByGame, gameId],
  );
}

/**
 * The set of user ids that have a COMPLETE pick for a game, via the who_picked
 * RPC (brief: pre-lock social row — who, never what). Refetches when the game
 * id changes and exposes a manual refetch for optimistic local updates.
 */
export function useWhoPicked(gameId: number | undefined): {
  pickers: string[];
  loading: boolean;
  refetch: () => void;
} {
  const [pickers, setPickers] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);

  const refetch = useCallback(() => {
    if (gameId == null) {
      setPickers([]);
      setLoading(false);
      return;
    }
    const s = ++seq.current;
    setLoading(true);
    supabase
      .rpc('who_picked', { p_game_id: gameId })
      .then(({ data, error }) => {
        if (s !== seq.current) return;
        if (error) {
          setPickers([]);
        } else {
          // RPC returns setof uuid → supabase-js shapes it as [{ who_picked: uuid }]
          // or [uuid] depending on version; normalise both.
          const rows = (data ?? []) as Array<string | { who_picked: string }>;
          setPickers(rows.map((r) => (typeof r === 'string' ? r : r.who_picked)));
        }
        setLoading(false);
      });
  }, [gameId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { pickers, loading, refetch };
}

/**
 * Games still open for the signed-in user to pick (engine.pendingMatches over
 * my guesses, against a ticking `now`). A KO draw without an advancer counts as
 * pending. Drives the Matches header pill + tab badge dot.
 */
export function usePendingGames(): Game[] {
  const { session } = useSession();
  const games = useGames();
  const myGuesses = useMyGuesses();
  const now = useNow();

  return useMemo(() => {
    const myId = session?.user.id;
    if (!myId) return [];
    // pendingMatches reads picks from an AllPicks map; build a single-member map
    // from my own guesses (it only ever looks up `myId`).
    const overrides: PicksByGame = {};
    for (const [gid, g] of Object.entries(myGuesses)) {
      overrides[Number(gid)] = { home: g.home, away: g.away, advancer: g.advancer };
    }
    return pendingMatches(myId, games, {}, now, overrides);
  }, [session, games, myGuesses, now]);
}
