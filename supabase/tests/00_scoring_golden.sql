-- 00_scoring_golden.sql
-- The 12 golden scoring cases from brief §5 (defaults 3/1).
--
-- Strategy: one pool with pts_full=3 / pts_partial=1, sixteen-ish synthetic
-- users (one per case), one game per case, one guess per user. We insert
-- guesses directly (running as the migration/superuser role, which bypasses
-- RLS) then confirm each result via the trigger path (set result_status =
-- 'confirmed') and assert the stored points + tag on each guess.
--
-- Case 5 (group, no pick) and case 12 (KO draw with no advancer) cannot be
-- stored as rows at all — the guesses_guard trigger rejects them — so we assert
-- that the INSERT throws, which is the SQL equivalent of "no row / em-dash".

begin;
select plan(22);

-- ---------------------------------------------------------------------------
-- Setup (as superuser: RLS bypassed, guesses_guard still strips points/tag).
-- ---------------------------------------------------------------------------
insert into tournaments (name) values ('Test Cup') returning id \gset t_

insert into teams (code, name_en, name_es, flag) values
  ('HOM', 'Home', 'Local', '🏠'),
  ('AWY', 'Away', 'Visita', '✈️');

insert into pools (tournament_id, name, invite_code, pts_full, pts_partial)
values (:t_id, 'Golden', 'GOLD01', 3, 1) returning id \gset p_

-- Twelve synthetic auth users + profiles + memberships (one per case).
do $$
declare
  i int;
  uid uuid;
begin
  for i in 1..12 loop
    uid := ('00000000-0000-0000-0000-0000000000' || lpad(i::text, 2, '0'))::uuid;
    insert into auth.users (id, email)
      values (uid, 'case' || i || '@test.com');
    insert into public.profiles (id, name) values (uid, 'Case ' || i);
    insert into public.memberships (pool_id, user_id, role)
      values ((select id from public.pools where invite_code = 'GOLD01'), uid, 'player');
  end loop;
end $$;

-- Helper: uid for a case number.
-- (inline expression: ('...' || lpad) — repeated below.)

-- ---------------------------------------------------------------------------
-- Create one game per case. Group games use GROUP_A; KO games use R32.
-- All games belong to the tournament; kickoff in the past is irrelevant for
-- scoring (we score on confirm regardless of kickoff).
-- ---------------------------------------------------------------------------

-- Case 1: Group, pick 2-1, result 2-1 -> 3 exact
insert into games (tournament_id, stage, home, away, kickoff)
  values (:t_id, 'GROUP_A', 'HOM', 'AWY', now() + interval '1 day') returning id \gset g1_
-- Case 2: Group, pick 1-0, result 2-1 -> 1 outcome
insert into games (tournament_id, stage, home, away, kickoff)
  values (:t_id, 'GROUP_A', 'HOM', 'AWY', now() + interval '1 day') returning id \gset g2_
-- Case 3: Group, pick 1-1, result 2-2 -> 1 outcome
insert into games (tournament_id, stage, home, away, kickoff)
  values (:t_id, 'GROUP_A', 'HOM', 'AWY', now() + interval '1 day') returning id \gset g3_
-- Case 4: Group, pick 0-1, result 2-1 -> 0 miss
insert into games (tournament_id, stage, home, away, kickoff)
  values (:t_id, 'GROUP_A', 'HOM', 'AWY', now() + interval '1 day') returning id \gset g4_
-- Case 5: Group, no pick (cannot store) -> assert insert is impossible
insert into games (tournament_id, stage, home, away, kickoff)
  values (:t_id, 'GROUP_A', 'HOM', 'AWY', now() + interval '1 day') returning id \gset g5_
-- Case 6: KO, pick 2-1, result 2-1 home adv -> 3 exact
insert into games (tournament_id, stage, home, away, kickoff)
  values (:t_id, 'R32', 'HOM', 'AWY', now() + interval '1 day') returning id \gset g6_
-- Case 7: KO, pick 2-1, result 3-1 home adv -> 1 outcome
insert into games (tournament_id, stage, home, away, kickoff)
  values (:t_id, 'R32', 'HOM', 'AWY', now() + interval '1 day') returning id \gset g7_
