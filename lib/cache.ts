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
const WRITE_THROTTLE_MS = 300;

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
 *
 * Note: a stored `null` payload is indistinguishable from a miss — callers must
 * not persist `null` as a meaningful value.
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
