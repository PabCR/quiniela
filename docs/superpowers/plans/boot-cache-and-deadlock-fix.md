# Cache-First Boot + Deadlock Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the cold-launch "spinner forever" deadlock and make the app boot from a local disk cache, revalidating silently in the background.

**Architecture:** A shared `lib/cache.ts` AsyncStorage primitive persists per-user snapshots. `SessionProvider` moves all `supabase.*` calls out of the `onAuthStateChange` callback (the deadlock fix) and hydrates profile/membership from cache before revalidating. `PoolDataProvider` hydrates pool data from cache and revalidates silently. Realtime stays as the live-update mechanism.

**Tech Stack:** Expo Router, React 19, React Native 0.85, `@supabase/supabase-js`, `@react-native-async-storage/async-storage`, Vitest (node env, globals disabled).

**Reference spec:** `docs/superpowers/specs/boot-cache-and-deadlock-fix-design.md`

---

## File Structure

| Path | New/Modify | Responsibility |
|------|-----------|----------------|
| `lib/cache.ts` | New | Pure persistence primitive: `readSnapshot`, `writeSnapshot` (leading+trailing throttle), `removeSnapshot`, `clearSnapshots`, `CACHE_VERSION`, `CacheEnvelope`. No React imports. |
| `lib/__tests__/cache.test.ts` | New | Unit tests for `lib/cache.ts` against a mocked AsyncStorage. |
| `lib/__tests__/session-callback-guard.test.ts` | New | Source-text regression guard: the auth callback stays sync + supabase-free. |
| `lib/providers.tsx` | Modify | `SessionProvider` rewrite: deadlock fix + cache-first profile/membership. `LangProvider`/`AppProviders` untouched. |
| `lib/data.tsx` | Modify | `PoolDataProvider` rewrite: cache-first pool data + silent revalidation + decisions. Exported hooks unchanged. |

**Test commands (this repo):** `npm test` (= `vitest run`), single file `npx vitest run lib/__tests__/<file>`, `npm run typecheck` (= `tsc --noEmit`), `npm run lint` (= `expo lint`).

**Conventions:** Tests import explicitly from `vitest` (globals are disabled in `vitest.config.ts`). Vitest `include` is `lib/__tests__/**/*.{test,spec}.ts`, environment `node`.

---

## Task 1: cache.ts core — envelope, keys, read + immediate write

**Files:**
- Create: `lib/cache.ts`
- Test: `lib/__tests__/cache.test.ts`

- [ ] **Step 1: Write the failing tests (read + roundtrip + guards)**

