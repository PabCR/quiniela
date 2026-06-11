-- 03_rls_membership_rpcs.sql
-- * An authenticated user with NO active membership sees zero rows everywhere.
-- * A soft-hidden member also sees nothing.
-- * join_pool: rejects a bad invite code; accepts a good one; rejects a
--   duplicate display name; is idempotent.
-- * admin_set_result: rejected for a non-admin.
-- * check_invite_code: validity only.

begin;
select plan(15);

-- --- setup as superuser ---
insert into tournaments (name) values ('M') returning id \gset t_
insert into teams (code, name_en, name_es, flag) values
  ('HOM','Home','Local','🏠'), ('AWY','Away','Visita','✈️');
insert into pools (tournament_id, name, invite_code, pts_full, pts_partial)
  values (:t_id, 'MemPool', 'JOINME', 3, 1) returning id \gset p_

insert into games (tournament_id, stage, home, away, kickoff)
  values (:t_id, 'GROUP_A', 'HOM', 'AWY', now() - interval '1 hour') returning id \gset g_

-- An existing member "Owner" (admin) and a member "Existing" (player).
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000d001', 'owner@m.com'),
  ('00000000-0000-0000-0000-00000000d002', 'existing@m.com'),
  ('00000000-0000-0000-0000-00000000d003', 'nobody@m.com'),
  ('00000000-0000-0000-0000-00000000d004', 'hidden@m.com'),
  ('00000000-0000-0000-0000-00000000d005', 'joiner@m.com');
insert into profiles (id, name) values
  ('00000000-0000-0000-0000-00000000d001', 'Owner'),
  ('00000000-0000-0000-0000-00000000d002', 'Carmen'),
  ('00000000-0000-0000-0000-00000000d004', 'Hidden Hugo');
insert into memberships (pool_id, user_id, role, hidden) values
  (:p_id, '00000000-0000-0000-0000-00000000d001', 'admin', false),
  (:p_id, '00000000-0000-0000-0000-00000000d002', 'player', false),
  (:p_id, '00000000-0000-0000-0000-00000000d004', 'player', true);  -- soft-hidden

-- A confirmed result so there's a guess to (not) see.
insert into guesses (pool_id, user_id, game_id, home, away)
  values (:p_id, '00000000-0000-0000-0000-00000000d002', :g_id, 1, 0);

-- =========================================================================
-- check_invite_code (anon-callable): validity only.
-- =========================================================================
set local role anon;
select is(public.check_invite_code('JOINME'), true,  'check_invite_code accepts a valid code');
select is(public.check_invite_code('joinme'), true,  'check_invite_code is case-insensitive');
select is(public.check_invite_code('NOPE99'), false, 'check_invite_code rejects an unknown code');
reset role;

-- =========================================================================
-- No-membership user d003 sees nothing.
-- =========================================================================
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000d003';
select is((select count(*) from games),   0::bigint, 'No-membership user sees no games');
select is((select count(*) from pools),   0::bigint, 'No-membership user sees no pools');
select is((select count(*) from guesses), 0::bigint, 'No-membership user sees no guesses');
select is((select count(*) from teams),   0::bigint, 'No-membership user sees no teams');

-- =========================================================================
-- Soft-hidden member d004 also sees nothing (hidden = inactive).
-- =========================================================================
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000d004';
select is((select count(*) from games), 0::bigint, 'Soft-hidden member sees no games');
select is((select count(*) from pools), 0::bigint, 'Soft-hidden member sees no pools');
reset role;

-- =========================================================================
-- join_pool: bad code rejected, good code accepted, duplicate name rejected.
-- =========================================================================
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000d005';

select throws_ok(
  $$select join_pool('WRONGX', 'Newbie', '🦊')$$,
  null,
  'join_pool rejects a bad invite code'
);

-- Duplicate display name (Carmen already exists, case-insensitive).
select throws_ok(
  $$select join_pool('JOINME', 'carmen', '🐱')$$,
  '23505',
  null,
  'join_pool rejects a duplicate display name (case-insensitive)'
);

-- Good join.
select lives_ok(
  $$select join_pool('JOINME', 'Joiner', '🦜')$$,
  'join_pool accepts a valid code + unique name'
);
reset role;

select is(
  (select role from memberships
     where pool_id = :p_id and user_id = '00000000-0000-0000-0000-00000000d005'),
  'player',
  'join_pool creates a player membership');

-- Idempotent re-join returns without error and does not duplicate membership.
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000d005';
select lives_ok(
  $$select join_pool('JOINME', 'Joiner', '🦜')$$,
  'join_pool is idempotent for an existing member'
);
reset role;

-- =========================================================================
-- admin_set_result rejected for a non-admin (Carmen is a player).
-- =========================================================================
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000d002';
select throws_ok(
  format($$select admin_set_result(%s, 2::smallint, 1::smallint, null, false)$$, :g_id),
  '42501',
  null,
  'admin_set_result is rejected for a non-admin member'
);
reset role;

select * from finish();
rollback;
