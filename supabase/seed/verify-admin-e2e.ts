/**
 * verify-admin-e2e.ts — E2E verification for admin screens (brief §9).
 *
 * Run with: npx tsx supabase/seed/verify-admin-e2e.ts
 *
 * Tests:
 *   1. Sign in as admin (palv2602@gmail.com) + find the 'awaiting' game (dev-m3)
 *   2. admin_set_result → result confirmed, points/tags recomputed
 *   3. Edit the same result → corrected=true, points restamped
 *   4. Void another game (dev-m4) → points nulled
 *   5. rotate_invite_code → code changed
 *   6. set_member_hidden → hidden=true
 *   7. Sign in as sofia@quiniela.dev → each admin RPC fails with 42501
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'http://127.0.0.1:54421';
const ANON_KEY = 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';

const ADMIN_EMAIL = 'palv2602@gmail.com';
const PLAYER_EMAIL = 'sofia@quiniela.dev';
const PASSWORD = 'devpassword';

function pass(msg: string) {
  console.log('  ✓', msg);
}

function fail(msg: string) {
  console.error('  ✗', msg);
  process.exitCode = 1;
}

function assertEq<T>(label: string, actual: T, expected: T) {
  if (actual === expected) {
    pass(`${label}: ${JSON.stringify(actual)}`);
  } else {
    fail(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertNull(label: string, val: unknown) {
  if (val === null || val === undefined) {
    pass(`${label}: null/undefined as expected`);
  } else {
    fail(`${label}: expected null, got ${JSON.stringify(val)}`);
  }
}

async function run() {
  console.log('\n=== Quiniela Admin E2E Verification ===\n');

  // ─── ADMIN SESSION ───────────────────────────────────────────────────────────
  const adminClient = createClient(SUPABASE_URL, ANON_KEY);
  console.log('1. Sign in as admin (palv2602@gmail.com)...');
  const { data: adminAuth, error: adminAuthErr } = await adminClient.auth.signInWithPassword({
    email: ADMIN_EMAIL,
    password: PASSWORD,
  });
  if (adminAuthErr || !adminAuth.session) {
    fail('Admin sign-in failed: ' + (adminAuthErr?.message ?? 'no session'));
    process.exit(1);
  }
  pass('Admin signed in: ' + adminAuth.user?.email);

  // Find the pool
  const { data: poolData, error: poolErr } = await adminClient
    .from('pools')
    .select('id, invite_code, pts_full, pts_partial')
    .single();
  if (poolErr || !poolData) {
    fail('Could not fetch pool: ' + poolErr?.message);
    process.exit(1);
  }
  const poolId = poolData.id as number;
  const originalCode = poolData.invite_code as string;
  pass('Pool found: ' + poolId + ', invite_code: ' + originalCode);

  // Find the awaiting game (dev-m3: USA vs PAR, no result)
  const { data: awaitingGames, error: awaitingErr } = await adminClient
    .from('games')
    .select('id, external_id, stage, home, away, result_status, score_home, score_away')
    .eq('external_id', 'dev-m3')
    .single();
  if (awaitingErr || !awaitingGames) {
    fail('Could not find dev-m3 game: ' + awaitingErr?.message);
    process.exit(1);
  }
  const gameId = awaitingGames.id as number;
  pass('Found awaiting game dev-m3 (id=' + gameId + '): ' + awaitingGames.home + ' vs ' + awaitingGames.away);

  // Find the live game (dev-m4: QAT vs SUI) for voiding later
  const { data: liveGame } = await adminClient
    .from('games')
    .select('id, external_id, home, away')
    .eq('external_id', 'dev-m4')
    .single();
  const liveGameId = liveGame?.id as number;
  pass('Found live game dev-m4 (id=' + liveGameId + '): ' + liveGame?.home + ' vs ' + liveGame?.away);

  // ─── TEST 2: admin_set_result on dev-m3 ──────────────────────────────────────
  console.log('\n2. admin_set_result → USA 2-0 PAR...');
  const { error: setResultErr } = await adminClient.rpc('admin_set_result', {
    p_game_id: gameId,
    p_home: 2,
    p_away: 0,
    p_advancer: null,
    p_void: false,
  });
  if (setResultErr) {
    fail('admin_set_result failed: ' + setResultErr.message);
    process.exit(1);
  }
  pass('admin_set_result succeeded');

  // Verify the game is now confirmed
  const { data: confirmedGame } = await adminClient
    .from('games')
    .select('result_status, score_home, score_away, corrected, voided')
    .eq('id', gameId)
    .single();
  assertEq('result_status', confirmedGame?.result_status, 'confirmed');
  assertEq('score_home', confirmedGame?.score_home, 2);
  assertEq('score_away', confirmedGame?.score_away, 0);
  assertEq('corrected (initial)', confirmedGame?.corrected, false);
  assertEq('voided', confirmedGame?.voided, false);

  // Verify points recomputed: pablo picked 2-0 → exact (3 pts)
  const { data: pabloGuess } = await adminClient
    .from('guesses')
    .select('points, tag')
    .eq('game_id', gameId)
    .eq('user_id', '00000000-0000-0000-0000-000000000001')
    .single();
  assertEq('pablo points (exact: 2-0 pick = 2-0 result)', pabloGuess?.points, 3);
  assertEq('pablo tag', pabloGuess?.tag, 'exact');

  // carmen picked 1-0 → home wins, correct outcome (1 pt)
  const { data: carmenGuess } = await adminClient
    .from('guesses')
    .select('points, tag')
    .eq('game_id', gameId)
    .eq('user_id', '00000000-0000-0000-0000-000000000002')
    .single();
  assertEq('carmen points (outcome: 1-0 pick, 2-0 result)', carmenGuess?.points, 1);
  assertEq('carmen tag', carmenGuess?.tag, 'outcome');

  // jose picked 2-1 → home wins, correct outcome (1 pt)
  const { data: joseGuess } = await adminClient
    .from('guesses')
    .select('points, tag')
    .eq('game_id', gameId)
    .eq('user_id', '00000000-0000-0000-0000-000000000003')
    .single();
  assertEq('jose points (outcome: 2-1 pick, 2-0 result)', joseGuess?.points, 1);
  assertEq('jose tag', joseGuess?.tag, 'outcome');

  // ─── TEST 3: Edit the same result → corrected=true ───────────────────────────
  console.log('\n3. Edit result → USA 1-0 PAR (should stamp corrected=true)...');
  const { error: editErr } = await adminClient.rpc('admin_set_result', {
    p_game_id: gameId,
    p_home: 1,
    p_away: 0,
    p_advancer: null,
    p_void: false,
  });
  if (editErr) {
    fail('Edit admin_set_result failed: ' + editErr.message);
    process.exit(1);
  }
  pass('Edit admin_set_result succeeded');

  const { data: editedGame } = await adminClient
    .from('games')
    .select('result_status, score_home, score_away, corrected')
    .eq('id', gameId)
    .single();
  assertEq('result_status after edit', editedGame?.result_status, 'confirmed');
  assertEq('score_home after edit', editedGame?.score_home, 1);
  assertEq('corrected after edit', editedGame?.corrected, true);

  // Points should be restamped — pablo picked 2-0, result now 1-0 → still outcome
  const { data: pabloGuessAfterEdit } = await adminClient
    .from('guesses')
    .select('points, tag')
    .eq('game_id', gameId)
    .eq('user_id', '00000000-0000-0000-0000-000000000001')
    .single();
  assertEq('pablo points after edit (outcome: 2-0 pick, 1-0 result)', pabloGuessAfterEdit?.points, 1);
  assertEq('pablo tag after edit', pabloGuessAfterEdit?.tag, 'outcome');

  // ─── TEST 4: Void dev-m4 → points nulled ─────────────────────────────────────
  console.log('\n4. Void game dev-m4 (QAT vs SUI)...');
  const { error: voidErr } = await adminClient.rpc('admin_set_result', {
    p_game_id: liveGameId,
    p_home: 0,
    p_away: 0,
    p_advancer: null,
    p_void: true,
  });
  if (voidErr) {
    fail('Void admin_set_result failed: ' + voidErr.message);
    process.exit(1);
  }
  pass('Void succeeded');

  const { data: voidedGame } = await adminClient
    .from('games')
    .select('voided')
    .eq('id', liveGameId)
    .single();
  assertEq('game voided', voidedGame?.voided, true);

  // Check that existing guesses for dev-m4 have null points
  const { data: voidedGuesses } = await adminClient
    .from('guesses')
    .select('points, tag')
    .eq('game_id', liveGameId);
  if (voidedGuesses && voidedGuesses.length > 0) {
    const allNull = voidedGuesses.every((g: { points: unknown; tag: unknown }) => g.points === null && g.tag === null);
    if (allNull) {
      pass('All guesses for voided game have null points/tag (' + voidedGuesses.length + ' rows)');
    } else {
      fail('Some guesses still have non-null points after void');
    }
  } else {
    pass('No guesses for dev-m4 (or all cleared)');
  }

  // ─── TEST 5: rotate_invite_code ──────────────────────────────────────────────
  console.log('\n5. rotate_invite_code...');
  const { data: newCode, error: rotateErr } = await adminClient.rpc('rotate_invite_code', {
    p_pool_id: poolId,
  });
  if (rotateErr) {
    fail('rotate_invite_code failed: ' + rotateErr.message);
    process.exit(1);
  }
  pass('rotate_invite_code returned: ' + newCode);
  if (newCode !== originalCode) {
    pass('New code differs from original (' + originalCode + ' → ' + newCode + ')');
  } else {
    fail('New code is the same as original — rotate had no effect');
  }

  // Verify pool has new code
  const { data: updatedPool } = await adminClient
    .from('pools')
    .select('invite_code')
    .eq('id', poolId)
    .single();
  assertEq('pool invite_code updated', updatedPool?.invite_code, newCode);

  // ─── TEST 6: set_member_hidden ───────────────────────────────────────────────
  console.log('\n6. set_member_hidden (sofia = user 7)...');
  const sofiaId = '00000000-0000-0000-0000-000000000007';
  const { error: hideErr } = await adminClient.rpc('set_member_hidden', {
    p_pool_id: poolId,
    p_user_id: sofiaId,
    p_hidden: true,
  });
  if (hideErr) {
    fail('set_member_hidden failed: ' + hideErr.message);
    process.exit(1);
  }
  pass('set_member_hidden succeeded');

  const { data: sofiaMs } = await adminClient
    .from('memberships')
    .select('hidden')
    .eq('pool_id', poolId)
    .eq('user_id', sofiaId)
    .single();
  assertEq('sofia hidden', sofiaMs?.hidden, true);

  // Restore hidden so the test is idempotent
  await adminClient.rpc('set_member_hidden', {
    p_pool_id: poolId,
    p_user_id: sofiaId,
    p_hidden: false,
  });
  pass('Restored sofia hidden=false');

  // ─── TEST 7: Non-admin (sofia) cannot call admin RPCs ────────────────────────
  console.log('\n7. Sign in as sofia@quiniela.dev and attempt admin RPCs...');
  const playerClient = createClient(SUPABASE_URL, ANON_KEY);
  const { data: playerAuth, error: playerAuthErr } = await playerClient.auth.signInWithPassword({
    email: PLAYER_EMAIL,
    password: PASSWORD,
  });
  if (playerAuthErr || !playerAuth.session) {
    fail('Player sign-in failed: ' + (playerAuthErr?.message ?? 'no session'));
    process.exit(1);
  }
  pass('Sofia signed in: ' + playerAuth.user?.email);

  // admin_set_result should fail with 42501
  const { error: playerSetResultErr } = await playerClient.rpc('admin_set_result', {
    p_game_id: gameId,
    p_home: 3,
    p_away: 0,
    p_advancer: null,
    p_void: false,
  });
  if (playerSetResultErr) {
    const code = (playerSetResultErr as { code?: string }).code;
    if (code === '42501') {
      pass('admin_set_result correctly blocked for player (42501)');
    } else {
      fail('admin_set_result failed but wrong code: ' + code + ' / ' + playerSetResultErr.message);
    }
  } else {
    fail('admin_set_result should have been blocked for non-admin');
  }

  // rotate_invite_code should fail with 42501
  const { error: playerRotateErr } = await playerClient.rpc('rotate_invite_code', {
    p_pool_id: poolId,
  });
  if (playerRotateErr) {
    const code = (playerRotateErr as { code?: string }).code;
    if (code === '42501') {
      pass('rotate_invite_code correctly blocked for player (42501)');
    } else {
      fail('rotate_invite_code failed but wrong code: ' + code + ' / ' + playerRotateErr.message);
    }
  } else {
    fail('rotate_invite_code should have been blocked for non-admin');
  }

  // set_member_hidden should fail with 42501
  const { error: playerHideErr } = await playerClient.rpc('set_member_hidden', {
    p_pool_id: poolId,
    p_user_id: sofiaId,
    p_hidden: true,
  });
  if (playerHideErr) {
    const code = (playerHideErr as { code?: string }).code;
    if (code === '42501') {
      pass('set_member_hidden correctly blocked for player (42501)');
    } else {
      fail('set_member_hidden failed but wrong code: ' + code + ' / ' + playerHideErr.message);
    }
  } else {
    fail('set_member_hidden should have been blocked for non-admin');
  }

  // ─── DONE ────────────────────────────────────────────────────────────────────
  console.log('\n=== All admin E2E checks complete ===\n');
  if (process.exitCode === 1) {
    console.error('Some checks FAILED. Review the output above.');
  } else {
    console.log('All checks PASSED.');
  }
}

run().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
