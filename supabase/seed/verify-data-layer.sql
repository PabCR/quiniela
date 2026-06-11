-- Proof the data-layer queries work as a real authenticated member (Pablo),
-- pre/post kickoff, through the SAME RLS path PostgREST uses (set role
-- authenticated + jwt.claim.sub). Mirrors lib/data.tsx queries + who_picked.
\set ON_ERROR_STOP on
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';  -- Pablo

\echo '--- membership / pool ---'
select pool_id, role from memberships where user_id = auth.uid() and hidden=false;

\echo '--- teams count (>=20) ---'
select count(*) as teams from teams;

\echo '--- games scoped to tournament (==11) ---'
select count(*) as games from games;

\echo '--- PRE-kickoff (dev-m6 HAI v SCO): own guess visible, others HIDDEN ---'
select
  count(*) filter (where user_id = auth.uid()) as own_rows,
  count(*) filter (where user_id <> auth.uid()) as other_rows
from guesses g
join games gm on gm.id = g.game_id
where gm.external_id = 'dev-m6';

\echo '--- POST-kickoff (dev-m1 MEX 2-1 RSA): others REVEALED + server points ---'
select
  count(*) filter (where user_id <> auth.uid()) as other_rows_revealed,
  (select tag from guesses g2 join games gm2 on gm2.id=g2.game_id
     where gm2.external_id='dev-m1' and g2.user_id=auth.uid()) as my_tag,
  (select points from guesses g3 join games gm3 on gm3.id=g3.game_id
     where gm3.external_id='dev-m1' and g3.user_id=auth.uid()) as my_points
from guesses g
join games gm on gm.id = g.game_id
where gm.external_id = 'dev-m1';

\echo '--- who_picked(dev-m6): pickers pre-kickoff (who, not what) ---'
select count(*) as pickers,
  bool_or(wp = '00000000-0000-0000-0000-000000000001'::uuid) as includes_pablo
from (select who_picked(gm.id) as wp from games gm where gm.external_id='dev-m6') s;

reset role;
