-- 04_admin_policies.sql
-- rotate_invite_code, set_member_hidden, pools pts-config UPDATE policy
-- (admin + unlocked only), and guess-insert rejection on a voided game.

begin;
select plan(12);

insert into tournaments (name) values ('AP') returning id \gset t_
insert into teams (code, name_en, name_es, flag) values
  ('HOM','Home','Local','🏠'), ('AWY','Away','Visita','✈️');
insert into pools (tournament_id, name, invite_code, pts_full, pts_partial)
  values (:t_id, 'AdminPool', 'ADMIN1', 3, 1) returning id \gset p_

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000e001', 'admin@ap.com'),
  ('00000000-0000-0000-0000-00000000e002', 'player@ap.com');
insert into profiles (id, name) values
  ('00000000-0000-0000-0000-00000000e001', 'Admin'),
  ('00000000-0000-0000-0000-00000000e002', 'Player');
insert into memberships (pool_id, user_id, role) values
  (:p_id, '00000000-0000-0000-0000-00000000e001', 'admin'),
  (:p_id, '00000000-0000-0000-0000-00000000e002', 'player');

-- A future and a voided game for the guesses policy checks.
insert into games (tournament_id, stage, home, away, kickoff)
  values (:t_id, 'GROUP_A', 'HOM', 'AWY', now() + interval '1 day') returning id \gset gf_
insert into games (tournament_id, stage, home, away, kickoff, voided)
  values (:t_id, 'GROUP_B', 'HOM', 'AWY', now() + interval '1 day', true) returning id \gset gv_

-- =========================================================================
-- rotate_invite_code: admin succeeds and the code actually changes.
-- =========================================================================
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000e001';
select isnt(
  (select rotate_invite_code(:p_id)),
  'ADMIN1',
  'rotate_invite_code returns a new code (admin)'
);
reset role;
select isnt(
  (select invite_code from pools where id = :p_id),
  'ADMIN1',
  'rotate_invite_code persisted the new code'
);
select matches(
  (select invite_code from pools where id = :p_id),
  '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$',
  'rotated code is 6 chars from the unambiguous alphabet'
);

-- player cannot rotate
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000e002';
select throws_ok(
  format($$select rotate_invite_code(%s)$$, :p_id),
  '42501', null,
  'rotate_invite_code rejected for a non-admin'
);
reset role;

-- =========================================================================
-- set_member_hidden: admin can hide a player; player cannot.
-- =========================================================================
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000e001';
select lives_ok(
  format($$select set_member_hidden(%s, '00000000-0000-0000-0000-00000000e002'::uuid, true)$$, :p_id),
  'admin can soft-hide a member'
);
reset role;
select is(
  (select hidden from memberships where pool_id = :p_id and user_id = '00000000-0000-0000-0000-00000000e002'),
  true,
  'member is now hidden'
);
-- un-hide for the remaining tests
update memberships set hidden = false where pool_id = :p_id and user_id = '00000000-0000-0000-0000-00000000e002';

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000e002';
select throws_ok(
  format($$select set_member_hidden(%s, '00000000-0000-0000-0000-00000000e001'::uuid, true)$$, :p_id),
  '42501', null,
  'set_member_hidden rejected for a non-admin'
);
reset role;

-- =========================================================================
-- pools pts-config UPDATE: admin may change pts while unlocked; player may not;
-- nobody may change pts once scoring_locked.
-- =========================================================================
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000e001';
select lives_ok(
  format($$update pools set pts_full = 5 where id = %s$$, :p_id),
  'admin can update pts config while unlocked'
);
reset role;
select is((select pts_full from pools where id = :p_id), 5::smallint,
  'pts_full updated to 5');

-- player cannot update pts (USING hides the row -> 0 rows affected)
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000e002';
select results_ne(
  format($$update pools set pts_full = 9 where id = %s returning 1$$, :p_id),
  $$ values(1) $$,
  'player cannot update pts config'
);
reset role;

-- Lock scoring, then even admin cannot change pts.
update pools set scoring_locked = true where id = :p_id;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000e001';
select results_ne(
  format($$update pools set pts_full = 7 where id = %s returning 1$$, :p_id),
  $$ values(1) $$,
  'admin cannot update pts config once scoring_locked'
);

-- =========================================================================
-- guesses insert on a voided game is rejected by RLS.
-- =========================================================================
select throws_ok(
  format($$insert into guesses (pool_id, user_id, game_id, home, away)
           values (%s, '00000000-0000-0000-0000-00000000e001', %s, 1, 0)$$, :p_id, :gv_id),
  '42501', null,
  'cannot insert a guess on a voided game'
);
reset role;

select * from finish();
rollback;