-- Case 8: KO, pick 1-1 adv HOM, result 1-1 HOM on pens -> 3 exact
insert into games (tournament_id, stage, home, away, kickoff)
  values (:t_id, 'R32', 'HOM', 'AWY', now() + interval '1 day') returning id \gset g8_
-- Case 9: KO, pick 1-1 adv HOM, result 1-1 AWY on pens -> 1 draw
insert into games (tournament_id, stage, home, away, kickoff)
  values (:t_id, 'R32', 'HOM', 'AWY', now() + interval '1 day') returning id \gset g9_
-- Case 10: KO, pick 2-2 adv AWY, result 1-1 AWY on pens -> 1 draw (rule 2 before 3)
insert into games (tournament_id, stage, home, away, kickoff)
  values (:t_id, 'R32', 'HOM', 'AWY', now() + interval '1 day') returning id \gset g10_
-- Case 11: KO, pick 2-1, result 1-1 HOM on pens -> 1 outcome
insert into games (tournament_id, stage, home, away, kickoff)
  values (:t_id, 'R32', 'HOM', 'AWY', now() + interval '1 day') returning id \gset g11_
-- Case 12: KO, pick 1-1 no advancer -> cannot store, assert insert is impossible
insert into games (tournament_id, stage, home, away, kickoff)
  values (:t_id, 'R32', 'HOM', 'AWY', now() + interval '1 day') returning id \gset g12_

-- ---------------------------------------------------------------------------
-- Insert the guesses (superuser; guesses_guard normalizes advancer + strips
-- points/tag). uid(n) = '...0000000000' || lpad(n,2,'0').
-- ---------------------------------------------------------------------------
insert into guesses (pool_id, user_id, game_id, home, away) values
  (:p_id, '00000000-0000-0000-0000-000000000001', :g1_id, 2, 1),
  (:p_id, '00000000-0000-0000-0000-000000000002', :g2_id, 1, 0),
  (:p_id, '00000000-0000-0000-0000-000000000003', :g3_id, 1, 1),
  (:p_id, '00000000-0000-0000-0000-000000000004', :g4_id, 0, 1),
  (:p_id, '00000000-0000-0000-0000-000000000006', :g6_id, 2, 1),
  (:p_id, '00000000-0000-0000-0000-000000000007', :g7_id, 2, 1),
  (:p_id, '00000000-0000-0000-0000-000000000011', :g11_id, 2, 1);

-- KO draw picks need an explicit advancer.
insert into guesses (pool_id, user_id, game_id, home, away, advancer) values
  (:p_id, '00000000-0000-0000-0000-000000000008', :g8_id, 1, 1, 'HOM'),
  (:p_id, '00000000-0000-0000-0000-000000000009', :g9_id, 1, 1, 'HOM'),
  (:p_id, '00000000-0000-0000-0000-000000000010', :g10_id, 2, 2, 'AWY');

-- ---------------------------------------------------------------------------
-- Case 5: a group game with NO pick simply has no guess row. There is nothing
-- to assert about storage (an absent pick is the em-dash). Confirm there is no
-- guess for the case-5 user/game, which is the canonical "no pick" state.
-- ---------------------------------------------------------------------------
select is(
  (select count(*) from guesses
     where game_id = :g5_id
       and user_id = '00000000-0000-0000-0000-000000000005'),
  0::bigint,
  'Case 5: group game with no pick has no guess row (renders em-dash)'
);

-- ---------------------------------------------------------------------------
-- Case 12: a KO draw pick with no advancer must be rejected by guesses_guard.
-- ---------------------------------------------------------------------------
select throws_ok(
  format(
    $q$insert into guesses (pool_id, user_id, game_id, home, away)
       values (%s, '00000000-0000-0000-0000-000000000012', %s, 1, 1)$q$,
    :p_id, :g12_id),
  null,
  'Case 12: KO draw pick without advancer cannot be stored (incomplete = no pick)'
);

