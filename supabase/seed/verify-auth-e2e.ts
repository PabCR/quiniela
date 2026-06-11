/* supabase/seed/verify-auth-e2e.ts
 *
 * REAL end-to-end auth verification against the LOCAL Supabase stack.
 * Run: npx tsx supabase/seed/verify-auth-e2e.ts
 *
 * Flow exercised (mirrors app/auth/*):
 *   1. Ensure a pool with a known invite code exists (service-role; idempotent).
 *   2. check_invite_code: wrong code -> false, right code -> true (anon).
 *   3. signInWithOtp(test email) -> fetch the 6-digit token from Mailpit API.
 *   4. verifyOtp -> assert a session is returned.
 *   5. join_pool happy path -> assert a membership row exists.
 *   6. join_pool duplicate-name (second user, same name) -> 23505.
 *   7. join_pool bad invite code -> 22023.
 *
 * Self-contained: creates its own throwaway users/pool; safe to re-run.
 */

import { createClient } from '@supabase/supabase-js';

const API_URL = 'http://127.0.0.1:54421';
const MAILPIT_URL = 'http://127.0.0.1:54424';
const ANON_KEY = 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';
const SERVICE_KEY = 'sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz';

const INVITE_CODE = 'VERIFY';
const POOL_NAME = 'Verify Pool';

const ok: string[] = [];
const fail: string[] = [];
function check(label: string, cond: boolean, detail = '') {
  (cond ? ok : fail).push(`${cond ? 'PASS' : 'FAIL'}: ${label}${detail ? ` — ${detail}` : ''}`);
  console.log(`${cond ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`);
}

const admin = createClient(API_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** Ensure a tournament + pool with INVITE_CODE exist. Returns pool id. */
async function ensurePool(): Promise<number> {
  // Tournament
  let { data: t } = await admin
    .from('tournaments')
    .select('id')
    .eq('name', 'Verify Tournament')
    .maybeSingle();
  if (!t) {
    const ins = await admin
      .from('tournaments')
      .insert({ name: 'Verify Tournament' })
      .select('id')
      .single();
    if (ins.error) throw new Error(`tournament insert: ${ins.error.message}`);
    t = ins.data;
  }
  // Pool
  let { data: p } = await admin
    .from('pools')
    .select('id')
    .eq('invite_code', INVITE_CODE)
    .maybeSingle();
  if (!p) {
    const ins = await admin
      .from('pools')
      .insert({
        tournament_id: t!.id,
        name: POOL_NAME,
        invite_code: INVITE_CODE,
      })
      .select('id')
      .single();
    if (ins.error) throw new Error(`pool insert: ${ins.error.message}`);
    p = ins.data;
  }
  return p!.id;
}

/** Poll the Mailpit API for the latest message to `email`; return its 6-digit OTP. */
async function fetchOtpFromMailpit(email: string): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const res = await fetch(
      `${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent('to:' + email)}`,
    );
    if (res.ok) {
      const json = (await res.json()) as { messages?: { ID: string }[] };
      const msg = json.messages?.[0];
      if (msg) {
        const detail = await fetch(`${MAILPIT_URL}/api/v1/message/${msg.ID}`);
        const body = (await detail.json()) as { Text?: string; HTML?: string };
        const haystack = `${body.Text ?? ''}\n${body.HTML ?? ''}`;
        const m = haystack.match(/\b(\d{6})\b/);
        if (m) return m[1];
      }
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`No OTP email found for ${email} within timeout`);
}

/** A fresh anon client (one per user, like an app install). */
function anonClient() {
  return createClient(API_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function signInAndVerify(email: string) {
  const client = anonClient();
  const { error: otpErr } = await client.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true },
  });
  if (otpErr) throw new Error(`signInWithOtp(${email}): ${otpErr.message}`);
  const token = await fetchOtpFromMailpit(email);
  const { data, error: vErr } = await client.auth.verifyOtp({
    email,
    token,
    type: 'email',
  });
  if (vErr) throw new Error(`verifyOtp(${email}): ${vErr.message}`);
  return { client, session: data.session, token };
}

