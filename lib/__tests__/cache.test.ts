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
