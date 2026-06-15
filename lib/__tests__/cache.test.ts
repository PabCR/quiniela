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

describe('removeSnapshot', () => {
  it('removes a single slot and leaves others', async () => {
    writeSnapshot(UID, 'session', { a: 1 });
    writeSnapshot(UID, 'pool-1', { b: 2 });
    removeSnapshot(UID, 'session');
    expect(await readSnapshot(UID, 'session')).toBeNull();
    expect(await readSnapshot(UID, 'pool-1')).toEqual({ b: 2 });
  });

  it('cancels a pending trailing write before removing', async () => {
    vi.useFakeTimers();
    writeSnapshot(UID, 'session', { a: 1 }); // leading — writes immediately
    writeSnapshot(UID, 'session', { a: 2 }); // schedules trailing
    removeSnapshot(UID, 'session');
    await vi.advanceTimersByTimeAsync(300); // trailing must NOT re-create the key
    expect(
      store.map[`quiniela.cache.${UID}.${CACHE_VERSION}.session`],
    ).toBeUndefined();
    vi.useRealTimers();
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
