-- 0006_rpcs.sql
-- SECURITY DEFINER RPCs. All set search_path = '' and use fully-qualified names.

-- ===========================================================================
-- check_invite_code(code) -> boolean
-- Anon-callable. Leaks nothing but validity (no pool data returned).
-- ===========================================================================
create or replace function public.check_invite_code(p_code text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.pools
    where invite_code = upper(trim(p_code))
  );
$$;

revoke all on function public.check_invite_code(text) from public;
grant execute on function public.check_invite_code(text) to anon, authenticated;

-- ===========================================================================
-- join_pool(invite_code, display_name, emoji) -> void
-- Authenticated only. Revalidates the code server-side; upserts the caller's
-- profile and creates a 'player' membership. Rejects a duplicate display name
-- within the pool (case-insensitive). Idempotent if the caller already holds a
-- membership in that pool (returns without error).
-- ===========================================================================
create or replace function public.join_pool(
  p_invite_code text,
  p_display_name text,
  p_emoji text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_pool_id bigint;
  v_name    text := trim(p_display_name);
begin
  if v_uid is null then
    raise exception 'join_pool: authentication required'
      using errcode = '28000';
  end if;

  if v_name is null or v_name = '' then
    raise exception 'join_pool: display name is required'
      using errcode = '22023';
  end if;

  -- Revalidate the invite code server-side.
  select id into v_pool_id
  from public.pools
  where invite_code = upper(trim(p_invite_code));

  if v_pool_id is null then
    raise exception using
      errcode = '22023',
      message = 'Invalid invite code. Ask Pablo for the code.';
  end if;

  -- Idempotent: already a member of this pool -> ensure profile name/emoji are
  -- current and return.
  if exists (
    select 1 from public.memberships
    where pool_id = v_pool_id and user_id = v_uid
  ) then
    update public.profiles
       set name  = v_name,
           emoji = coalesce(p_emoji, emoji)
     where id = v_uid;
    return;
  end if;

  -- Reject a duplicate display name within the pool (case-insensitive),
  -- excluding the caller themselves.
  if exists (
    select 1
    from public.memberships m
    join public.profiles pr on pr.id = m.user_id
    where m.pool_id = v_pool_id
      and m.user_id <> v_uid
      and lower(pr.name) = lower(v_name)
  ) then
    raise exception using
      errcode = '23505',
      message = format('The name "%s" is already taken in this pool.', v_name),
      hint    = 'Try adding a last initial or nickname.';
  end if;

  -- Upsert the caller's own profile.
  insert into public.profiles (id, name, emoji)
  values (v_uid, v_name, p_emoji)
  on conflict (id) do update
    set name  = excluded.name,
        emoji = coalesce(excluded.emoji, public.profiles.emoji);

  -- Create the membership (role 'player'). Admin is seeded out-of-band.
  insert into public.memberships (pool_id, user_id, role)
  values (v_pool_id, v_uid, 'player');
end;
$$;

revoke all on function public.join_pool(text, text, text) from public, anon;
grant execute on function public.join_pool(text, text, text) to authenticated;

-- ===========================================================================
-- admin_set_result(p_game_id, p_home, p_away, p_advancer, p_void) -> void
-- Admin of a pool in the game's tournament only. On void: sets voided = true.
-- Otherwise: sets scores/advancer, result_status = 'confirmed',
-- confirmed_at = now(), corrected = true if a confirmed result already existed.
-- Validates advancer required for KO draws.
-- ===========================================================================
create or replace function public.admin_set_result(
  p_game_id  bigint,
  p_home     smallint,
  p_away     smallint,
  p_advancer text,
  p_void     boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  g     public.games%rowtype;
  v_is_ko boolean;
  v_was_confirmed boolean;
begin
  if v_uid is null then
    raise exception 'admin_set_result: authentication required'
      using errcode = '28000';
  end if;

  if not private.is_admin_for_game(v_uid, p_game_id) then
    raise exception using
      errcode = '42501',
      message = 'Only a pool admin can set results.';
  end if;

  select * into g from public.games where id = p_game_id;
  if not found then
    raise exception 'admin_set_result: game % not found', p_game_id
      using errcode = 'P0002';
  end if;

  -- Void path: flag the game; trigger nulls points.
  if p_void then
    update public.games
       set voided = true,
           updated_at = now()
     where id = p_game_id;
    return;
  end if;

  if p_home is null or p_away is null then
    raise exception 'admin_set_result: both scores are required'
      using errcode = '22023';
  end if;

  v_is_ko := g.stage::text not like 'GROUP%';

  -- Validate advancer for KO draws.
  if v_is_ko then
    if p_advancer is not null
       and p_advancer is distinct from g.home
       and p_advancer is distinct from g.away then
      raise exception 'admin_set_result: advancer % is not one of the game teams',
        p_advancer using errcode = '22023';
    end if;
    if p_home = p_away and p_advancer is null then
      raise exception using
        errcode = '22023',
        message = 'A knockout draw requires an advancing team.';
    end if;
  end if;

  v_was_confirmed := (g.result_status = 'confirmed');

  update public.games
     set score_home    = p_home,
         score_away    = p_away,
         -- only KO games carry an advancer; clear it for non-draw KO and groups
         advancer      = case
                           when v_is_ko and p_home = p_away then p_advancer
                           when v_is_ko and p_home > p_away then g.home
                           when v_is_ko and p_away > p_home then g.away
                           else null
                         end,
         result_status = 'confirmed',
         confirmed_at   = now(),
         voided         = false,
         corrected      = corrected or v_was_confirmed,
         updated_at     = now()
   where id = p_game_id;
end;
$$;

revoke all on function public.admin_set_result(bigint, smallint, smallint, text, boolean)
  from public, anon;
grant execute on function public.admin_set_result(bigint, smallint, smallint, text, boolean)
  to authenticated;

-- ===========================================================================
-- rotate_invite_code(p_pool_id) -> text
-- Admin only. Generates a short, human-typable, unambiguous 6-char code,
-- updates the pool, returns it.
-- ===========================================================================
create or replace function public.rotate_invite_code(p_pool_id bigint)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  -- Unambiguous alphabet: no 0/O, 1/I/L.
  v_alpha text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_code text;
  v_i int;
  v_try int := 0;
begin
  if not private.is_pool_admin(coalesce(v_uid, '00000000-0000-0000-0000-000000000000'::uuid), p_pool_id) then
    raise exception using
      errcode = '42501',
      message = 'Only a pool admin can rotate the invite code.';
  end if;

  loop
    v_try := v_try + 1;
    v_code := '';
    for v_i in 1..6 loop
      v_code := v_code || substr(v_alpha, 1 + floor(random() * length(v_alpha))::int, 1);
    end loop;

    -- Ensure uniqueness across pools.
    exit when not exists (select 1 from public.pools where invite_code = v_code);

    if v_try > 50 then
      raise exception 'rotate_invite_code: could not generate a unique code';
    end if;
  end loop;

  update public.pools
     set invite_code = v_code
   where id = p_pool_id;

  return v_code;
end;
$$;

revoke all on function public.rotate_invite_code(bigint) from public, anon;
grant execute on function public.rotate_invite_code(bigint) to authenticated;

-- ===========================================================================
-- set_member_hidden(p_pool_id, p_user_id, p_hidden) -> void
-- Admin only. Soft-hides a member from the leaderboard.
-- ===========================================================================
create or replace function public.set_member_hidden(
  p_pool_id bigint,
  p_user_id uuid,
  p_hidden  boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not private.is_pool_admin(coalesce(v_uid, '00000000-0000-0000-0000-000000000000'::uuid), p_pool_id) then
    raise exception using
      errcode = '42501',
      message = 'Only a pool admin can hide members.';
  end if;

  update public.memberships
     set hidden = p_hidden
   where pool_id = p_pool_id
     and user_id = p_user_id;
end;
$$;

revoke all on function public.set_member_hidden(bigint, uuid, boolean) from public, anon;
grant execute on function public.set_member_hidden(bigint, uuid, boolean) to authenticated;
