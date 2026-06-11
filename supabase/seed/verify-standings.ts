#!/usr/bin/env npx tsx
/**
 * verify-standings.ts — sanity-check standings computation against local DB.
 *
 * Signs in as sofia@quiniela.dev / devpassword (anon client), fetches
 * games + guesses + members, runs standingsWithMovement, prints the table,
 * and asserts:
 *   1. rows is non-empty
 *   2. ranks are integers ≥ 1
 *   3. tied members share the same rank
 *   4. tied flag is true when a rank is shared
 *
 * Run: npx tsx supabase/seed/verify-standings.ts
 */

import { createClient } from '@supabase/supabase-js';

// Engine function — import directly (no RN deps)
// We do a local require since we can't use path aliases in a raw tsx script.
import { standingsWithMovement } from '../../lib/engine';
import type { Game, Guess, Pool, TeamsMap } from '../../lib/types';

const SUPABASE_URL = 'http://127.0.0.1:54421';
const SUPABASE_ANON = 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: { persistSession: false },
});

async function main() {
  // 1. Sign in
  const { error: authErr } = await supabase.auth.signInWithPassword({
    email: 'sofia@quiniela.dev',
    password: 'devpassword',
  });
  if (authErr) {
    console.error('Auth failed:', authErr.message);
    process.exit(1);
  }
  console.log('✓ Signed in as sofia@quiniela.dev');

  // 2. Get membership → pool
  const { data: memRows, error: memErr } = await supabase
    .from('memberships')
    .select('pool_id, user_id, role, hidden')
    .eq('hidden', false)
    .limit(1)
    .maybeSingle();
  if (memErr || !memRows) { console.error('No membership:', memErr?.message); process.exit(1); }
  const poolId = memRows.pool_id;

  const { data: poolRow, error: poolErr } = await supabase
    .from('pools')
    .select('id, tournament_id, pts_full, pts_partial')
    .eq('id', poolId)
    .maybeSingle();
  if (poolErr || !poolRow) { console.error('No pool:', poolErr?.message); process.exit(1); }
  const pool = poolRow as Pool;

  // 3. Fetch all members
  const { data: memberRows, error: mbErr } = await supabase
    .from('memberships')
    .select('user_id, role, hidden, profiles!inner(name, emoji)')
    .eq('pool_id', poolId)
    .eq('hidden', false);
  if (mbErr) { console.error('Members error:', mbErr.message); process.exit(1); }

  const members = (memberRows ?? []).map((m: { user_id: string; profiles: { name: string; emoji: string | null } | { name: string; emoji: string | null }[] }) => ({
    id: m.user_id,
    name: Array.isArray(m.profiles) ? m.profiles[0]?.name : (m.profiles as { name: string }).name,
    emoji: Array.isArray(m.profiles) ? m.profiles[0]?.emoji : (m.profiles as { emoji: string | null }).emoji,
  }));

  // 4. Fetch games
  const { data: gameRows, error: gErr } = await supabase
    .from('games')
    .select('*')
    .eq('tournament_id', pool.tournament_id)
    .order('kickoff', { ascending: true });
  if (gErr) { console.error('Games error:', gErr.message); process.exit(1); }
  const games = (gameRows ?? []) as Game[];

  // 5. Fetch all guesses for the pool
  const { data: guessRows, error: guessErr } = await supabase
    .from('guesses')
    .select('pool_id, user_id, game_id, home, away, advancer, points, tag, updated_at')
    .eq('pool_id', poolId);
  if (guessErr) { console.error('Guesses error:', guessErr.message); process.exit(1); }

  // Build AllPicks map
  const allPicks: Record<number, Record<string, { home: number; away: number; advancer: string | null }>> = {};
  for (const g of (guessRows ?? []) as Guess[]) {
    (allPicks[g.game_id] ??= {})[g.user_id] = { home: g.home, away: g.away, advancer: g.advancer };
  }

  // 6. Compute standings
  const now = new Date();
  const rows = standingsWithMovement(
    members,
    games,
    allPicks,
    now,
    pool.pts_full,
    pool.pts_partial,
  );

  // 7. Print table
  console.log('\n=== Leaderboard ===');
  for (const r of rows) {
    const mb = members.find((m) => m.id === r.id);
    const rankStr = (r.tied ? 'T-' : '') + r.rank;
    const moveStr = r.move > 0 ? '▲' : r.move < 0 ? '▼' : '–';
    console.log(
      `${rankStr.padEnd(5)} ${(mb?.name ?? r.id).padEnd(15)} pts=${r.pts} exact=${r.exact} move=${moveStr}`,
    );
  }

  // 8. Assertions
  if (rows.length === 0) {
    console.error('\n✗ FAIL: standings is empty!');
    process.exit(1);
  }
  console.log(`\n✓ ${rows.length} rows in standings`);

  // All ranks ≥ 1
  const badRank = rows.find((r) => r.rank < 1);
  if (badRank) {
    console.error('✗ FAIL: rank < 1 found:', badRank);
    process.exit(1);
  }
  console.log('✓ All ranks ≥ 1');

  // Tied members share rank
  const rankGroups: Record<number, typeof rows> = {};
  for (const r of rows) {
    (rankGroups[r.rank] ??= []).push(r);
  }
  for (const [rank, group] of Object.entries(rankGroups)) {
    if (group.length > 1) {
      const allTied = group.every((r) => r.tied);
      if (!allTied) {
        console.error(`✗ FAIL: rank ${rank} has ${group.length} members but tied flag missing`);
        process.exit(1);
      }
    } else {
      if (group[0].tied) {
        console.error(`✗ FAIL: rank ${rank} has only 1 member but tied=true`);
        process.exit(1);
      }
    }
  }
  console.log('✓ Tied flags correct for all ranks');

  // Points sorted descending
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].pts > rows[i - 1].pts) {
      console.error('✗ FAIL: standings not sorted by pts desc');
      process.exit(1);
    }
  }
  console.log('✓ Standings sorted by pts desc');

  console.log('\n✓ All assertions passed.');
  process.exit(0);
}

main();
