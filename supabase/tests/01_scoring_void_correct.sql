-- 01_scoring_void_correct.sql
-- Void nulls points; correction restamps + recomputes; admin_set_result path.

begin;
select plan(9);

insert into tournaments (name) values ('VC') returning id \gset t_
insert into teams (code, name_en, name_es, flag) values
  ('HOM','Home','Local','🏠'), ('AWY','Away','Visita','✈️');
insert into pools (tournament_id, name, invite_code, pts_full, pts_partial)
  values (:t_id, 'VoidPool', 'VOID01', 3, 1) returning id \gset p_

-- One admin + one player.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@vc.com'),
  ('00000000-0000-0000-0000-0000000000b1', 'player@vc.com');
insert into profiles (id, name) values
  ('00000000-0000-0000-0000-0000000000a1', 'Admin'),
  ('00000000-0000-0000-0000-0000000000b1', 'Player');
insert into memberships (pool_id, user_id, role) values
  (:p_id, '00000000-0000-0000-0000-0000000000a1', 'admin'),
  (:p_id, '00000000-0000-0000-0000-0000000000b1', 'player');

insert into games (tournament_id, stage, home, away, kickoff)
  values (:t_id, 'GROUP_A', 'HOM', 'AWY', now() + interval '1 day') returning id \gset g_

insert into guesses (pool_id, user_id, game_id, home, away)
  values (:p_id, '00000000-0000-0000-0000-0000000000b1', :g_id, 2, 1);

-- Authenticate as the admin and confirm 2-1 via the RPC.
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';

select lives_ok(
  format($$select admin_set_result(%s, 2::smallint, 1::smallint, null, false)$$, :g_id),
  'admin_set_result confirms a result'
);

reset role;
select is((select points from guesses where game_id = :g_id), 3::smallint,
  'After confirm 2-1: exact -> 3 points');
select is((select tag from guesses where game_id = :g_id), 'exact',
  'After confirm 2-1: tag exact');
select is((select corrected from games where id = :g_id), false,
  'First confirm does not set corrected');

-- Correction: admin changes result to 1-0 (still a home win => outcome, 1 pt).
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
select lives_ok(
  format($$select admin_set_result(%s, 1::smallint, 0::smallint, null, false)$$, :g_id),
  'admin_set_result corrects an existing result'
);
reset role;

select is((select points from guesses where game_id = :g_id), 1::smallint,
  'After correction 1-0: pick 2-1 is outcome -> 1 point');
select is((select corrected from games where id = :g_id), true,
  'Correcting a confirmed result stamps corrected = true');

-- Void: admin voids the game; points are nulled.
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
select lives_ok(
  format($$select admin_set_result(%s, null::smallint, null::smallint, null, true)$$, :g_id),
  'admin_set_result voids a game'
);
reset role;

select is((select points from guesses where game_id = :g_id), null::smallint,
  'Voiding the game nulls points');

select * from finish();
rollback;