Create `lib/__tests__/cache.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// vi.hoisted runs BEFORE vi.mock hoisting, so this store ref is safe in the
// factory. Do NOT use a bare module-level const — it is in the TDZ when the
// vi.mock factory executes.
const store = vi.hoisted(() => ({ map: {} as Record<string, string> }));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => store.map[key] ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      store.map[key] = value;
    }),
    removeItem: vi.fn(async (key: string) => {
      delete store.map[key];
    }),
    multiRemove: vi.fn(async (keys: string[]) => {
      keys.forEach((k) => delete store.map[k]);
    }),
    getAllKeys: vi.fn(async () => Object.keys(store.map)),
  },
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  CACHE_VERSION,
  clearSnapshots,
  readSnapshot,
  removeSnapshot,
  writeSnapshot,
} from '../cache';

const UID = 'user-1';

beforeEach(async () => {
  // Key-deletion, NOT `store.map = {}` — the mock factory closed over store.map.
  for (const k of Object.keys(store.map)) delete store.map[k];
  vi.clearAllMocks();
  // Reset cache.ts's module-level pendingWrites (it persists across tests) so a
  // stale throttle window can't turn a later test's first write into a coalesce.
  await clearSnapshots(UID);
});

afterEach(() => {
  vi.useRealTimers();
});

function envelopeFor(
  uid: string,
  slot: string,
  data: unknown,
  over: Partial<{ v: number; ts: number }> = {},
): string {
  return JSON.stringify({
    v: over.v ?? CACHE_VERSION,
    uid,
    ts: over.ts ?? Date.now(),
    data,
  });
}

describe('readSnapshot', () => {
  it('returns null on a cold cache (absent key)', async () => {
    expect(await readSnapshot(UID, 'session')).toBeNull();
  });

  it('returns null when stored JSON is corrupt', async () => {
    store.map[`quiniela.cache.${UID}.${CACHE_VERSION}.session`] = '{not json';
    expect(await readSnapshot(UID, 'session')).toBeNull();
  });

  it('returns null on version mismatch', async () => {
    store.map[`quiniela.cache.${UID}.${CACHE_VERSION}.session`] = envelopeFor(
      UID,
      'session',
      { a: 1 },
      { v: CACHE_VERSION - 1 },
    );
    expect(await readSnapshot(UID, 'session')).toBeNull();
  });

  it('returns null on a future unknown version (graceful, no throw)', async () => {
    store.map[`quiniela.cache.${UID}.${CACHE_VERSION}.session`] = envelopeFor(
      UID,
      'session',
      { a: 1 },
      { v: CACHE_VERSION + 1 },
    );
    expect(await readSnapshot(UID, 'session')).toBeNull();
  });

  it('returns null on uid mismatch', async () => {
    store.map[`quiniela.cache.${UID}.${CACHE_VERSION}.session`] = envelopeFor(
      'someone-else',
      'session',
      { a: 1 },
    );
    expect(await readSnapshot(UID, 'session')).toBeNull();
  });

  it('returns null when older than the max cache age', async () => {
    const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
    store.map[`quiniela.cache.${UID}.${CACHE_VERSION}.session`] = envelopeFor(
      UID,
      'session',
      { a: 1 },
      { ts: eightDaysAgo },
    );
    expect(await readSnapshot(UID, 'session')).toBeNull();
  });

  it('returns data when version + uid match and not expired', async () => {
    store.map[`quiniela.cache.${UID}.${CACHE_VERSION}.session`] = envelopeFor(
      UID,
      'session',
      { name: 'Pablo' },
    );
    expect(await readSnapshot<{ name: string }>(UID, 'session')).toEqual({
      name: 'Pablo',
    });
  });
});

describe('writeSnapshot + readSnapshot roundtrip', () => {
  it('persists and reads back intact (leading-edge immediate write)', async () => {
    writeSnapshot(UID, 'session', { name: 'Pablo' });
    expect(await readSnapshot(UID, 'session')).toEqual({ name: 'Pablo' });
  });

  it('scopes by user: user-B cannot read user-A data', async () => {
    writeSnapshot('user-A', 'session', { secret: 1 });
    expect(await readSnapshot('user-B', 'session')).toBeNull();
  });

  it('writing null data reads back as a miss (null)', async () => {
    writeSnapshot(UID, 'session', null);
    expect(await readSnapshot(UID, 'session')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/__tests__/cache.test.ts`
Expected: FAIL — `Failed to resolve import "../cache"` (module does not exist yet).

- [ ] **Step 3: Implement `lib/cache.ts` (read + immediate write only)**

Create `lib/cache.ts`:

```ts
/* lib/cache.ts — shared AsyncStorage persistence primitive for cache-first boot.
 *
 * Both providers persist their last-known state here so a cold launch can render
 * from local disk (single-digit ms) instead of blocking on the network. There is
 * NO synchronous read: readSnapshot is async; "instant" means a local flash-I/O
 * read, not a first-frame render from cache.
 *
 * Keys:     quiniela.cache.<userId>.<CACHE_VERSION>.<slot>   (userId BEFORE the
 *           version so clearSnapshots can sweep all versions for a user).
 * Envelope: { v, uid, ts, data } — v gates schema, uid is a redundant ownership
 *           check, ts drives the max-age staleness guard.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

/** Bump when a persisted shape changes incompatibly — old keys become misses. */
export const CACHE_VERSION = 1;

const MAX_CACHE_AGE_MS = 7 * 24 * 60 * 60 * 1_000; // 7 days

export interface CacheEnvelope<T> {
  v: number;
  uid: string;
  ts: number;
  data: T;
}

function cacheKey(userId: string, slot: string): string {
  return `quiniela.cache.${userId}.${CACHE_VERSION}.${slot}`;
}

/**
 * Read a cached snapshot. Returns null on miss, parse error, version mismatch,
 * uid mismatch, or age beyond MAX_CACHE_AGE_MS. Async: resolves after local I/O
 * (~ms), never a network round-trip; there is no synchronous first-frame render.
 */
export async function readSnapshot<T>(
  userId: string,
  slot: string,
): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(cacheKey(userId, slot));
    if (!raw) return null;
    const env = JSON.parse(raw) as CacheEnvelope<T>;
    if (env.v !== CACHE_VERSION) return null;
    if (env.uid !== userId) return null;
    if (typeof env.ts !== 'number' || Date.now() - env.ts > MAX_CACHE_AGE_MS) {
      return null;
    }
    return env.data;
  } catch {
    return null;
  }
}

function persist(key: string, env: CacheEnvelope<unknown>): void {
  try {
    AsyncStorage.setItem(key, JSON.stringify(env)).catch(() => {});
  } catch {
    // Non-fatal: a failed write just means the next fetch overwrites stale data.
  }
}

/**
 * Persist a snapshot (fire-and-forget). Immediate write for now; Task 2 adds the
 * leading-edge + trailing throttle.
 */
export function writeSnapshot<T>(userId: string, slot: string, data: T): void {
  const key = cacheKey(userId, slot);
  const env: CacheEnvelope<T> = {
    v: CACHE_VERSION,
    uid: userId,
    ts: Date.now(),
    data,
  };
  persist(key, env);
}

/** Placeholder — fully implemented in Task 3. */
export function removeSnapshot(userId: string, slot: string): void {
  AsyncStorage.removeItem(cacheKey(userId, slot)).catch(() => {});
}

/** Placeholder — fully implemented in Task 3. */
export async function clearSnapshots(
  userId: string | undefined,
): Promise<void> {
  if (!userId) return;
  const prefix = `quiniela.cache.${userId}.`;
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const userKeys = allKeys.filter((k) => k.startsWith(prefix));
    if (userKeys.length > 0) await AsyncStorage.multiRemove(userKeys);
  } catch {
    // Swallow.
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/__tests__/cache.test.ts`
Expected: PASS (10 tests in the two describe blocks above).

