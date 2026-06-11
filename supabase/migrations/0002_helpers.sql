-- 0002_helpers.sql
-- SECURITY DEFINER helper functions in the `private` schema.
--
-- These are referenced by RLS policies. Because they are SECURITY DEFINER and
-- read membership rows with RLS bypassed (owner = postgres, and the functions
-- are not themselves subject to the policies they support), they break the
-- recursion that would otherwise occur if a memberships policy queried
-- memberships.
--
-- All membership lookups here treat hidden = true as "not active": a soft-hidden
-- member is removed from the leaderboard but, more importantly for integrity,
-- an authenticated user with no *active* membership sees nothing (brief §7.3b).

-- ---------------------------------------------------------------------------
-- is_pool_member(uid): true if the user holds at least one active membership
-- (hidden = false) in any pool. Used by "is this user allowed to see anything"
-- gates.
-- ---------------------------------------------------------------------------
-- The API roles need USAGE on the schema to reference functions inside it.
-- They do NOT get blanket EXECUTE — grants are per-function below.
grant usage on schema private to authenticated;

create or replace function private.is_pool_member(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    where m.user_id = p_uid
      and m.hidden = false
  );
$$;

-- ---------------------------------------------------------------------------
-- is_member_of(uid, pool_id): true if the user holds an active membership in
-- the specific pool.
-- ---------------------------------------------------------------------------
create or replace function private.is_member_of(p_uid uuid, p_pool_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    where m.user_id = p_uid
      and m.pool_id = p_pool_id
      and m.hidden = false
  );
$$;

-- ---------------------------------------------------------------------------
-- is_pool_admin(uid, pool_id): true if the user is an active admin of the pool.
-- ---------------------------------------------------------------------------
create or replace function private.is_pool_admin(p_uid uuid, p_pool_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    where m.user_id = p_uid
      and m.pool_id = p_pool_id
      and m.role = 'admin'
      and m.hidden = false
  );
$$;

-- ---------------------------------------------------------------------------
-- shares_pool_with(uid, other_uid): true if the two users share at least one
-- pool where the caller holds an active membership. Used by profiles SELECT so
-- members can see names/emoji of people they actually play against.
-- ---------------------------------------------------------------------------
create or replace function private.shares_pool_with(p_uid uuid, p_other uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships me
    join public.memberships them
      on them.pool_id = me.pool_id
    where me.user_id = p_uid
      and me.hidden = false
      and them.user_id = p_other
  );
$$;

-- ---------------------------------------------------------------------------
-- is_admin_for_game(uid, game_id): true if the user is an admin of any pool
-- attached to the game's tournament. Used by admin_set_result.
-- ---------------------------------------------------------------------------
create or replace function private.is_admin_for_game(p_uid uuid, p_game_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.games g
    join public.pools p on p.tournament_id = g.tournament_id
    join public.memberships m on m.pool_id = p.id
    where g.id = p_game_id
      and m.user_id = p_uid
      and m.role = 'admin'
      and m.hidden = false
  );
$$;

-- RLS policies invoke these helpers as the *querying* role, so that role needs
-- EXECUTE even though the function is SECURITY DEFINER (the DEFINER property
-- only governs privileges *inside* the body, where it bypasses RLS on
-- memberships). Revoke the default PUBLIC grant, then grant explicitly to the
-- API roles. We do NOT grant to anon for the member/admin helpers — they are
-- only used by authenticated-role policies.
revoke all on function private.is_pool_member(uuid)            from public;
revoke all on function private.is_member_of(uuid, bigint)      from public;
revoke all on function private.is_pool_admin(uuid, bigint)     from public;
revoke all on function private.shares_pool_with(uuid, uuid)    from public;
revoke all on function private.is_admin_for_game(uuid, bigint) from public;

grant execute on function private.is_pool_member(uuid)            to authenticated;
grant execute on function private.is_member_of(uuid, bigint)      to authenticated;
grant execute on function private.is_pool_admin(uuid, bigint)     to authenticated;
grant execute on function private.shares_pool_with(uuid, uuid)    to authenticated;
grant execute on function private.is_admin_for_game(uuid, bigint) to authenticated;
