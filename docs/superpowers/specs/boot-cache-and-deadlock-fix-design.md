# Cache-First Boot + Deadlock Fix: Complete Design Spec

## 1. Problem Statement and Goals

The Quiniela app exhibits a "cold-launch spinner forever" bug on any device that has a persisted Supabase session. The root cause is a GoTrue internal advisory lock deadlock triggered by the current `SessionProvider` implementation. Additionally, even when the deadlock is absent, the app has no disk persistence for profile, membership, or pool data — meaning every cold launch blocks on the network before rendering any content.

This specification defines:
1. A structural fix that eliminates the deadlock permanently by moving all `supabase.*` calls out of the `onAuthStateChange` callback.
2. A cache-first boot strategy that persists the last-known profile, membership, and pool data to AsyncStorage so the routing gate and tabs can render from local disk (milliseconds, no network) on subsequent launches, with silent background revalidation replacing stale data in place.

**Goals:** No spinner-forever regression. Perceptually instant boot on returning users. Silent revalidation with no loading banner. Realtime keeps data live once open. Multi-user hygiene: user B never sees user A's data. A shared, well-tested persistence primitive consumed by both providers.

**Non-goals (explicitly deferred):** OS background refresh while the app is closed. Offline writes. Any external state management library.

---

## 2. Root Cause: The supabase-js onAuthStateChange Deadlock

supabase-js acquires a non-reentrant `navigator.locks` advisory lock inside its GoTrue client whenever it processes an auth event. **This lock is still held when `onAuthStateChange` fires the user-supplied callback.** Any subsequent call to `supabase.*` from inside that callback — including `supabase.from('profiles')` — attempts to re-acquire the same lock and blocks forever. There is no timeout on the lock acquisition.

