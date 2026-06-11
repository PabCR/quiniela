-- 0008_who_picked.sql
-- who_picked(p_game_id) -> setof uuid
--
-- The pre-lock SOCIAL row needs to show WHO has picked, never WHAT they picked.
-- Plain guesses SELECT RLS forbids reading other members' guess ROWS before
-- kickoff (0004_rls.sql: guesses_select_own_or_locked), and that must not be
-- weakened. This RPC threads that needle: a SECURITY DEFINER function reads the
-- guesses table with RLS bypassed and returns ONLY the user_ids of pickers — no
-- scores, no advancer, no row contents.
--
-- Authorization (enforced inside the body, since SECURITY DEFINER bypasses RLS):
--   * caller must be authenticated;
--   * caller must hold an ACTIVE (hidden = false) membership in a pool attached
--     to the game's tournament. A non-member / no-membership caller gets an
--     EMPTY set (no leak, no exception — the social row simply shows nobody).
--
-- "Picked" = holds a COMPLETE pick for the game. A guesses row only exists when
-- complete: the guesses_guard trigger (0003) rejects a KO-draw insert without an
-- advancer, so "row exists" == "pick complete". We still scope the returned
-- pickers to ACTIVE members of the SAME pool(s) the caller belongs to, so the
-- count matches the roster the caller can actually see on the leaderboard.

create or replace function public.who_picked(p_game_id bigint)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct gu.user_id
  from public.guesses gu
  -- restrict to pools the CALLER is an active member of, attached to this game's
  -- tournament. is_member_of bypasses RLS (SECURITY DEFINER helper), so this
  -- both authorizes the caller and scopes the pickers to a shared pool.
  join public.games g
    on g.id = gu.game_id
  join public.pools p
    on p.id = gu.pool_id
   and p.tournament_id = g.tournament_id
  -- the picker must themselves be an active (non-hidden) member of that pool.
  join public.memberships pm
    on pm.pool_id = gu.pool_id
   and pm.user_id = gu.user_id
   and pm.hidden = false
  where gu.game_id = p_game_id
    and private.is_member_of(auth.uid(), gu.pool_id);
$$;

-- anon never calls this (the social row is post-auth); authenticated only.
revoke all on function public.who_picked(bigint) from public, anon;
grant execute on function public.who_picked(bigint) to authenticated;