- [ ] **Step 5: Commit**

```bash
git add lib/cache.ts lib/__tests__/cache.test.ts
git commit -m "feat(cache): add AsyncStorage snapshot primitive (read + write)"
```

---

## Task 2: cache.ts — leading-edge + trailing write throttle

**Files:**
- Modify: `lib/cache.ts`
- Test: `lib/__tests__/cache.test.ts`

- [ ] **Step 1: Add the failing coalescing tests**

Append to `lib/__tests__/cache.test.ts`:

```ts
describe('write coalescing (leading-edge + trailing throttle)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('first write in a window persists immediately (leading edge)', () => {
    writeSnapshot(UID, 'pool-1', { n: 1 });
    expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);
  });

  it('N rapid writes in one window → 2 setItem (leading + trailing, last value)', async () => {
    writeSnapshot(UID, 'pool-1', { n: 1 });
    writeSnapshot(UID, 'pool-1', { n: 2 });
    writeSnapshot(UID, 'pool-1', { n: 3 });
    writeSnapshot(UID, 'pool-1', { n: 4 });
    writeSnapshot(UID, 'pool-1', { n: 5 });
    expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1); // leading only, so far
    await vi.advanceTimersByTimeAsync(300);
    expect(AsyncStorage.setItem).toHaveBeenCalledTimes(2); // + trailing
    expect(await readSnapshot<{ n: number }>(UID, 'pool-1')).toEqual({ n: 5 });
  });

  it('writes spaced beyond the window each persist immediately', async () => {
    writeSnapshot(UID, 'pool-1', { n: 1 });
    await vi.advanceTimersByTimeAsync(301);
    writeSnapshot(UID, 'pool-1', { n: 2 });
    await vi.advanceTimersByTimeAsync(301);
    writeSnapshot(UID, 'pool-1', { n: 3 });
    expect(AsyncStorage.setItem).toHaveBeenCalledTimes(3);
  });

  it('different slots throttle independently (each leads)', () => {
    writeSnapshot(UID, 'pool-1', { n: 1 });
    writeSnapshot(UID, 'pool-2', { n: 1 });
    expect(AsyncStorage.setItem).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `npx vitest run lib/__tests__/cache.test.ts -t "write coalescing"`
Expected: FAIL — "N rapid writes" expects 1 then 2 setItem calls, but the immediate-write implementation calls setItem 5 times.

- [ ] **Step 3: Replace `writeSnapshot` with the throttle in `lib/cache.ts`**

In `lib/cache.ts`, add the throttle constant beside `MAX_CACHE_AGE_MS`:

```ts
const WRITE_THROTTLE_MS = 300;
```

Then replace the entire `writeSnapshot` function with:

```ts
interface PendingWrite {
  trailingHandle: ReturnType<typeof setTimeout> | null;
  windowEnd: number;
  latest: CacheEnvelope<unknown> | null;
}

const pendingWrites = new Map<string, PendingWrite>();