The Supabase documentation states: *"There is currently a bug in supabase-js which results in a deadlock if any async API call is made in onAuthStateChange code. If a call is made in the handler then the next Supabase call anywhere using that client will hang and not return."* (Confirmed via supabase/supabase-js#2013 and supabase/auth-js#762.)

The current code at `lib/providers.tsx:129–134`:

```ts
supabase.auth.onAuthStateChange(async (_event, next) => {
  if (!active) return;
  setSession(next);
  await loadFor(next);   // fetchProfile + fetchMembership hit the lock → deadlock
  if (active) setLoading(false);
});
```

On cold launch with a persisted session, `INITIAL_SESSION` fires with `next = <stored session>`. The callback calls `loadFor`, which calls `supabase.from('profiles').maybeSingle()`. That call waits for the GoTrue lock — which is held. Neither call ever returns. `setLoading(false)` is never reached. Spinner forever.

The no-session branch (`!next`) returns before any `supabase.from` call, which is why `/auth/invite` never hangs. `getSession().then()` at line 120 also eventually deadlocks because once the callback hangs, the entire client's internal lock queue is stuck.

**The fix:** The `onAuthStateChange` callback must become a purely synchronous function containing zero `supabase.*` calls. All profile/membership fetching moves to a separate `useEffect` keyed on `session?.user.id` that runs after React commits, entirely outside the GoTrue lock.

---

## 3. Architecture Overview

### Three-Layer Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  app/index.tsx (routing gate — unchanged)                       │
│  Reads: { session, membership, loading } from useSession()      │
│  loading → spinner | !session → /auth/invite                    │
│  membership → /(tabs) | else → /auth/profile                   │
└─────────────────────────────────────────────────────────────────┘
          ↑                              ↑
┌─────────────────────┐   ┌────────────────────────────────────┐
│  SessionProvider     │   │  PoolDataProvider                  │
│  lib/providers.tsx   │   │  lib/data.tsx                      │
│                      │   │                                    │
│  Effect 1 (boot):    │   │  Effect 1 (hydrate):               │
│  subscribe → getSession  │  cacheRead(pool-<id>) → setState   │
│  → readSnapshot →    │   │  → setLoading(false)               │
│    setLoading(false) │   │  → load() in background            │
│  Effect 2 (revalidate):  │                                    │
│  keyed on user.id    │   │  load() writes cache after success │
│  → fetchProfile +    │   │  Realtime debounced flush (2 s)     │
│    fetchMembership   │   │                                    │
│  → writeSnapshot     │   │                                    │
└─────────────────────┘   └────────────────────────────────────┘
          ↑                              ↑
┌─────────────────────────────────────────────────────────────────┐
│  lib/cache.ts  (shared primitive — no React imports)            │
│                                                                 │
│  readSnapshot<T>(userId, slot)  → Promise<T | null>            │
│  writeSnapshot<T>(userId, slot, data) → void (debounced 300ms) │
│  clearSnapshots(userId)         → Promise<void>                 │
│                                                                 │
│  Key format: quiniela.cache.<userId>.<CACHE_VERSION>.<slot>    │
│  Envelope:   { v: CACHE_VERSION, uid: userId, ts: number,      │
│               data: T }                                         │
└─────────────────────────────────────────────────────────────────┘
          ↑
  @react-native-async-storage/async-storage (already a dep)
```

### Boot Sequence (Warm Launch — Cache Hit)

```
Cold launch, returning user:
  ~0 ms   SessionProvider mounts; loading = true
  ~0 ms   register onAuthStateChange (sync callback: setSession only)
  ~1 ms   getSession() resolves (disk, no network) → setSession(s)
  ~2 ms   readSnapshot(userId, 'session') → { profile, membership }
  ~2 ms   setProfile, setMembership, setLoading(false)
          → gate routes to /(tabs) OR /auth/profile instantly
  ~5 ms   PoolDataProvider's Effect 1: cacheRead(pool-<id>) → setState
          setLoading(false) → tabs render from disk
  ~500ms  Background: fetchProfile + fetchMembership + load() resolve
          State updates silently in place. Cache overwritten with fresh data.
```

**The "instant" qualifier is precise:** AsyncStorage is async (local flash I/O, ~1–10 ms). The first frame still shows a loading state. The loading state resolves after the local read — milliseconds rather than a network round-trip or indefinitely under the deadlock. There is no synchronous first-frame render from cache.

---

## 4. lib/cache.ts — Shared Persistence Primitive

### 4.1 Async-Read Reality

`readSnapshot` is `async`. It always costs at least one microtask tick plus local I/O (~1–10 ms). The perceptual benefit over the current broken code is: spinner duration shrinks from network latency + GoTrue deadlock (infinite) to local flash I/O (single-digit milliseconds). **`loading` starts `true` and flips to `false` after the local read resolves** — not on the first render frame. The module's JSDoc must state this explicitly.

### 4.2 Cache Version

```ts
export const CACHE_VERSION = 1;
```

An integer bumped manually whenever a persisted shape changes in a backward-incompatible way. The version is embedded in both the storage key and the envelope as independent defense layers. Adding a new nullable field is safe (no bump). Removing or renaming a field, or changing a field's type, requires a bump.

**Orphaned-version cleanup:** When `CACHE_VERSION` is bumped (e.g., 1 → 2), old `v1` keys become invisible to new code and are orphaned. `clearSnapshots` is designed to sweep all versions for a given user on sign-out (see §4.5), so they are cleaned up naturally. A background sweep of orphaned keys from other versions is deferred as a future improvement.

### 4.3 Key Namespacing

```ts
// Key format: quiniela.cache.<userId>.<CACHE_VERSION>.<slot>
// userId appears BEFORE version so clearSnapshots can build a
// version-agnostic prefix for sweeping orphaned old-version keys.
function cacheKey(userId: string, slot: string): string {
  return `quiniela.cache.${userId}.${CACHE_VERSION}.${slot}`;
}
```

**Slot conventions used by consumers:**
- `SessionProvider`: slot `"session"` → stores `{ profile, membership }`.
- `PoolDataProvider`: slot `"pool-<poolId>"` → stores full pool snapshot.

The `quiniela.cache.` prefix is distinct from all existing keys: `quiniela.lang` (LangProvider), `sb-<host>-auth-token` (supabase-js), and the LargeSecureStore encrypted blobs. No collision risk.

### 4.4 On-Disk Envelope

```ts
export interface CacheEnvelope<T> {
  v: number;      // schema version (== CACHE_VERSION at write time)
  uid: string;    // userId that owns this entry (redundant safety check)
  ts: number;     // Date.now() at write time — used for MAX_CACHE_AGE check
  data: T;
}
```

The `ts` field enables the `MAX_CACHE_AGE_MS` staleness threshold (see §4.5). All timestamp columns in `lib/types.ts` (`kickoff`, `updated_at`, `confirmed_at`) are already ISO-8601 strings as returned by supabase-js — `JSON.parse` round-trips them faithfully with no custom reviver needed. No `Date` objects appear in any cached type.

### 4.5 Public API

```ts
/**
 * Read a cached snapshot for the given user and slot.
 *
 * Returns the stored data if found, version-matched, uid-matched, and within
 * MAX_CACHE_AGE_MS. Returns null on any failure (miss, parse error, version
 * mismatch, uid mismatch, expired).
 *
 * IMPORTANT: This is async. The first frame still renders in a loading state;
 * the loading state resolves after local I/O completes (~ms), not after a
 * network round-trip. There is NO synchronous first-frame render from cache.
 */
export async function readSnapshot<T>(
  userId: string,
  slot: string,
): Promise<T | null>
```

```ts
/**
 * Persist a snapshot for the given user and slot.
 *
 * Writes are throttled per (userId, slot) key using a LEADING-EDGE + TRAILING
 * pattern: the first call in a quiet window persists IMMEDIATELY (leading edge),
 * opening a WRITE_THROTTLE_MS window; any further calls within that window are
 * coalesced into a single trailing write that fires at the window's end with the
 * latest value. Because every window leads with an immediate write, worst-case
 * staleness is bounded by WRITE_THROTTLE_MS — no separate max-interval cap is
 * needed, and a burst can never starve the disk write.
 *
 * Returns void (fire-and-forget). Errors are swallowed — a failed write is not
 * fatal; the next successful network fetch overwrites stale data.
 */
export function writeSnapshot<T>(
  userId: string,
  slot: string,
  data: T,
): void
```

```ts
/**
 * Remove a SINGLE (userId, slot) snapshot key for the CURRENT CACHE_VERSION.
 *
 * Single-key sibling of clearSnapshots — used for pool-switch hygiene where we
 * want to drop only the previous pool's slot, not the user's whole cache. Also
 * cancels any pending debounced write for that exact key. Fire-and-forget;
 * errors are swallowed.
 */
export function removeSnapshot(userId: string, slot: string): void
```

```ts
/**
 * Clear ALL cache keys for the given userId across ALL cache versions.
 *
 * MUST be called (and awaited) BEFORE supabase.auth.signOut() so user B never
 * reads user A's data. Also cancels any pending debounced writes to prevent a
 * post-signout flush from reinstating cleared data.
 *
 * Guards against undefined userId (no-op when userId is falsy).
 */
export async function clearSnapshots(userId: string | undefined): Promise<void>
```

### 4.6 Write Coalescing: Leading-Edge + Trailing Throttle

Realtime `postgres_changes` events arrive in bursts (all members submitting picks at kickoff). A trailing-edge-only debounce can be starved if events arrive faster than the debounce window. A leading-edge + trailing throttle avoids that *and* persists the first write of any window immediately:

```ts
const WRITE_THROTTLE_MS = 300;
const MAX_CACHE_AGE_MS = 7 * 24 * 60 * 60 * 1_000; // 7 days

interface PendingWrite {
  trailingHandle: ReturnType<typeof setTimeout> | null;
  windowEnd: number;                 // Date.now() + WRITE_THROTTLE_MS at the leading write
  latest: CacheEnvelope<unknown> | null; // newest data awaiting the trailing flush
}
const pendingWrites = new Map<string, PendingWrite>();
```

On each `writeSnapshot` call, build the envelope, then:
1. **No window open, or `Date.now() >= windowEnd`:** persist immediately (leading edge); open a fresh window `{ trailingHandle: null, windowEnd: now + WRITE_THROTTLE_MS, latest: null }`.
2. **Within the open window:** store the envelope as `latest`; if no trailing timer is armed, arm one to fire at `windowEnd`. When it fires, persist `latest` and open a fresh window so a following burst leads again.

Because every window begins with an immediate write, worst-case staleness is `WRITE_THROTTLE_MS` (≈300 ms) with no separate max-interval constant. The persist helper swallows both `JSON.stringify` and I/O errors:

```ts
function persist(key: string, envelope: CacheEnvelope<unknown>): void {
  // Fire-and-forget. try/catch guards JSON.stringify; .catch guards I/O.
  try {
    AsyncStorage.setItem(key, JSON.stringify(envelope)).catch(() => {});
  } catch {
    // Non-fatal. Next successful fetch overwrites stale data.
  }
}
```

### 4.7 clearSnapshots: Version-Agnostic Sweep

The sweep prefix is `quiniela.cache.<userId>.` (omitting the version segment) so it catches keys from all historical `CACHE_VERSION` values:

```ts
export async function clearSnapshots(userId: string | undefined): Promise<void> {
  if (!userId) return;

  const prefix = `quiniela.cache.${userId}.`;

  // 1. Cancel any pending debounced writes for this user.
  for (const [key, pending] of pendingWrites) {
    if (key.startsWith(prefix)) {
      clearTimeout(pending.trailingHandle);
      pendingWrites.delete(key);
    }
  }
  // Note: deleting from a Map during for...of is safe per spec — entries
  // deleted before being visited are skipped, already-visited are unaffected.

  // 2. Remove all matching keys from AsyncStorage.
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const userKeys = allKeys.filter((k) => k.startsWith(prefix));
    if (userKeys.length > 0) {
      await AsyncStorage.multiRemove(userKeys);
    }
  } catch {
    // Swallow. Worst case: stale key remains until next sign-out or version bump.
  }
}
```

The key order `quiniela.cache.<userId>.<version>.<slot>` places `userId` at segment index 2 (0-indexed, splitting on `.`), making the `startsWith` prefix unambiguous and version-agnostic.

### 4.8 Staleness Guard (MAX_CACHE_AGE_MS)

`readSnapshot` rejects entries where `Date.now() - envelope.ts > MAX_CACHE_AGE_MS` (7 days), returning `null` and forcing a network fetch. This prevents a user who has not opened the app in a week from acting on significantly stale schedule data (postponed games, changed kickoff times) when background revalidation fails silently due to offline conditions.

---

## 5. SessionProvider Rewrite

### 5.1 Invariant

**The `onAuthStateChange` callback MUST be a synchronous function containing zero `supabase.*` calls.** This is the structural fix for the GoTrue deadlock.

### 5.2 Constants (module scope in lib/providers.tsx)

```ts
/** Maximum ms to wait before forcing loading=false. Last-resort regression guard. */
const BOOT_TIMEOUT_MS = 20_000;
```

20 seconds is chosen deliberately: it is a last-resort guard against a genuine hang or total connectivity loss, not a slow-network fallback. Under normal cache-first operation, `loading` flips to `false` from the local cache read well before this fires. At 8 seconds, a slow-but-real network response on a 2G connection could cause the timeout to fire first, routing the user to `/auth/profile` and then flashing them to `/(tabs)` when the fetch resolves — an observable regression. At 20 seconds, only a genuine deadlock or total connectivity loss triggers the fallback.

### 5.3 Three Reactive Surfaces

```
Surface A — onAuthStateChange callback
  Input:  (_event, next: Session | null)
  Does:   setSession(next); if (!next) clear profile/membership/loading eagerly
  May NOT: call supabase.*, await anything, or read loadSeq

