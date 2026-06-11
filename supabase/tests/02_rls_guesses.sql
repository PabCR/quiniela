-- 02_rls_guesses.sql
-- RLS for guesses: kickoff lock on write, cross-user visibility before/after
-- kickoff, and client points/tag write protection.

begin;
select plan(9);

-- --- setup as superuser ---
insert into tournaments (name) values ('RLS') returning id \gset t_
insert into teams (code, name_en, name_es, flag) values
  ('HOM','Home','Local','🏠'), ('AWY','Away','Visita','✈️');
insert into pools (tournament_id, name, invite_code, pts_full, pts_partial)
  values (:t_id, 'RlsPool', 'RLS001', 3, 1) returning id \gset p_

-- Two players A and B.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000aaaa', 'a@rls.com'),
  ('00000000-0000-0000-0000-00000000bbbb', 'b@rls.com');
insert into profiles (id, name) values
  ('00000000-0000-0000-0000-00000000aaaa', 'A'),
  ('00000000-0000-0000-0000-00000000bbbb', 'B');
insert into memberships (pool_id, user_id, role) values
  (:p_id, '00000000-0000-0000-0000-00000000aaaa', 'player'),
  (:p_id, '00000000-0000-0000-0000-00000000bbbb', 'player');

-- A future game (open for picks) and a past game (locked).
insert into games (tournament_id, stage, home, away, kickoff)
  values (:t_id, 'GROUP_A', 'HOM', 'AWY', now() + interval '2 hours') returning id \gset gf_
insert into games (tournament_id, stage, home, away, kickoff)
  values (:t_id, 'GROUP_B', 'HOM', 'AWY', now() - interval '2 hours') returning id \gset gp_

-- Pre-seed B's guesses on both games (superuser bypasses RLS + kickoff).
insert into guesses (pool_id, user_id, game_id, home, away) values
  (:p_id, '00000000-0000-0000-0000-00000000bbbb', :gf_id, 3, 0),
  (:p_id, '00000000-0000-0000-0000-00000000bbbb', :gp_id, 0, 3);

-- =========================================================================
-- As user A (authenticated).
-- =========================================================================
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000aaaa';

-- A can INSERT a guess on the FUTURE game.
select lives_ok(
  format($$insert into guesses (pool_id, user_id, game_id, home, away)
           values (%s, '00000000-0000-0000-0000-00000000aaaa', %s, 1, 1)$$, :p_id, :gf_id),
  'A can insert a guess before kickoff'
);

-- A canNOT insert a guess on the PAST game (kickoff passed -> RLS rejects).
select throws_ok(
  format($$insert into guesses (pool_id, user_id, game_id, home, away)
           values (%s, '00000000-0000-0000-0000-00000000aaaa', %s, 1, 1)$$, :p_id, :gp_id),
  '42501',
  null,
  'A cannot insert a guess after kickoff (RLS)'
);

-- A's UPDATE of own future guess works...
select lives_ok(
  format($$update guesses set home = 2, away = 2
           where user_id = '00000000-0000-0000-0000-00000000aaaa' and game_id = %s$$, :gf_id),
  'A can update own guess before kickoff'
);

-- Client points/tag write protection: A sets points = 99 / tag = exact; the
-- guard forces them back to NULL.
update guesses set points = 99, tag = 'exact'
  where user_id = '00000000-0000-0000-0000-00000000aaaa' and game_id = :gf_id;
select is(
  (select points from guesses
     where user_id = '00000000-0000-0000-0000-00000000aaaa' and game_id = :gf_id),
  null::smallint,
  'Client write of points is forced to NULL by guesses_guard');
select is(
  (select tag from guesses
     where user_id = '00000000-0000-0000-0000-00000000aaaa' and game_id = :gf_id),
  null::text,
  'Client write of tag is forced to NULL by guesses_guard');

-- A cannot SEE B's guess on the FUTURE game (not own, kickoff not passed).
select is(
  (select count(*) from guesses
     where user_id = '00000000-0000-0000-0000-00000000bbbb' and game_id = :gf_id),
  0::bigint,
  'A cannot read B''s guess before kickoff');

-- A CAN see B's guess on the PAST game (kickoff passed -> revealed).
select is(
  (select count(*) from guesses
     where user_id = '00000000-0000-0000-0000-00000000bbbb' and game_id = :gp_id),
  1::bigint,
  'A can read B''s guess after kickoff');

-- A can always see own guesses.
select is(
  (select count(*) from guesses
     where user_id = '00000000-0000-0000-0000-00000000aaaa'),
  1::bigint,
  'A can read own guess (future game)');

-- =========================================================================
-- As user B: cannot modify A's guess. B's UPDATE targeting A's row affects
-- zero rows because the USING clause hides A's row from B.
-- =========================================================================
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000bbbb';
select results_ne(
  format($$update guesses set home = 9
           where user_id = '00000000-0000-0000-0000-00000000aaaa' and game_id = %s returning 1$$, :gf_id),
  $$ values(1) $$,
  'B cannot modify A''s guess (update affects no rows)'
);

select * from finish();
rollback;
