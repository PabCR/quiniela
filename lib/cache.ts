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