Surface B — useEffect keyed on [session?.user.id, authGen]
  Input:  session?.user.id changes OR authGen increments
  Does:   readSnapshot → setProfile/setMembership/setLoading(false)
          then fetchProfile + fetchMembership (outside GoTrue lock)
          → writeSnapshot on success; preserve cache state on transient errors
  Runs:   after React commits, outside the GoTrue lock

Surface C — boot useEffect (deps=[])
  Input:  mounts once
  Does:   register onAuthStateChange subscription (Surface A) FIRST,
          then call getSession().then(setSession) to seed session state
          Arms timeout fallback and registers AppState auto-refresh
          Cleanup: clear timeout, unsubscribe, unregister refresh
```

**Subscription-before-getSession ordering:** The `onAuthStateChange` subscription is registered before `getSession()` is called. This matches Supabase's documented React Native setup guidance and ensures `INITIAL_SESSION` is never missed regardless of supabase-js version. If `INITIAL_SESSION` fires before `getSession()` resolves (synchronous during subscription setup), Surface B triggers from the event. `getSession()` then calls `setSession` with the same value — React batches the identical update. If `INITIAL_SESSION` does not fire (some environments), `getSession().then()` is the sole trigger. Both orderings are correct.

**authGen counter:** A `const [authGen, setAuthGen] = useState(0)` state variable is incremented by Surface A **only on `SIGNED_IN` and `INITIAL_SESSION` events — never on `TOKEN_REFRESHED`** (decision: a background token rotation leaves `user.id` and the profile/membership unchanged, so re-fetching would be wasted network). It is included in Surface B's dependency array alongside `session?.user.id`. This guards against the React 19 automatic batching scenario where `SIGNED_OUT` and `SIGNED_IN` events batch together so `session?.user.id` never transitions through `undefined`, causing Effect B to skip the re-fetch on re-login. The `loadSeq` guard handles any duplicate fetches triggered by this counter. On `TOKEN_REFRESHED`, Surface A still calls `setSession(next)` (so the live session object stays current) but does not bump `authGen`, so Surface B does not re-fetch.

### 5.4 Loading State Machine

| State | loading | session | profile | membership |
|-------|---------|---------|---------|------------|
| INITIAL | true | null | null | null |
| HYDRATED | false | S | cached | cached |
| LIVE | false | S | fresh | fresh |
| SPINNER | true | S | null | null |
| SIGNED_OUT | false | null | null | null |

HYDRATED and LIVE are both "routes to `/(tabs)` if membership is set." SPINNER is the cache-miss transient (first install or expired cache).

**Timeout behavior:** A `resolvedRef = useRef(false)` tracks whether `setLoading(false)` has been called legitimately (from cache hit, Effect B completion, or SIGNED_OUT branch). The timeout callback checks `resolvedRef.current` before firing: `if (active && !resolvedRef.current) setLoading(false)`. This prevents the timeout from firing on slow-but-real connections and producing the route-flash. Every code path that calls `setLoading(false)` legitimately also sets `resolvedRef.current = true`.

### 5.5 Pseudocode

```ts
const BOOT_TIMEOUT_MS = 20_000;

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [membership, setMembership] = useState<Membership | null>(null);
  const [loading, setLoading] = useState(true);
  const [authGen, setAuthGen] = useState(0); // increments on each non-null session event

  const loadSeq = useRef(0);
  const resolvedRef = useRef(false);        // timeout guard: was loading resolved?
  const prevUserIdRef = useRef<string | undefined>(undefined); // dup-fire guard

  // ── Surface C: boot effect ────────────────────────────────────────────────
  useEffect(() => {
    let active = true;

    // Arm timeout fallback BEFORE any async work.
    const timeoutId = setTimeout(() => {
      if (active && !resolvedRef.current) {
        resolvedRef.current = true;
        setLoading(false);
      }
    }, BOOT_TIMEOUT_MS);

    // Surface A: register subscription FIRST (before getSession) per Supabase
    // React Native setup guide. Synchronous-only callback — zero supabase.* calls.
    // SYNC-ONLY: no await, no supabase.* calls. See deadlock post-mortem.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, next) => {
        if (!active) return;
        setSession(next);
        if (next) {
          // Re-fetch profile/membership only on a genuine (re-)login. A
          // background TOKEN_REFRESHED leaves user.id + profile unchanged, so
          // bumping authGen there would trigger a wasted fetch.
          if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
            setAuthGen((g) => g + 1); // triggers Surface B re-evaluation
          }
        } else {
          // SIGNED_OUT: eagerly clear state for snappy UI.
          // Surface B will also clear via its null-session branch.
          setProfile(null);
          setMembership(null);
          resolvedRef.current = true;
          setLoading(false);
        }
      }
    );

    // Seed session state from disk (no network, no GoTrue lock).
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      if (data.session) {
        setAuthGen((g) => g + 1);
      } else {
        // No session on disk: resolve immediately.
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

  // ── Surface B: profile/membership load — runs OUTSIDE the GoTrue lock ────
  useEffect(() => {
    if (!session?.user.id) return;

    const userId = session.user.id;

    // Dup-fire guard: skip if this exact userId was already the subject of
    // the previous run. Prevents double-fetch when React 19 batching causes
    // getSession().then() and INITIAL_SESSION to both call setSession with
    // the same user.id without an intervening undefined.
    if (userId === prevUserIdRef.current && authGen === /* initial */ 0) return;
    prevUserIdRef.current = userId;

    const seq = ++loadSeq.current;
    let active = true;

    (async () => {
      // Step 1: try cache (disk, no network, ~ms).
      const snap = await readSnapshot<{ profile: Profile; membership: Membership | null }>(
        userId, 'session'
      );

      if (!active || seq !== loadSeq.current) return;

      if (snap) {
        // Cache hit: boot instantly. Assign resolvedRef before setLoading
        // so the timeout callback sees it.
        setProfile(snap.profile);
        setMembership(snap.membership);
        resolvedRef.current = true;
        setLoading(false);
        // Fall through to Step 2 for silent background revalidation.
      }
      // If cache miss: loading remains true; Step 2 resolves it.

      // Step 2: network fetch (outside GoTrue lock).
      const [p, m] = await Promise.all([
        fetchProfile(userId),
        fetchMembership(userId),
      ]);

      if (!active || seq !== loadSeq.current) return;

      // Only update state on a successful fetch (non-null profile means
      // the fetch worked). On transient network/auth errors where both
      // return null AND we already have a cache snapshot, preserve the
      // cached state rather than clearing it.
      if (p !== null || m !== null || !snap) {
        setProfile(p);
        setMembership(m);
        resolvedRef.current = true;
        setLoading(false);
      }
      // If p===null AND m===null AND we had a snap: the fetch may have
      // failed transiently. Keep the cached values. The next foreground
      // refetch or AppState event will try again.

      // Persist fresh data for next cold launch (only when profile exists).
      if (p !== null) {
        writeSnapshot(userId, 'session', { profile: p, membership: m });
      }
      // When p===null (new user not yet onboarded): do NOT write cache.
      // The next cold launch will be a cache miss, forcing a network check.
      // When p===null after a successful fetch AND membership is also null,
      // both setProfile(null)/setMembership(null) have been called above,
      // routing the gate to /auth/profile — correct for incomplete onboarding.
    })();

    return () => { active = false; };
  }, [session?.user.id, authGen]);
  // Keyed on user.id AND authGen. authGen increments on every non-null session
  // event so re-login after sign-out always triggers a re-fetch even if the
  // user.id is the same (possible if the same account re-authenticates).

  // ── refresh — called after join_pool completes ────────────────────────────
  const refresh = useCallback(async () => {
    // Uses session from closure. fetchProfile/fetchMembership are PostgREST
    // calls that use the client's internally-managed current token; they do
    // NOT need the session closure for auth. user.id is stable across token
    // refreshes. Therefore getSession() is NOT called here — calling
    // supabase.auth.getSession() would acquire the GoTrue lock unnecessarily
    // and could reintroduce lock contention.
    if (!session?.user.id) return;
    const userId = session.user.id;
    const seq = ++loadSeq.current;
    const [p, m] = await Promise.all([
      fetchProfile(userId),
      fetchMembership(userId),
    ]);
    if (seq !== loadSeq.current) return;
    setProfile(p);
    setMembership(m);
    if (p !== null) writeSnapshot(userId, 'session', { profile: p, membership: m });
  }, [session?.user.id]);

  // ── signOut — clear cache BEFORE signing out ──────────────────────────────
  const signOut = useCallback(async () => {
    const userId = session?.user.id;
    // ORDERING: clearSnapshots MUST be awaited before supabase.auth.signOut().
    // signOut fires SIGNED_OUT which triggers Surface A's setSession(null),
    // which triggers Surface B's cleanup. We must have cleared the cache before
    // any new session could read it.
    await clearSnapshots(userId);
    // Eagerly clear in-memory state for snappy UI.
    setProfile(null);
    setMembership(null);
    // Note: supabase.auth.signOut() fires SIGNED_OUT synchronously in the
    // callback, which sets session=null via Surface A. The eager clears above
    // and the callback-driven clears are both idempotent.
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
```

### 5.6 Loading State Transitions

**Scenario 1 — Cold launch, no persisted session:**
```
INITIAL → Surface C mounts → getSession() resolves: session=null
  → setProfile(null), setMembership(null), setLoading(false)
SIGNED_OUT  [~2 ms; disk read only]
```

**Scenario 2 — Cold launch, persisted session, cache hit:**
```
INITIAL → Surface C mounts → subscription registered
  → getSession() resolves: setSession(s), setAuthGen(1)
  → Surface B fires: readSnapshot → cache hit → setProfile, setMembership
  → setLoading(false)
HYDRATED  [~2–5 ms; disk reads only]
  → Surface B continues: fetchProfile + fetchMembership
  → setProfile(fresh), setMembership(fresh), writeSnapshot
LIVE  [silent swap, no visible change if data unchanged]
```

**Scenario 3 — Cold launch, persisted session, cache miss:**
```
INITIAL → Surface B fires: readSnapshot → null
SPINNER  [loading=true, network fetch in progress]
  → fetchProfile + fetchMembership resolve
  → setProfile, setMembership, setLoading(false)
LIVE  [spinner duration = network round-trip, not a deadlock]
```

**Scenario 4 — Token refresh (same user.id):**
```
LIVE → TOKEN_REFRESHED fires: setSession(refreshedSession)
  → authGen NOT bumped (event ∉ {SIGNED_IN, INITIAL_SESSION})
  → Surface B deps unchanged → NO refetch (token rotation needs none)
LIVE  [no network, no visible change]
```

**Scenario 5 — Timeout fallback:**
```
SPINNER → BOOT_TIMEOUT_MS elapses → resolvedRef.current = false
  → timeout fires: setLoading(false)
  → gate routes based on current session/membership state
  → Surface B continues in background; when it resolves, setProfile/setMembership
    fire, gate re-renders and routes correctly via declarative <Redirect>
LIVE or SIGNED_OUT  [eventual]
```

### 5.7 LangProvider Interplay

`LangProvider` reads `profile` via `useSession()` and derives `lang = profile?.lang ?? stored ?? detected`. No changes to `LangProvider` are required. On a cache-hit cold launch, `profile.lang` is available from the snapshot within ~2–5 ms. On a cache miss, `lang` falls back to `stored ?? detected` for the duration of the spinner — identical to the pre-fix behavior on a non-deadlocked launch and therefore not a regression. `LangProvider.setLang` calls `supabase.from('profiles').update(...)` — this is a PostgREST call outside any auth callback, safe at all times. The `profile.id` used in that update is stable across token refreshes, so a stale cached profile.id would not produce a wrong update target (it would produce a silent RLS denial, which is acceptable — the preference is re-written on the next explicit `setLang` call with the fresh profile).

### 5.8 What Does Not Change

- `fetchProfile` and `fetchMembership` module-level functions: unchanged.
- `LangProvider` and `AppProviders`: unchanged.
- `app/index.tsx` routing gate: unchanged.
- `lib/supabase.ts` and `LargeSecureStore`: unchanged.
- `SessionContextValue` interface shape: unchanged (no consumer API changes).

---

## 6. PoolDataProvider Rewrite

### 6.1 Cache Payload Shape

```ts
// Stored under slot: `pool-<poolId>` for the signed-in userId
interface PoolCachePayload {
  teams: TeamsMap;
  pool: Pool;
  games: Game[];
  members: PoolMember[];  // PoolMember is { user_id, role, hidden, name, emoji }
  allGuesses: Guess[];
  tournamentId: number;
}
```

All six fields are stored together as one atomic write. `tournamentId` is cached explicitly so `tournamentIdRef` can be seeded from disk immediately on hydration, keeping realtime event scoping correct during the async gap before the background fetch completes.

**Teams cache note:** Teams are global reference data included in the pool snapshot for simplicity. If `Team` shape changes in a future commit, bump `CACHE_VERSION` — the pool snapshot will be treated as a miss and the teams are re-fetched with the pool. Extracting teams to a separate cache slot is a future improvement.

### 6.2 Loading Semantics

**Path A — First run / cache miss / expired cache:**
- `cacheRead` returns null. `setLoading(true)`. `load()` runs. Spinner visible until network round-trip. Identical to today's non-deadlocked behavior.

**Path B — Warm launch (cache hit):**
- `setLoading(true)` at the start of `hydrateAndRevalidate` (unconditional, prevents the render gap on pool-id change).
- `cacheRead` resolves with payload → `setTeams`, `setPool`, `setGames`, `setMembers`, `setAllGuesses`, seed `tournamentIdRef.current`.
- `setError(null)` to clear any stale error from a prior failed load.
- `setLoading(false)` → tabs render from disk (one async tick).
- `load()` fires in background with `{ silent: true }` — no `setError` propagation, no `setLoading(true)`.

**Path C — Pool switch (poolId changes):**
- `prevPoolIdRef` detects the change → `cacheClear` for old pool key.
- `setLoading(true)` → `cacheRead` for new pool → hit or miss → proceeds as B or A.

### 6.3 Effect Architecture

**Effect 1 — Hydrate + Revalidation (replaces the existing init effect)**

Keyed on `[poolId]` only. `load` is excluded from the dep array deliberately: `load` is a `useCallback([myId, poolId])` that only produces a new reference when `myId` or `poolId` changes. When `myId` changes without `poolId` changing (theoretically possible if the same user ID somehow persists across sessions), the `loadSeq` guard in `load()` handles any race.

```ts
// eslint-disable-next-line react-hooks/exhaustive-deps
// `load` is intentionally excluded: it only changes when myId or poolId change,
// which causes poolId to change here too. The loadSeq guard handles any edge case.
useEffect(() => {
  if (!poolId) {
    setLoading(false);
    setPool(null);
    setGames([]);
    setMembers([]);
    setAllGuesses([]);
    setTeams({});
    return;
  }

  // Pool switch: drop the previous pool's snapshot only (storage hygiene).
  // Cross-user safety is handled separately by userId-scoped keys + the
  // signOut clear — NOT by this line.
  if (prevPoolIdRef.current !== null && prevPoolIdRef.current !== poolId) {
    removeSnapshot(myId!, `pool-${prevPoolIdRef.current}`); // fire-and-forget
  }
  // Also handle poolId → null transition (sign-out path) in the null branch above.
  prevPoolIdRef.current = poolId;

  let cancelled = false;

  async function hydrateAndRevalidate() {
    // Always set loading=true at start to prevent ambiguous render gap.
    setLoading(true);

    const slot = `pool-${poolId}`;
    const cached = await readSnapshot<PoolCachePayload>(myId!, slot);

    if (cancelled) return;

    if (cached) {
      // Serve from disk. Clear any stale error from a previous failed load.
      setError(null);
      setTeams(cached.teams);
      setPool(cached.pool);
      setGames(cached.games);
      setMembers(cached.members);
      setAllGuesses(cached.allGuesses);
      tournamentIdRef.current = cached.tournamentId;
      setLoading(false);

      // Silent background revalidation — does NOT set loading=true.
      load({ silent: true });
    } else {
      // Cache miss: normal loading path. load() manages setLoading(false).
      load({ silent: false });
    }
  }

  hydrateAndRevalidate();

  return () => {
    cancelled = true;
  };
}, [poolId]);
```

This uses a `removeSnapshot(userId, slot)` helper (a single-key sibling of `clearSnapshots`, added to `lib/cache.ts` — see §4.5) so only the previous pool's slot is dropped, not the user's entire cache.

**Effect 2 — load() Modifications (internal changes)**

`load()` receives a `{ silent: boolean }` argument:
- When `silent: false` (cache miss / first run / pull-to-refresh): `setLoading(true)` at the top. On error: `setError(firstErr.message)` and `setLoading(false)`.
- When `silent: true` (background revalidation after cache hit): skip `setError` propagation on failure (swallow silently). `setLoading(false)` is a no-op since it is already false.

After every successful load (seq still current, all queries succeeded):
```ts
// Write cache IMMEDIATELY and unconditionally — no debounce needed.
// load() runs at most once per foreground event; the write is cheap.
writeSnapshot(myId, `pool-${poolId}`, {
  teams: teamsMap,  // capture before indexTeams to avoid double-call
  pool: poolRow,
  games: gamesData,
  members: membersData,
  allGuesses: guessesData,
  tournamentId,
});
```

Note: capture `const teamsMap = indexTeams(teamsRes.data ?? [])` before calling both `setTeams(teamsMap)` and including it in the payload, avoiding a double computation.

**Effect 3 — Realtime (structure unchanged; debounced flush added)**

A `latestSnapshotRef` mirrors all state slices for the debounced write:

```ts
const latestSnapshotRef = useRef<{
  poolId: number | null; pool: Pool | null; teams: TeamsMap;
  games: Game[]; members: PoolMember[]; allGuesses: Guess[];
  tournamentId: number | null;
}>({ poolId: null, pool: null, teams: {}, games: [], members: [], allGuesses: [], tournamentId: null });

useEffect(() => {
  latestSnapshotRef.current = {
    poolId, pool, teams, games, members, allGuesses,
    tournamentId: tournamentIdRef.current,
  };
}, [poolId, pool, teams, games, members, allGuesses]);
```

The `scheduleCacheFlush()` helper is used EXCLUSIVELY for realtime event patches (not for `load()` completion, which writes directly):

```ts
const cacheFlushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

function scheduleCacheFlush() {
  if (cacheFlushTimer.current) clearTimeout(cacheFlushTimer.current);
  cacheFlushTimer.current = setTimeout(() => {
    const snap = latestSnapshotRef.current;
    if (snap.poolId && snap.pool && snap.tournamentId != null && myId) {
      writeSnapshot(myId, `pool-${snap.poolId}`, {
        teams: snap.teams, pool: snap.pool, games: snap.games,
        members: snap.members, allGuesses: snap.allGuesses,
        tournamentId: snap.tournamentId,
      });
    }
  }, 2_000);
}
```

Each realtime handler (`upsertGame`, `upsertGuess`, `removeGuess`) calls `scheduleCacheFlush()` after its `setState` call. The realtime effect's cleanup cancels the timer:

```ts
return () => {
  if (cacheFlushTimer.current) clearTimeout(cacheFlushTimer.current);
  supabase.removeChannel(channel);
};
```

**Effect 4 — AppState Foreground Refetch (now silent)**

`load({ silent: true })` is called on `'active'`. Because data is already on screen when the app returns from the background, the refetch runs silently — no `setLoading(true)`, no spinner — and swaps fresh data in place (decision). This changes the prior behavior, which showed a spinner on every foreground. The pull-to-refresh path remains non-silent (the user explicitly asked for a refresh and expects the indicator).

**Effect 5 — Timeout Fallback (new)**

```ts
useEffect(() => {
  if (!loading) return;
  const t = setTimeout(() => {
    ++loadSeq.current; // invalidate any in-flight load() invocation
    setLoading(false);
    setError('Load timeout. Pull down to retry.');
  }, 10_000);
  return () => clearTimeout(t);
}, [loading]);
```

Incrementing `loadSeq.current` inside the timeout is critical: it ensures any in-flight `load()` that eventually resolves abandons at its `seq !== loadSeq.current` guard and does not overwrite the error state set by the fallback.

### 6.4 applyMyGuess Interaction

`applyMyGuess` calls `setAllGuesses` only — no cache write. The optimistic state is intentionally ephemeral. When the Supabase upsert succeeds, the realtime echo fires `upsertGuess` → `scheduleCacheFlush()` → the server-confirmed row is persisted. If the upsert fails and the caller rolls back via `applyMyGuess(gameId, null)`, no cache write ever fired for the optimistic row.

The cache always reflects server-confirmed state, never unconfirmed optimistic state.

### 6.5 loadSeq and tournamentIdRef Interaction

- `loadSeq` is incremented at the top of every `load()` invocation. The guard `if (seq !== loadSeq.current) return` prevents stale resolves. The timeout fallback also increments `loadSeq`, so any in-flight `load()` at timeout time is abandoned.
- `tournamentIdRef.current` is set inside `load()` at the `poolRes` step, and seeded from `cached.tournamentId` during cache hydration. On a cache-hit, the realtime channel subscribes and uses the cached `tournamentId` from the first event, without waiting for the background fetch. The `latestSnapshotRef` sync effect reads `tournamentIdRef.current` from state — since tournaments never change for a pool, this is effectively write-once per session.

---

## 7. Cross-Cutting Concerns

### 7.1 Security and Multi-User Hygiene

**Cache key isolation:** Every key includes the `userId` segment (`quiniela.cache.<userId>.<version>.<slot>`). User B's reads will never match User A's keys because `userId` is a UUID. No cross-contamination is possible through key collision.

**Sign-out sequence (critical ordering):**
1. `signOut()` in `SessionProvider` calls `await clearSnapshots(userId)` — removes all of User A's cached keys and cancels pending writes.
2. Only then calls `await supabase.auth.signOut()` — fires `SIGNED_OUT`, clears the supabase session.
3. Surface A's callback sets `session=null`, eagerly clears profile/membership.
4. `PoolDataProvider`'s Effect 1 sees `poolId → null` transition → calls `clearPoolCache(prevPoolId)` as a belt-and-suspenders redundant clear.

`clearSnapshots` MUST be awaited before `supabase.auth.signOut()`. If `clearSnapshots` is called after (current broken ordering in `providers.tsx:151`), the `SIGNED_OUT` callback fires first, which could trigger pending-write flushes before the cache is cleared. This ordering is a hard constraint.

**Device hand-off without sign-out:** User A's scoped keys persist but User B's reads never match them (different `userId` UUID). The keys are harmless dead weight until User A next signs in and signs out on this device, or until a `CACHE_VERSION` bump orphans them.

**RLS-revealed guesses in pool snapshot:** The `allGuesses` array cached in the pool snapshot may include other members' post-kickoff guess rows (revealed by RLS at kickoff time). Persisting the caller's own authorized view to their own device is acceptable: RLS gated the initial fetch; the rows were legitimately visible at write time; the device is controlled by the same identity; the cache is not transmitted anywhere. A `/* Security note */` comment on the pool-data write path documents this for future reviewers.

### 7.2 Cache Versioning and Migration

**When to bump `CACHE_VERSION`:**

| Change | Bump? |
|--------|-------|
| Adding a new nullable field to Profile, Membership, or Game | No — cached shape deserialises; new field is `undefined` |
| Removing or renaming a field that existing code reads | Yes |
| Changing the type of an existing field | Yes |
| Changing the key structure | Yes |
| Adding a new collection to the pool snapshot | No — absent field treated as empty array |

**No migration transforms.** On a version miss, the first boot after an app update falls back to the network path (the pre-fix behavior). This is simpler than running migration transforms over serialized JSON and is acceptable for a performance-shortcut cache.

### 7.3 Stale-Route Flicker on Membership Removal

If a user's membership is removed by an admin between cold launches, the cache will route them to `/(tabs)`. The background revalidation then discovers `membership=null`, triggering `<Redirect href="/auth/profile" />`. The user is bounced out of tabs.

This is acceptable: membership removal is a deliberate admin action; the bounce is self-correcting (the profile screen handles the re-onboarding flow); `app/index.tsx` already handles membership transitioning from non-null to null via declarative `<Redirect>` that re-evaluates on state change; and the alternative (not caching membership) restores the deadlock problem. The flicker window is bounded to the background fetch duration (~200–800 ms).

A similar flicker applies if a profile row is deleted server-side — the cached profile routes the user briefly before the revalidation discovers `profile=null` and routes to `/auth/profile`.

### 7.4 What Must NOT Be Cached

| Datum | Reason |
|-------|--------|
| Session tokens (access/refresh token) | Already persisted by LargeSecureStore (AES-encrypted in AsyncStorage+SecureStore). Double-storing creates a second less-secure copy. |
| `supabase.auth.*` internal state | Owned entirely by supabase-js; never touch it from the cache module. |
| `pendingInviteCode` | Handled by `lib/onboarding.ts` with key `quiniela.pendingInviteCode`. Cache module must not touch this key. |
| `quiniela.lang` | Handled by LangProvider. Cache module must not touch this key. |
| OTP or verification codes | Ephemeral, security-sensitive. Never persist. |
| `useWhoPicked` RPC results | Transient, on-demand hook data. Never cache. |
| Admin-only provisional result data | Not in any provider snapshot. Never cache. |
| Optimistic (unconfirmed) guess state from `applyMyGuess` | Cache reflects only server-confirmed state. |

### 7.5 Flag Images

`teams.flag` stores a CDN URL. The app renders flags via `expo-image`, which ships with automatic disk caching backed by the native image stack (NSURLCache on iOS, OkHttp on Android). No action is required in `lib/cache.ts` for flag images. The `TeamsMap` (code → `{name_en, name_es, flag: url}`) is cached as part of the pool snapshot, so the flag URL is available immediately after hydration — `expo-image` will hit its native disk cache for the bitmap on any warm launch after the first render.

### 7.6 Defense-in-Depth Timeout Summary

| Location | Constant | Behavior |
|----------|----------|----------|
| SessionProvider | `BOOT_TIMEOUT_MS = 20_000` | Forces `loading=false` if the auth/cache sequence never resolves. Checks `resolvedRef.current` before firing to avoid false positives on slow connections. |
| PoolDataProvider | 10 s | Forces `loading=false` + `error` message if `load()` never resolves. Increments `loadSeq` to abandon in-flight load. |
| lib/cache.ts | `MAX_CACHE_AGE_MS = 7 days` | `readSnapshot` returns null for entries older than 7 days, forcing a network fetch. |
| lib/cache.ts | `WRITE_THROTTLE_MS = 300` | Leading-edge + trailing throttle; bounds worst-case write staleness to ≈300 ms (leading write each window means bursts can't starve the disk write). |

---

## 8. Testing

### 8.1 lib/__tests__/cache.test.ts — Unit Tests

The module is pure async TypeScript with one external dependency (AsyncStorage). Tests run in the existing `vitest` node environment without config changes.

**AsyncStorage mock strategy — vi.hoisted required:**

```ts
// vi.hoisted() runs BEFORE vi.mock hoisting, making the store reference safe
// inside the factory. DO NOT use a module-level `const store = {}` — that
// binding is in the temporal dead zone when the vi.mock factory executes.
const store = vi.hoisted(() => ({} as Record<string, string>));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => store[key] ?? null),
    setItem: vi.fn(async (key: string, value: string) => { store[key] = value; }),
    removeItem: vi.fn(async (key: string) => { delete store[key]; }),
    multiRemove: vi.fn(async (keys: string[]) => { keys.forEach((k) => delete store[k]); }),
    getAllKeys: vi.fn(async () => Object.keys(store)),
  },
}));