/**
 * Persist a snapshot (fire-and-forget). Leading-edge + trailing throttle: the
 * first call in a quiet window writes immediately and opens a WRITE_THROTTLE_MS
 * window; calls within the window coalesce into one trailing write carrying the
 * latest value. Worst-case staleness is bounded by WRITE_THROTTLE_MS.
 */
export function writeSnapshot<T>(userId: string, slot: string, data: T): void {
  const key = cacheKey(userId, slot);
  const env: CacheEnvelope<T> = {
    v: CACHE_VERSION,
    uid: userId,
    ts: Date.now(),
    data,
  };
  const now = Date.now();
  const p = pendingWrites.get(key);

  if (!p || now >= p.windowEnd) {
    // Leading edge: persist now, open a fresh window.
    persist(key, env);
    pendingWrites.set(key, {
      trailingHandle: null,
      windowEnd: now + WRITE_THROTTLE_MS,
      latest: null,
    });
    return;
  }

  // Within the window: remember the latest value, arm a single trailing flush.
  p.latest = env;
  if (p.trailingHandle === null) {
    p.trailingHandle = setTimeout(() => {
      const cur = pendingWrites.get(key);
      if (!cur) return;
      const pending = cur.latest;
      // Open a fresh window so a following burst leads again.
      pendingWrites.set(key, {
        trailingHandle: null,
        windowEnd: Date.now() + WRITE_THROTTLE_MS,
        latest: null,
      });
      if (pending) persist(key, pending);
    }, p.windowEnd - now);
  }
}
```

- [ ] **Step 4: Run the full cache test file to verify all pass**

Run: `npx vitest run lib/__tests__/cache.test.ts`
Expected: PASS — all read, roundtrip, and coalescing tests green.

- [ ] **Step 5: Commit**

```bash
git add lib/cache.ts lib/__tests__/cache.test.ts
git commit -m "feat(cache): leading-edge + trailing write throttle"
```

---

## Task 3: cache.ts — removeSnapshot + clearSnapshots (cancel pending)

**Files:**
- Modify: `lib/cache.ts`
- Test: `lib/__tests__/cache.test.ts`

- [ ] **Step 1: Add the failing remove/clear tests**

Append to `lib/__tests__/cache.test.ts`:

```ts
describe('removeSnapshot', () => {
  it('removes a single slot and leaves others', async () => {
    writeSnapshot(UID, 'session', { a: 1 });
    writeSnapshot(UID, 'pool-1', { b: 2 });
    removeSnapshot(UID, 'session');
    expect(await readSnapshot(UID, 'session')).toBeNull();
    expect(await readSnapshot(UID, 'pool-1')).toEqual({ b: 2 });
  });
});

