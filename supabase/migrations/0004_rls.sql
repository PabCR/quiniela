-- 0004_rls.sql
-- Row-Level Security — the product's integrity layer (brief §4 "RLS").
--
-- Core principle (brief §7.3b): every SELECT requires the caller to hold an
-- ACTIVE membership (hidden = false). An authenticated user with no active
-- membership sees NOTHING. Helpers in the `private` schema (SECURITY DEFINER)
-- gate this without recursive RLS on memberships.
--
-- Writes:
--   * games        : service role only (no authenticated policy). Admin entry
--                    goes through the admin_set_result RPC.
--   * pools         : admin of that pool may update pts config while unlocked.
--   * profiles      : own row only.
--   * memberships   : never inserted directly by clients (join_pool RPC only).
--   * guesses       : own rows, before kickoff, game not voided, active member.

-- Enable RLS on every table.
alter table tournaments  enable row level security;
alter table teams        enable row level security;
alter table games        enable row level security;
alter table pools        enable row level security;
alter table profiles     enable row level security;
alter table memberships  enable row level security;
alter table guesses      enable row level security;

-- Force RLS even for the table owner during local testing role switches.
-- (Service role bypasses RLS via the bypassrls attribute, not table ownership.)

-- ===========================================================================
-- tournaments — readable by any active member; no client writes.
-- ===========================================================================
create policy tournaments_select_member
  on tournaments for select
  to authenticated
  using ( private.is_pool_member(auth.uid()) );

-- ===========================================================================
-- teams — reference data; readable by any active member.
-- Also readable by anon is NOT needed (the invite gate uses an RPC), so keep
-- it member-only for consistency.
-- ===========================================================================
create policy teams_select_member
  on teams for select
  to authenticated
  using ( private.is_pool_member(auth.uid()) );

-- ===========================================================================
-- games — readable by any active member. INSERT/UPDATE: service role only
-- (no authenticated policy => authenticated cannot write).
-- ===========================================================================
create policy games_select_member
  on games for select
  to authenticated
  using ( private.is_pool_member(auth.uid()) );

-- ===========================================================================
-- pools — readable by active members of THAT pool. UPDATE: admin of the pool,
-- only while scoring_locked = false. Pts config is the only thing editable
-- this way; invite-code rotation is via the rotate_invite_code RPC.
-- ===========================================================================
create policy pools_select_member
  on pools for select
  to authenticated
  using ( private.is_member_of(auth.uid(), id) );

create policy pools_update_admin
  on pools for update
  to authenticated
  using ( private.is_pool_admin(auth.uid(), id) and scoring_locked = false )
  with check ( private.is_pool_admin(auth.uid(), id) and scoring_locked = false );

-- ===========================================================================
-- profiles — SELECT: members who share a pool with the profile owner (plus the
-- owner themselves). UPDATE: own row only. No client INSERT (join_pool RPC).
-- ===========================================================================
create policy profiles_select_shared
  on profiles for select
  to authenticated
  using (
    id = auth.uid()
    or private.shares_pool_with(auth.uid(), id)
  );

create policy profiles_update_own
  on profiles for update
  to authenticated
  using ( id = auth.uid() )
  with check ( id = auth.uid() );

-- ===========================================================================
-- memberships — SELECT: members of pools the caller also belongs to (so the
-- leaderboard / members screen can list the roster). No client INSERT/UPDATE/
-- DELETE: membership lifecycle is RPC-only (join_pool, set_member_hidden).
-- The SELECT policy uses is_member_of (SECURITY DEFINER) on the row's pool_id,
-- which does not recurse because the helper bypasses RLS.
-- ===========================================================================
create policy memberships_select_member
  on memberships for select
  to authenticated
  using ( private.is_member_of(auth.uid(), pool_id) );

-- ===========================================================================
-- guesses
--   SELECT : own rows always (when an active member); others' rows only once
--            the game's kickoff has passed (kickoff <= now()).
--   INSERT : user_id = auth.uid(), active member of the pool, game's kickoff in
--            the future, game not voided.
--   UPDATE : same conditions as INSERT (re-checked on the resulting row too).
--   DELETE : allowed under the same pre-kickoff conditions, so a player may
--            retract a pick before lock. (Documented choice: DELETE is enabled.)
-- ===========================================================================
create policy guesses_select_own_or_locked
  on guesses for select
  to authenticated
  using (
    private.is_member_of(auth.uid(), pool_id)
    and (
      user_id = auth.uid()
      or exists (
        select 1 from games g
        where g.id = guesses.game_id
          and g.kickoff <= now()
      )
    )
  );

create policy guesses_insert_own
  on guesses for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and private.is_member_of(auth.uid(), pool_id)
    and exists (
      select 1 from games g
      where g.id = guesses.game_id
        and g.kickoff > now()
        and g.voided = false
    )
  );

create policy guesses_update_own
  on guesses for update
  to authenticated
  using (
    user_id = auth.uid()
    and private.is_member_of(auth.uid(), pool_id)
    and exists (
      select 1 from games g
      where g.id = guesses.game_id
        and g.kickoff > now()
        and g.voided = false
    )
  )
  with check (
    user_id = auth.uid()
    and private.is_member_of(auth.uid(), pool_id)
    and exists (
      select 1 from games g
      where g.id = guesses.game_id
        and g.kickoff > now()
        and g.voided = false
    )
  );

create policy guesses_delete_own
  on guesses for delete
  to authenticated
  using (
    user_id = auth.uid()
    and private.is_member_of(auth.uid(), pool_id)
    and exists (
      select 1 from games g
      where g.id = guesses.game_id
        and g.kickoff > now()
        and g.voided = false
    )
  );
