-- 05_who_picked.sql
-- who_picked(game_id) reveals WHO has picked without leaking WHAT.
--
-- Proves:
--   * a member sees the picker ids on a FUTURE (pre-kickoff) game...
--   * ...while STILL being unable to SELECT those other members' guess rows
--     (the cross-check: guesses RLS is not weakened);
--   * the caller themselves is included when they have picked;
--   * a hidden picker is excluded;
--   * a non-member / no-membership caller gets an EMPTY set (no leak);
--   * a complete-only contract: every returned uid corresponds to a real
--     (complete) guess row.

begin;
select plan(7);

-- --- setup as superuser (bypasses RLS) ---
insert into tournaments (name) values ('WP') returning id \gset t_
insert into teams (code, name_en, name_es, flag) values
  ('HOM','Home','Local','🏠'), ('AWY','Away','Visita','✈️');
insert into pools (tournament_id, name, invite_code, pts_full, pts_partial)
  values (:t_id, 'WpPool', 'WP0001', 3, 1) returning id \gset p_

-- A second, UNRELATED pool/tournament so we can prove a non-member is shut out.
insert into tournaments (name) values ('WP-other') returning id \gset t2_
insert into pools (tournament_id, name, invite_code, pts_full, pts_partial)
  values (:t2_id, 'OtherPool', 'WP0002', 3, 1) returning id \gset p2_

-- Players: A and B (members), C (member but hidden), Z (member of the OTHER
-- pool only -> non-member relative to the WP pool's game).
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000a0001', 'a@wp.com'),
  ('00000000-0000-0000-0000-0000000a0002', 'b@wp.com'),
  ('00000000-0000-0000-0000-0000000a0003', 'c@wp.com'),
  ('00000000-0000-0000-0000-0000000a0009', 'z@wp.com');
insert into profiles (id, name) values
  ('00000000-0000-0000-0000-0000000a0001', 'A'),
  ('00000000-0000-0000-0000-0000000a0002', 'B'),
  ('00000000-0000-0000-0000-0000000a0003', 'C'),
  ('00000000-0000-0000-0000-0000000a0009', 'Z');
insert into memberships (pool_id, user_id, role, hidden) values
  (:p_id,  '00000000-0000-0000-0000-0000000a0001', 'player', false),
  (:p_id,  '00000000-0000-0000-0000-0000000a0002', 'player', false),
  (:p_id,  '00000000-0000-0000-0000-0000000a0003', 'player', true),   -- hidden
  (:p2_id, '00000000-0000-0000-0000-0000000a0009', 'player', false);  -- other pool

-- A FUTURE game (pre-kickoff) in the WP tournament.
insert into games (tournament_id, stage, home, away, kickoff)
  values (:t_id, 'GROUP_A', 'HOM', 'AWY', now() + interval '3 hours') returning id \gset gf_

-- Picks (superuser bypasses the kickoff lock): A, B, and hidden-C all picked.
insert into guesses (pool_id, user_id, game_id, home, away) values
  (:p_id, '00000000-0000-0000-0000-0000000a0001', :gf_id, 2, 0),
  (:p_id, '00000000-0000-0000-0000-0000000a0002', :gf_id, 1, 1),
  (:p_id, '00000000-0000-0000-0000-0000000a0003', :gf_id, 0, 0);

-- =========================================================================
-- As member A (authenticated), BEFORE kickoff.
-- =========================================================================
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000a0001';

-- A sees the picker ids: A and B (NOT hidden C).
select set_eq(
  format($$select who_picked(%s)$$, :gf_id),
  $$ values ('00000000-0000-0000-0000-0000000a0001'::uuid),
            ('00000000-0000-0000-0000-0000000a0002'::uuid) $$,
  'member sees active picker ids (self + B), hidden C excluded, pre-kickoff'
);

-- who_picked returns exactly 2 active pickers.
select is(
  (select count(*) from who_picked(:gf_id)),
  2::bigint,
  'who_picked returns 2 active pickers'
);

-- CROSS-CHECK: A still CANNOT read B's guess ROW before kickoff. The social
-- count is exposed, the contents are NOT.
select is(
  (select count(*) from guesses
     where user_id = '00000000-0000-0000-0000-0000000a0002' and game_id = :gf_id),
  0::bigint,
  'member CANNOT select another member''s guess row pre-kickoff (RLS intact)'
);

-- A can read OWN guess row (sanity that RLS still allows own rows).
select is(
  (select count(*) from guesses
     where user_id = '00000000-0000-0000-0000-0000000a0001' and game_id = :gf_id),
  1::bigint,
  'member can still read own guess row'
);

reset role;

-- =========================================================================
-- As Z (member of the OTHER pool only -> NOT a member of this game's pool).
-- Must get an EMPTY set.
-- =========================================================================
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000a0009';
select is(
  (select count(*) from who_picked(:gf_id)),
  0::bigint,
  'non-member of the game''s pool gets an empty who_picked set'
);
reset role;

-- =========================================================================
-- As a fully unknown authenticated user (no membership anywhere): empty set.
-- =========================================================================
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000affff';
select is(
  (select count(*) from who_picked(:gf_id)),
  0::bigint,
  'no-membership user gets an empty who_picked set'
);
reset role;

-- =========================================================================
-- anon cannot execute who_picked at all (grant is authenticated-only).
-- =========================================================================
set local role anon;
select throws_ok(
  format($$select who_picked(%s)$$, :gf_id),
  '42501', null,
  'anon cannot execute who_picked'
);
reset role;

select * from finish();
rollback;