describe('clearSnapshots', () => {
  beforeEach(() => {
    store.map[`quiniela.cache.${UID}.${CACHE_VERSION}.session`] = envelopeFor(
      UID,
      'session',
      { a: 1 },
    );
    store.map[`quiniela.cache.${UID}.${CACHE_VERSION}.pool-1`] = envelopeFor(
      UID,
      'pool-1',
      { b: 2 },
    );
    // An orphaned old-version key for the same user.
    store.map[`quiniela.cache.${UID}.0.session`] = '{"v":0}';
    // Unrelated keys that MUST survive.
    store.map['quiniela.lang'] = 'es';
    store.map['sb-localhost-auth-token'] = 'tok';
    // A different user's key.
    store.map[`quiniela.cache.user-2.${CACHE_VERSION}.session`] = envelopeFor(
      'user-2',
      'session',
      { c: 3 },
    );
  });

  it('removes all cache keys for the user across versions', async () => {
    await clearSnapshots(UID);
    expect(store.map[`quiniela.cache.${UID}.${CACHE_VERSION}.session`]).toBeUndefined();
    expect(store.map[`quiniela.cache.${UID}.${CACHE_VERSION}.pool-1`]).toBeUndefined();
    expect(store.map[`quiniela.cache.${UID}.0.session`]).toBeUndefined();
  });

  it('leaves lang, supabase, and other users untouched', async () => {
    await clearSnapshots(UID);
    expect(store.map['quiniela.lang']).toBe('es');
    expect(store.map['sb-localhost-auth-token']).toBe('tok');
    expect(
      store.map[`quiniela.cache.user-2.${CACHE_VERSION}.session`],
    ).toBeDefined();
  });

  it('calls multiRemove with exactly the user cache keys', async () => {
    await clearSnapshots(UID);
    expect(AsyncStorage.multiRemove).toHaveBeenCalledTimes(1);
    const passed = vi.mocked(AsyncStorage.multiRemove).mock.calls[0][0];
    expect(passed).toHaveLength(3);
    expect(passed).toEqual(
      expect.arrayContaining([
        `quiniela.cache.${UID}.${CACHE_VERSION}.session`,
        `quiniela.cache.${UID}.${CACHE_VERSION}.pool-1`,
        `quiniela.cache.${UID}.0.session`,
      ]),
    );
  });

  it('is idempotent — a second call does not throw or re-remove', async () => {
    await clearSnapshots(UID);
    await clearSnapshots(UID);
    // Second call: matching keys already gone, so multiRemove fires only once.
    expect(AsyncStorage.multiRemove).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when userId is undefined', async () => {
    await clearSnapshots(undefined);
    expect(AsyncStorage.multiRemove).not.toHaveBeenCalled();
  });

  it('cancels a pending trailing write before clearing', async () => {
    // Inline fake timers here (not in beforeEach) so the describe's key-seeding
    // above runs under real Date.now() and stays within MAX_CACHE_AGE_MS.
    vi.useFakeTimers();
    writeSnapshot(UID, 'pool-1', { n: 1 }); // leading
    writeSnapshot(UID, 'pool-1', { n: 2 }); // schedules trailing
    await clearSnapshots(UID); // must cancel the trailing AND remove keys
    await vi.advanceTimersByTimeAsync(300); // trailing must NOT re-create the key
    expect(
      store.map[`quiniela.cache.${UID}.${CACHE_VERSION}.pool-1`],
    ).toBeUndefined();
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `npx vitest run lib/__tests__/cache.test.ts -t "clearSnapshots"`
Expected: FAIL — "cancels a pending trailing write" fails because the placeholder `clearSnapshots` does not cancel pending timers, so the trailing write re-creates the key.

- [ ] **Step 3: Implement `removeSnapshot` + `clearSnapshots` with pending-cancel**

In `lib/cache.ts`, replace the placeholder `removeSnapshot` and `clearSnapshots` with:

```ts
/** Cancel any pending trailing write for a key. */
function cancelPending(key: string): void {
  const p = pendingWrites.get(key);
  if (p?.trailingHandle) clearTimeout(p.trailingHandle);
  pendingWrites.delete(key);
}

/**
 * Remove a single (userId, slot) key for the current CACHE_VERSION and cancel any
 * pending write for it. Fire-and-forget; errors swallowed. Used for pool-switch
 * hygiene (drop only the previous pool's slot).
 */
export function removeSnapshot(userId: string, slot: string): void {
  const key = cacheKey(userId, slot);
  cancelPending(key);
  AsyncStorage.removeItem(key).catch(() => {});
}

/**
 * Clear ALL cache keys for a user across ALL versions and cancel pending writes.
 * MUST be awaited before supabase.auth.signOut() so user B never reads user A's
 * data. No-op when userId is falsy.
 */
export async function clearSnapshots(
  userId: string | undefined,
): Promise<void> {
  if (!userId) return;
  const prefix = `quiniela.cache.${userId}.`;
  // Snapshot keys first (cancelPending mutates the map during iteration).
  for (const key of [...pendingWrites.keys()]) {
    if (key.startsWith(prefix)) cancelPending(key);
  }
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const userKeys = allKeys.filter((k) => k.startsWith(prefix));
    if (userKeys.length > 0) await AsyncStorage.multiRemove(userKeys);
  } catch {
    // Swallow: a stale key remains until next sign-out or version bump.
  }
}
```

- [ ] **Step 4: Run the full cache test file + typecheck**

Run: `npx vitest run lib/__tests__/cache.test.ts`
Expected: PASS — every cache test green.

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/cache.ts lib/__tests__/cache.test.ts
git commit -m "feat(cache): removeSnapshot + clearSnapshots with pending-write cancel"
```

---

## Task 4: Deadlock regression guard test (RED against current code)

**Files:**
- Create: `lib/__tests__/session-callback-guard.test.ts`

This test fails against the *current* `lib/providers.tsx` (its callback is declared `async` and `await`s `loadFor`). It goes green after the Task 5 rewrite. Per spec §8.2 it is committed **together with** the `providers.tsx` fix in Task 5 (atomic — the suite is never red on a landed commit), so Task 4 writes and runs it RED but does **not** commit.

- [ ] **Step 1: Write the guard test**

Create `lib/__tests__/session-callback-guard.test.ts`:

```ts
/* Regression guard for the supabase-js onAuthStateChange deadlock.
 *
 * The auth callback in SessionProvider MUST stay synchronous and contain zero
 * supabase.* calls — any supabase call inside it re-acquires the held GoTrue lock
 * and hangs the app on cold launch (spinner forever). See the spec, §2.
 *
 * Operates on raw source TEXT (not an AST): keep the callback INLINE inside the
 * onAuthStateChange( ... ) call or the extractor below grabs the wrong body.
 *
 * MUST be committed together with the fixed providers.tsx (spec §8.2) — it fails
 * against the pre-fix file. It catches an `async`/`await` callback; a supabase
 * call hidden behind an indirection (e.g. loadFor) is NOT textually visible here,
 * so keep the actual fetching out of the callback regardless.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = readFileSync(
  fileURLToPath(new URL('../providers.tsx', import.meta.url)),
  'utf8',
);

/** Extract the full onAuthStateChange( ... ) call via a balanced-paren scan. */
function authCallbackSource(src: string): string {
  const marker = 'onAuthStateChange(';
  const start = src.indexOf(marker);
  expect(start, 'onAuthStateChange( not found in providers.tsx').toBeGreaterThan(
    -1,
  );
  let depth = 0;
  let i = start + marker.length - 1; // sits on the opening '('
  for (; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')' && --depth === 0) break;
  }
  return src.slice(start, i + 1);
}

describe('onAuthStateChange callback is deadlock-safe', () => {
  const body = authCallbackSource(SRC);

  it('is not declared async', () => {
    expect(/onAuthStateChange\(\s*async/.test(SRC)).toBe(false);
  });

  it('contains no await', () => {
    expect(/\bawait\b/.test(body)).toBe(false);
  });

  it('makes no supabase.* calls', () => {
    expect(/\bsupabase\s*\./.test(body)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the guard test to confirm it fails against the current file**

Run: `npx vitest run lib/__tests__/session-callback-guard.test.ts`
Expected: FAIL — **2 of 3** assertions fail: "is not declared async" (the callback is `async`) and "contains no await" (`await loadFor(next)`). The third, "makes no supabase.* calls", **passes even now** because the supabase call lives inside `loadFor` (an indirection), not textually in the callback — a known limitation of the source-text guard (spec §8.2). The file still fails overall, which is what we need.

- [ ] **Step 3: Do NOT commit yet**

Leave the guard test uncommitted. Per spec §8.2 it must land in the **same commit** as the fixed `providers.tsx` (Task 5 Step 6), so the suite is never red on a landed commit. Proceed to Task 5.

---

## Task 5: SessionProvider rewrite — deadlock fix + cache-first

**Files:**
- Modify: `lib/providers.tsx` (the `SessionProvider` function and its imports)

`fetchProfile`, `fetchMembership`, `LangProvider`, `AppProviders`, and `useSession` are unchanged. Behavior is verified by the Task 4 guard test plus the typecheck and the manual checklist; there is no unit harness for the RN provider runtime.

- [ ] **Step 1: Add the cache import**

In `lib/providers.tsx`, below the existing `import { registerAppStateAutoRefresh, supabase } from './supabase';` line, add:

```ts
import { clearSnapshots, readSnapshot, writeSnapshot } from './cache';
```

And above the `SessionProvider` function, add the snapshot type + boot timeout:

```ts
/** What SessionProvider persists under the 'session' slot. */
interface SessionSnapshot {
  profile: Profile;
  membership: Membership | null;
}

/** Last-resort guard: force loading=false if the boot sequence never resolves. */
const BOOT_TIMEOUT_MS = 20_000;
```

- [ ] **Step 2: Replace the body of `SessionProvider` (state → signOut)**

Replace everything from `const [session, setSession] = useState<Session | null>(null);` through the end of the `signOut` `useCallback` with the following. Keep the existing `const value = useMemo(...)` and the `return <SessionContext.Provider ...>` exactly as they are.

```ts
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
```

> Note: on a first cold launch both `getSession()` and the `INITIAL_SESSION` event bump `authGen`, so the load effect may run twice; `loadSeq` makes the later run win and the duplicate is a single harmless extra fetch. This is intentionally simpler than a separate de-dup ref.

- [ ] **Step 3: Delete the now-unused `loadFor` callback**

Remove the entire old `const loadFor = useCallback(async (next: Session | null) => { ... }, []);` block — it no longer exists in the new code (its logic moved inline into the load effect). Confirm there are no remaining references to `loadFor`.

- [ ] **Step 4: Run the guard test to verify it now passes**

Run: `npx vitest run lib/__tests__/session-callback-guard.test.ts`
Expected: PASS — the callback is synchronous, has no `await`, and makes no `supabase.*` calls.

- [ ] **Step 5: Typecheck + full test suite**

Run: `npm run typecheck`
Expected: no errors (confirms `SessionSnapshot`, `readSnapshot`/`writeSnapshot`/`clearSnapshots` usage, and the removed `loadFor` all type-check).

Run: `npm test`
Expected: PASS — cache tests, guard test, and existing engine tests all green.

- [ ] **Step 6: Commit (provider fix + guard test together)**

The guard test from Task 4 lands in this same commit (spec §8.2 atomicity — it was written but not committed there).

```bash
git add lib/providers.tsx lib/__tests__/session-callback-guard.test.ts
git commit -m "fix(session): move supabase calls out of auth callback; cache-first boot"
```

---

## Task 6: PoolDataProvider rewrite — cache-first + silent revalidation

**Files:**
- Modify: `lib/data.tsx` (the `PoolDataProvider` function and its imports)

All exported hooks (`usePoolData`, `useTeams`, …, `usePendingGames`) and `applyMyGuess` keep their signatures. Verified by typecheck + existing tests + the manual checklist.

- [ ] **Step 1: Add the cache import**

In `lib/data.tsx`, below `import { supabase } from './supabase';`, add:

```ts
import { readSnapshot, removeSnapshot, writeSnapshot } from './cache';
```

- [ ] **Step 2: Add the cache payload type (next to the existing interfaces)**

Above `const PoolDataContext = createContext<PoolDataValue | null>(null);`, add:

```ts
/** Everything PoolDataProvider persists under the `pool-<poolId>` slot. */
interface PoolCachePayload {
  teams: TeamsMap;
  pool: Pool;
  games: Game[];
  members: PoolMember[];
  allGuesses: Guess[];
  tournamentId: number;
}
```

- [ ] **Step 3: Add the new refs**

Immediately after the existing `const tournamentIdRef = useRef<number | null>(null);` line, add:

```ts
  // Detects a pool switch so we can drop the previous pool's cached slot.
  const prevPoolIdRef = useRef<number | null>(null);
  // Mirrors current state for the realtime debounced cache flush.
  const latestSnapshotRef = useRef<{
    poolId: number | null;
    payload: PoolCachePayload | null;
  }>({ poolId: null, payload: null });
  // Trailing-debounce handle for realtime-driven cache writes.
  const cacheFlushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
```

- [ ] **Step 4: Update `load` to accept `{ silent }` and write the cache on success**

Replace the existing `const load = useCallback(async () => { ... }, [myId, poolId]);` with the version below. Changes: `{ silent }` argument; `setError` only when not silent; capture query results into locals; `writeSnapshot` after success.

```ts
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
```

- [ ] **Step 5: Replace the init effect with the hydrate-then-revalidate effect**

Replace the existing init effect:

```ts
  // Initial + dependency-change load.
  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);
```

with:

```ts
  // Hydrate from cache (instant), then revalidate. Keyed on [poolId] (see below).
  useEffect(() => {
    if (!poolId) {
      if (prevPoolIdRef.current !== null && myId) {
        removeSnapshot(myId, `pool-${prevPoolIdRef.current}`);
      }
      prevPoolIdRef.current = null;
      setLoading(false);
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
```

- [ ] **Step 6: Add `scheduleCacheFlush` and call it from the realtime handlers**

Directly above the realtime effect (`/* ---- realtime: patch games + guesses in place ---- */`), add:

```ts
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
      if (pid && payload && uid) {
        writeSnapshot<PoolCachePayload>(uid, `pool-${pid}`, payload);
      }
    }, 2_000);
  }, []);
```

Inside the realtime effect, call `scheduleCacheFlush()` at the end of each of the three local mutators. Update them as follows:

```ts
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
```

Update the realtime effect's dependency array and cleanup. Change the `.subscribe();` cleanup block from:

```ts
    return () => {
      supabase.removeChannel(channel);
    };
  }, [poolId]);
```

to:

```ts
    return () => {
      if (cacheFlushTimer.current) clearTimeout(cacheFlushTimer.current);
      supabase.removeChannel(channel);
    };
    // scheduleCacheFlush is reference-stable (useCallback([]) + myIdRef), so the
    // channel re-subscribes only when poolId changes — no myId-driven churn.
  }, [poolId, scheduleCacheFlush]);
```

- [ ] **Step 7: Make the AppState foreground refetch silent + add the load timeout**

Change the foreground refetch effect from `if (state === 'active') load();` to silent:

```ts
  /* ---- fallback: refetch on app foreground (silent — data already on screen) ---- */
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') load({ silent: true });
    });
    return () => sub.remove();
  }, [load]);
```

Then add a loading-timeout effect immediately after it:

```ts
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
```

- [ ] **Step 8: Typecheck + full test suite**

Run: `npm run typecheck`
Expected: no errors.

Run: `npm test`
Expected: PASS — all existing + new tests green (PoolDataProvider has no unit test; this confirms no type/regression breakage).

Run: `npm run lint`
Expected: no errors (the two `eslint-disable-next-line` comments cover the intentional dep-array exclusions).

- [ ] **Step 9: Commit**

```bash
git add lib/data.tsx
git commit -m "feat(pool-data): cache-first hydration + silent revalidation"
```

---

## Task 7: Manual cold-launch verification

**Files:** none (manual). Run on a device/Simulator with a signed-in account.

These behaviors live in the RN runtime (the GoTrue lock, AsyncStorage timing, navigation) and cannot be unit-tested. Run the spec's checklists (§8.3) and record results.

- [ ] **Step 1: Deadlock absence (Checklist A)**
  - Kill the app; cold-launch with a persisted session, 5× in a row.
  - Pass: every launch clears the spinner within ~5 s (the bug was non-deterministic; 5 clean launches is the bar).

- [ ] **Step 2: Instant boot from cache (Checklist B)**
  - Sign in, open `/(tabs)`, kill the app, enable airplane mode, cold-launch.
  - Pass: `/(tabs)` renders last-known data within ~200 ms. Disable airplane mode → data updates silently within ~2 s, no spinner.

- [ ] **Step 3: Silent revalidation swap (Checklist C)**
  - With `/(tabs)` visible, change a game score via the Supabase dashboard.
  - Pass: score updates in place within ~500 ms, no spinner/navigation. Background 30 s, foreground → changed data appears silently, no spinner (confirms the silent foreground refetch decision). Pull-to-refresh still shows its indicator.

- [ ] **Step 4: Multi-user hygiene (Checklist D)**
  - Sign in as User A → `/(tabs)`; sign out; sign in as User B; kill; cold-launch as B.
  - Pass: B only ever sees B's data. After A's sign-out, no `quiniela.cache.<A-uid>.*` keys remain (inspect via a debug screen or storage inspector).

- [ ] **Step 5: Timeout fallback (Checklist E)**
  - Debug build: set `BOOT_TIMEOUT_MS = 2000`, add a 3 s delay to `fetchProfile`, clear the cache, cold-launch.
  - Pass: spinner exits at ~2 s and routes from available state; when the delayed fetch resolves the gate re-routes correctly with no crash or double-navigation. Revert the debug patch afterward.

- [ ] **Step 6: Final full verification + done**

Run: `npm run typecheck && npm test && npm run lint`
Expected: all green.

```bash
git status   # confirm only the intended files changed
```

If all manual checks pass, the feature is complete. Use `superpowers:finishing-a-development-branch` to decide on merge/PR.

---

## Notes / Spec Coverage

- **Deadlock fix** (spec §2, §5): Task 4 (guard, RED) + Task 5 (sync callback, load moved to a `user.id`/`authGen` effect outside the lock).
- **TOKEN_REFRESHED decision** (skip refetch): Task 5 Step 2 — `authGen` bumps only on `SIGNED_IN`/`INITIAL_SESSION`.
- **Silent foreground decision**: Task 6 Step 7 — `load({ silent: true })` on AppState active; pull-to-refresh stays non-silent.
- **cache.ts** (spec §4): Tasks 1–3, fully TDD, including the leading-edge + trailing throttle and `removeSnapshot`/`clearSnapshots` with pending-cancel.
- **Cache-first session** (spec §5) and **pool** (spec §6): Tasks 5–6.
- **Multi-user hygiene / sign-out ordering** (spec §7.1): Task 5 `signOut` clears before `supabase.auth.signOut()`; Task 6 pool-switch + sign-out `removeSnapshot`.
- **Defense-in-depth timeouts** (spec §7.6): Task 5 `BOOT_TIMEOUT_MS`, Task 6 load timeout, cache `MAX_CACHE_AGE_MS`.
- **Testing** (spec §8): Tasks 1–4 automated; Task 7 manual.