// Import AsyncStorage at the top of the file (not inside tests) — the mock
// hoisting ensures the top-level import receives the mocked module.
import AsyncStorage from '@react-native-async-storage/async-storage';
```

**beforeEach cleanup — must use key-deletion, NOT reassignment:**

```ts
beforeEach(() => {
  // Use key-deletion, NOT store = {}. Reassignment breaks the closure reference
  // held by the vi.mock factory — the mock's getItem/setItem would still see
  // the old object while tests see an empty variable.
  Object.keys(store).forEach((k) => delete store[k]);
  vi.clearAllMocks();
});
```

**Coalescing flush mechanism — commit to setTimeout:**

The implementation uses `setTimeout`-based debounce. Tests in the coalescing block use `vi.useFakeTimers()` / `vi.useRealTimers()` and call `await vi.runAllTimersAsync()` to flush. Non-coalescing tests use `await vi.runAllTimersAsync()` uniformly (no-op when real timers are active and no setTimeout is pending).

**Test cases:**

```
describe('readSnapshot')
  - returns null when key is absent (cold cache)
  - returns null when stored JSON is corrupt
  - returns null when envelope.v !== CACHE_VERSION (using CACHE_VERSION - 1)
  - returns null when envelope.uid !== requested userId
  - returns null when envelope.ts is older than MAX_CACHE_AGE_MS
  - returns data when version and uid match and not expired
  - does not throw on a future unknown version — resolves null gracefully