-- ---------------------------------------------------------------------------
-- Confirm results (trigger fires score_game). Group games: just set scores +
-- confirmed. KO games: set scores, advancer, confirmed.
-- ---------------------------------------------------------------------------
update games set score_home = 2, score_away = 1, result_status = 'confirmed', confirmed_at = now() where id = :g1_id;
update games set score_home = 2, score_away = 1, result_status = 'confirmed', confirmed_at = now() where id = :g2_id;
update games set score_home = 2, score_away = 2, result_status = 'confirmed', confirmed_at = now() where id = :g3_id;
update games set score_home = 2, score_away = 1, result_status = 'confirmed', confirmed_at = now() where id = :g4_id;
-- Case 6: 2-1 home advances
update games set score_home = 2, score_away = 1, advancer = 'HOM', result_status = 'confirmed', confirmed_at = now() where id = :g6_id;
-- Case 7: 3-1 home advances
update games set score_home = 3, score_away = 1, advancer = 'HOM', result_status = 'confirmed', confirmed_at = now() where id = :g7_id;
-- Case 8: 1-1 HOM on pens
update games set score_home = 1, score_away = 1, advancer = 'HOM', result_status = 'confirmed', confirmed_at = now() where id = :g8_id;
-- Case 9: 1-1 AWY on pens
update games set score_home = 1, score_away = 1, advancer = 'AWY', result_status = 'confirmed', confirmed_at = now() where id = :g9_id;
-- Case 10: 1-1 AWY on pens
update games set score_home = 1, score_away = 1, advancer = 'AWY', result_status = 'confirmed', confirmed_at = now() where id = :g10_id;
-- Case 11: 1-1 HOM on pens
update games set score_home = 1, score_away = 1, advancer = 'HOM', result_status = 'confirmed', confirmed_at = now() where id = :g11_id;

-- ---------------------------------------------------------------------------
-- Assertions: points + tag per case.
-- ---------------------------------------------------------------------------
-- Case 1
select is((select points from guesses where game_id = :g1_id), 3::smallint, 'Case 1: points = 3');
select is((select tag    from guesses where game_id = :g1_id), 'exact',     'Case 1: tag = exact');
-- Case 2
select is((select points from guesses where game_id = :g2_id), 1::smallint, 'Case 2: points = 1');
select is((select tag    from guesses where game_id = :g2_id), 'outcome',   'Case 2: tag = outcome');
-- Case 3
select is((select points from guesses where game_id = :g3_id), 1::smallint, 'Case 3: points = 1');
select is((select tag    from guesses where game_id = :g3_id), 'outcome',   'Case 3: tag = outcome');
-- Case 4
select is((select points from guesses where game_id = :g4_id), 0::smallint, 'Case 4: points = 0');
select is((select tag    from guesses where game_id = :g4_id), 'miss',      'Case 4: tag = miss');
-- Case 6
select is((select points from guesses where game_id = :g6_id), 3::smallint, 'Case 6: points = 3');
select is((select tag    from guesses where game_id = :g6_id), 'exact',     'Case 6: tag = exact');
-- Case 7
select is((select points from guesses where game_id = :g7_id), 1::smallint, 'Case 7: points = 1');
select is((select tag    from guesses where game_id = :g7_id), 'outcome',   'Case 7: tag = outcome');
-- Case 8
select is((select points from guesses where game_id = :g8_id), 3::smallint, 'Case 8: points = 3');
select is((select tag    from guesses where game_id = :g8_id), 'exact',     'Case 8: tag = exact');
-- Case 9
select is((select points from guesses where game_id = :g9_id), 1::smallint, 'Case 9: points = 1');
select is((select tag    from guesses where game_id = :g9_id), 'draw',      'Case 9: tag = draw');
-- Case 10 (rule 2 before rule 3 — never 2 pts)
select is((select points from guesses where game_id = :g10_id), 1::smallint, 'Case 10: points = 1');
select is((select tag    from guesses where game_id = :g10_id), 'draw',      'Case 10: tag = draw');
-- Case 11
select is((select points from guesses where game_id = :g11_id), 1::smallint, 'Case 11: points = 1');
select is((select tag    from guesses where game_id = :g11_id), 'outcome',   'Case 11: tag = outcome');

select * from finish();
rollback;