async function main() {
  const stamp = Date.now();
  const userA = `verify_a_${stamp}@quiniela.test`;
  const userB = `verify_b_${stamp}@quiniela.test`;
  const sharedName = `Tester ${stamp}`;

  const poolId = await ensurePool();
  check('ensurePool returns a pool id', typeof poolId === 'number', `poolId=${poolId}`);

  // --- check_invite_code (anon) ---
  const anon = anonClient();
  const wrong = await anon.rpc('check_invite_code', { p_code: 'ZZZZZZ' });
  check('check_invite_code wrong -> false', wrong.data === false, `data=${JSON.stringify(wrong.data)}`);

  const right = await anon.rpc('check_invite_code', { p_code: INVITE_CODE });
  check('check_invite_code right -> true', right.data === true, `data=${JSON.stringify(right.data)}`);

  // lowercase + whitespace should still validate (server upper/trims)
  const loose = await anon.rpc('check_invite_code', { p_code: ` ${INVITE_CODE.toLowerCase()} ` });
  check('check_invite_code is case/space-insensitive', loose.data === true, `data=${JSON.stringify(loose.data)}`);

  // --- OTP sign-in (user A) ---
  const a = await signInAndVerify(userA);
  check('verifyOtp(A) returns a session', !!a.session, a.token ? `token=${a.token}` : 'no token');

  // --- join_pool happy path (user A) ---
  const joinA = await a.client.rpc('join_pool', {
    p_invite_code: INVITE_CODE,
    p_display_name: sharedName,
    p_emoji: '🦊',
  });
  check('join_pool(A) happy path succeeds', !joinA.error, joinA.error?.message ?? '');

  // membership row exists for A
  const memA = await a.client
    .from('memberships')
    .select('pool_id, user_id, role, hidden')
    .eq('user_id', a.session!.user.id)
    .maybeSingle();
  check('membership row exists for A', !!memA.data, JSON.stringify(memA.data));
  check('A membership role is player', memA.data?.role === 'player', `role=${memA.data?.role}`);

  // profile row exists for A with name + emoji
  const profA = await a.client
    .from('profiles')
    .select('id, name, emoji')
    .eq('id', a.session!.user.id)
    .maybeSingle();
  check('profile row exists for A with name', profA.data?.name === sharedName, JSON.stringify(profA.data));

  // --- duplicate name rejection (user B, same name) ---
  const b = await signInAndVerify(userB);
  check('verifyOtp(B) returns a session', !!b.session);

  const dupB = await b.client.rpc('join_pool', {
    p_invite_code: INVITE_CODE,
    p_display_name: sharedName, // same as A
    p_emoji: null,
  });
  check(
    'join_pool(B) duplicate name -> 23505',
    (dupB.error as { code?: string } | null)?.code === '23505',
    dupB.error ? `code=${(dupB.error as { code?: string }).code}` : 'NO ERROR (unexpected)',
  );

  // --- bad invite code rejection (user B, valid auth, wrong code) ---
  const badB = await b.client.rpc('join_pool', {
    p_invite_code: 'NOPE00',
    p_display_name: `Tester B ${stamp}`,
    p_emoji: null,
  });
  check(
    'join_pool(B) bad invite code -> 22023',
    (badB.error as { code?: string } | null)?.code === '22023',
    badB.error ? `code=${(badB.error as { code?: string }).code}` : 'NO ERROR (unexpected)',
  );

  // B can now join legitimately with a distinct name
  const joinB = await b.client.rpc('join_pool', {
    p_invite_code: INVITE_CODE,
    p_display_name: `Tester B ${stamp}`,
    p_emoji: '⚽',
  });
  check('join_pool(B) distinct name succeeds', !joinB.error, joinB.error?.message ?? '');

  // --- summary ---
  console.log('\n──────── SUMMARY ────────');
  console.log(`PASS: ${ok.length}  FAIL: ${fail.length}`);
  if (fail.length) {
    fail.forEach((f) => console.log(f));
    process.exit(1);
  }
  console.log('ALL CHECKS PASSED');
}

main().catch((e) => {
  console.error('❌ FATAL:', e instanceof Error ? e.message : e);
  process.exit(1);
});