describe('writeSnapshot + readSnapshot roundtrip')
  - persists a plain object and reads it back intact
  - keys are scoped: user-A data is null under user-B
  - a second write to the same slot overwrites the first (trailing write wins)
  - writeSnapshot with null data: readSnapshot returns null (cache miss semantics)

describe('write coalescing')  [uses vi.useFakeTimers()]
  - first write in a quiet window persists immediately (leading edge)
  - N rapid writes in one window → exactly 2 setItem calls (leading + 1 trailing), trailing has the last value
  - writes spaced > WRITE_THROTTLE_MS apart each persist immediately (N writes → N setItem)
  - different slots throttle independently
  - afterEach: vi.useRealTimers()

describe('clearSnapshots')
  - removes all quiniela.cache.<userId>.* keys (all versions)
  - leaves quiniela.lang untouched
  - leaves sb-localhost-auth-token untouched
  - does NOT remove keys belonging to a different userId
  - is idempotent (calling twice does not throw)
  - verifies multiRemove is called with EXACTLY the cache keys and no others
    (use arrayContaining + toHaveLength(N) — not arrayContaining alone)
  - cancels pending debounced writes for the user before removing keys
  - is a no-op when userId is undefined (no throw)
```

**clearSnapshots key scoping — envelope version in beforeEach fixtures:**

```ts
// Use imported CACHE_VERSION, not hardcoded 1, so tests stay valid after bumps.
store[`quiniela.cache.user-1.${CACHE_VERSION}.session`] =
  JSON.stringify({ v: CACHE_VERSION, uid: 'user-1', ts: Date.now(), data: {} });
```

### 8.2 lib/__tests__/session-callback-guard.test.ts — Structural Guard

This file reads `lib/providers.tsx` source text and asserts the `onAuthStateChange` callback contains no `await`, no `supabase.*` calls, and is not declared `async`. It operates on raw source text (not AST), which is fast but has the limitation that a comment containing the banned patterns inside the callback region would cause a false failure. This is acceptable given the code's low comment density in that area.

**Atomicity requirement:** This test file MUST be committed in the same commit as the fixed `providers.tsx`. It fails against the current (unfixed) file. Add a comment at the top of the test: *"This test MUST be committed alongside the fixed providers.tsx. It will fail against the unfixed file."*

**Limitation:** If the callback is refactored to a named function defined elsewhere (e.g., `const handleAuthChange = (...) => { ... }`), the extractor would grab the wrong body and the guard would pass even if the named function contains `await`. The implementation MUST keep the callback inline, and the guard's comment must document this constraint.

### 8.3 Manual Cold-Launch Verification Checklist

**Prerequisites:** A device or Simulator with a signed-in account (LargeSecureStore populated). A second test account with a different pool. Network-throttling capability (airplane mode or Charles Proxy). Flipper or Metro remote debugger for Promise inspection.

**Checklist A — Deadlock Absence:**
| Step | Action | Pass Criterion |
|------|--------|----------------|
| A1 | Kill app. Launch cold with a persisted session. | Spinner clears within ~5 s. No permanent hang. |
| A2 | Repeat A1 five times. | All five launches navigate past the spinner. Bug was non-deterministic. |
| A3 | With Flipper attached, watch for any unresolved Promise in the `onAuthStateChange` stack. | No Promise unresolved after 500 ms. |

**Checklist B — Perceptually-Instant Boot from Cache:**
| Step | Action | Pass Criterion |
|------|--------|----------------|
| B1 | Login, navigate to `/(tabs)` (pool data cached). Kill app. Enable airplane mode. Launch cold. | Spinner clears and `/(tabs)` renders within ~200 ms. Content populated with last-known data. |
| B2 | Disable airplane mode. Wait ~2 s. | UI silently updates with fresh data. No loading spinner. No "updating…" banner. |
| B3 | Verify `loading=false` fires before any network response. | Confirm via Flipper network tab: first `/profiles` network request starts AFTER `/(tabs)` is already visible. |

**Checklist C — Silent Revalidation Swap:**
| Step | Action | Pass Criterion |
|------|--------|----------------|
| C1 | While `/(tabs)` visible, update a game score via Supabase dashboard. | Within ~500 ms, score updates in place. No loading spinner. No navigation. |
| C2 | Background app for 30 s. Foreground it. | Any changed data appears silently within ~1 s. No loading state for unchanged data. |
| C3 | Pull-to-refresh on Matches screen. | Loading indicator appears briefly and dismisses. Existing UX unbroken. |

**Checklist D — Multi-User Hygiene:**
| Step | Action | Pass Criterion |
|------|--------|----------------|
| D1 | Sign in as User A. Navigate to `/(tabs)`. Sign out. | UI immediately navigates to `/auth/invite`. |
| D2 | Sign in as User B. | Profile name, pool name, standings, guesses are User B's data. |
| D3 | Kill. Launch cold as User B. | Cache hit shows User B's data, not User A's. |
| D4 | Inspect AsyncStorage (Flipper plugin or debug screen after sign-out). | Zero `quiniela.cache.<user-A-uid>.*` keys remain after D1 sign-out. |

**Checklist E — Timeout Fallback:**
| Step | Action | Pass Criterion |
|------|--------|----------------|
| E1 | In debug build: patch `BOOT_TIMEOUT_MS` to 2 000 ms; add 3 s delay to `fetchProfile`. Kill. Launch with persisted session and no cache. | Spinner exits at 2 s. Gate routes based on available state (likely `/auth/profile`). |
| E2 | Wait for the patched `fetchProfile` to eventually resolve (~3 s after launch). | Membership arrives silently; gate re-renders and routes to `/(tabs)` or `/auth/profile` correctly. No crash. |
| E3 | Requires `resolvedRef.current` check from §5.5 to be in place — confirm `load-seq` guard abandoned the in-flight fetch per §6.3 Effect 5. | No double-navigation. No stale state overwriting the timeout result. |

---

## 9. File-by-File Change List

| Path | New / Modify | Summary |
|------|-------------|---------|
| `/Users/pablo/Projects/quiniela/lib/cache.ts` | New | Shared cache primitive. Exports `CACHE_VERSION` (= 1), `CacheEnvelope<T>` interface, `readSnapshot<T>(userId, slot)`, `writeSnapshot<T>(userId, slot, data)` (throttle-with-trailing debounce), `removeSnapshot(userId, slot)` (single-key removal for pool-switch hygiene), `clearSnapshots(userId)` (version-agnostic sweep, cancels pending writes). Key format: `quiniela.cache.<userId>.<CACHE_VERSION>.<slot>`. Envelope includes `v`, `uid`, `ts` (for `MAX_CACHE_AGE_MS` guard), `data`. Pure TypeScript, no React imports, fully testable in node vitest environment. |
| `/Users/pablo/Projects/quiniela/lib/providers.tsx` | Modify | Rewrite `SessionProvider`: (1) Add `BOOT_TIMEOUT_MS = 20_000` constant. (2) Add `authGen` state and `resolvedRef`, `prevUserIdRef` refs. (3) Import `readSnapshot`, `writeSnapshot`, `clearSnapshots` from `./cache`. (4) Replace single combined `useEffect` with Surface C (boot: subscription-first, then `getSession()`, timeout, cleanup). (5) Add Surface B `useEffect` keyed on `[session?.user.id, authGen]` containing all profile/membership fetching with cache-read-first, network-fetch-second, `writeSnapshot` on success, preserve-on-transient-error semantics. (6) Remove `loadFor` `useCallback`. (7) Rewrite `refresh()` to use closed-over session, no `getSession()` call. (8) Rewrite `signOut()` to `await clearSnapshots(userId)` BEFORE `supabase.auth.signOut()`. `LangProvider` and `AppProviders` unchanged. |
| `/Users/pablo/Projects/quiniela/lib/data.tsx` | Modify | Rewrite `PoolDataProvider`: (1) Add `PoolCachePayload` interface. (2) Add `prevPoolIdRef`, `latestSnapshotRef`, `cacheFlushTimer` refs. (3) Add `latestSnapshot` sync effect keyed on `[poolId, pool, teams, games, members, allGuesses]`. (4) Modify `load()`: add `{ silent: boolean }` argument; `silent: true` suppresses `setError` and `setLoading(true)`; after success, call `writeSnapshot(myId, \`pool-${poolId}\`, payload)` directly (no debounce). (5) Replace init `useEffect` with Effect 1 keyed on `[poolId]`: unconditional `setLoading(true)`, then `cacheRead` with cache-hit/miss branching, `setError(null)` on cache hit, `tournamentIdRef` seeding, `load({ silent: true })` for background, `load({ silent: false })` for first-run. Pool-switch cache clear via `prevPoolIdRef`. (6) Add `scheduleCacheFlush()` helper (2 s debounce, reads `latestSnapshotRef`, calls `writeSnapshot`). (7) Add `scheduleCacheFlush()` calls after `upsertGame`, `upsertGuess`, `removeGuess` setState calls. (8) Clear `cacheFlushTimer` in realtime effect cleanup. (9) Add timeout fallback Effect 5 (10 s, increments `loadSeq`, sets error). (10) AppState foreground refetch now calls `load({ silent: true })` (was non-silent — no spinner on foreground). `applyMyGuess`, `useWhoPicked`, `usePendingGames`, and all exported hook signatures unchanged. |
| `/Users/pablo/Projects/quiniela/lib/__tests__/cache.test.ts` | New | Unit tests for `lib/cache.ts`. `vi.hoisted()` for the AsyncStorage mock store. `vi.mock('@react-native-async-storage/async-storage')` with in-memory Map implementation. `import AsyncStorage from '...'` at top level. Four describe blocks: readSnapshot (miss, corrupt, version mismatch, uid mismatch, expired, hit); roundtrip (plain object, cross-user isolation, overwrite, null data); write coalescing with `vi.useFakeTimers()` (1 setItem for N writes, per-slot independence, leading-edge cap); clearSnapshots key scoping (removes only cache keys, leaves lang/supabase keys, idempotent, exact multiRemove argument verification via `toHaveLength`). Runs in existing `vitest` node environment with no config changes. |
| `/Users/pablo/Projects/quiniela/lib/__tests__/session-callback-guard.test.ts` | New | Structural guard. Reads `lib/providers.tsx` source via `node:fs` `readFileSync`. Implements balanced-paren extractor to isolate `onAuthStateChange` callback body. Asserts: no `/\bawait\b/`, no `/\bsupabase\s*\./`, no `/\basync\b/`. Includes inline documentation of source-text-vs-AST limitation and atomicity requirement (must commit alongside fixed `providers.tsx`). |

---

## 10. Out of Scope / Future Work

The following are explicitly deferred and must not be included in this implementation:

- **OS background refresh while app is closed.** The cache strategy described here covers cold launch and foreground use only. Fetching data while the app process is dead requires a background fetch extension (iOS BGAppRefreshTask, Android WorkManager) — a separate, significant effort.
- **Offline writes.** Users cannot submit picks while offline. The optimistic `applyMyGuess` is an in-session UX enhancement only; writes require network connectivity. Queuing writes for offline-then-sync requires conflict resolution logic well beyond this scope.
- **TanStack Query or other state management libraries.** The codebase convention is explicit: "no react-query; plain context + hooks." This design honors that convention.
- **Per-slot cache versioning.** A single global `CACHE_VERSION` is used. If a `Profile` shape change should not bust the pool cache, per-slot version maps would be needed. Deferred: the global version is simpler and a bump is a low-frequency event.
- **Teams in a separate cache slot.** Teams are included in the pool snapshot for simplicity. Extracting them to `quiniela.cache.<userId>.<version>.teams` would allow independent cache invalidation. Deferred: measure real-world write sizes first.
- **`cacheAge` context exposure.** The `ts` field in `CacheEnvelope` could be surfaced via the context for "last updated" debugging UI. Deferred: the primary use is the `MAX_CACHE_AGE_MS` guard; user-visible staleness indicators are a product decision.
- **Background sweep of orphaned old-version keys.** When `CACHE_VERSION` is bumped, old keys from prior versions become invisible but remain on disk. `clearSnapshots` on sign-out cleans them up naturally. An explicit background sweep (scan for `quiniela.cache.*` keys with version < current) is deferred as a storage hygiene improvement.
