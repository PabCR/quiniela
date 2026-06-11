-- 0005_scoring.sql
-- score_game(p_game_id) — plpgsql port of prototype scorePick (engine.js).
--
-- Brief §5 rules:
--   GROUP stage (stage LIKE 'GROUP%'):
--     exact score                         -> pts_full,    tag 'exact'
--     correct outcome (sign of goal diff) -> pts_partial,  tag 'outcome'
--     else                                -> 0,            tag 'miss'
--   KNOCKOUT (stage NOT LIKE 'GROUP%'), scored on post-ET score + advancer,
--   first matching rule wins (NO stacking):
--     1. exact post-ET score AND correct advancer -> pts_full,    'exact'
--     2. pick is a draw AND result is a draw       -> pts_partial, 'draw'
--     3. correct advancer                          -> pts_partial, 'outcome'
--     4. otherwise                                 -> 0,           'miss'
--
--   Advancer of result : higher score wins, else games.advancer (pens).
--   Implied pick advancer: higher pick score, else guesses.advancer.
--   Incomplete pick (KO draw with no advancer) -> points NULL / tag NULL.
--   (The guesses_guard trigger already prevents storing such rows, but we
--    handle it defensively here.)
--
-- Reads pts_full / pts_partial from EACH guess's own pool. Rewrites points+tag
-- for ALL guesses on the game. When the game is voided, NULLs points+tag for
-- all of them. Only scores when result_status = 'confirmed' and not voided.
--
-- SECURITY DEFINER + the `quiniela.scoring` GUC let it write points/tag past
-- the guesses_guard trigger; the GUC is set with is_local = true so it is
-- scoped to the surrounding transaction only.

create or replace function public.score_game(p_game_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  g        public.games%rowtype;
  v_is_ko  boolean;
  gs       record;          -- per-guess row joined with its pool point values
  v_pts    smallint;
  v_tag    text;
  v_result_adv  text;       -- advancing team implied by the result
  v_pick_adv    text;       -- advancing team implied by the pick
  v_pick_complete boolean;
begin
  select * into g from public.games where id = p_game_id;
  if not found then
    return;
  end if;

  -- Allow writes to points/tag inside this transaction only.
  perform set_config('quiniela.scoring', 'on', true);

  -- Voided game: null out points/tag for every guess and stop.
  if g.voided then
    update public.guesses
       set points = null,
           tag    = null
     where game_id = p_game_id;
    perform set_config('quiniela.scoring', 'off', true);
    return;
  end if;

  -- Only confirmed results are scored. (Provisional/none => leave as-is, but
  -- defensively clear any stale points so an un-confirm doesn't keep points.)
  if g.result_status is distinct from 'confirmed'
     or g.score_home is null
     or g.score_away is null then
    update public.guesses
       set points = null,
           tag    = null
     where game_id = p_game_id;
    perform set_config('quiniela.scoring', 'off', true);
    return;
  end if;

  v_is_ko := g.stage::text not like 'GROUP%';

  -- Advancer implied by the result (KO only).
  if v_is_ko then
    if g.score_home > g.score_away then
      v_result_adv := g.home;
    elsif g.score_away > g.score_home then
      v_result_adv := g.away;
    else
      v_result_adv := g.advancer;   -- drawn KO: pens decide
    end if;
  end if;

  for gs in
    select gu.pool_id, gu.user_id, gu.home, gu.away, gu.advancer,
           p.pts_full, p.pts_partial
    from public.guesses gu
    join public.pools p on p.id = gu.pool_id
    where gu.game_id = p_game_id
  loop
    -- Completeness check (defensive; trigger normally enforces this).
    v_pick_complete := true;
    if gs.home is null or gs.away is null then
      v_pick_complete := false;
    elsif v_is_ko and gs.home = gs.away and gs.advancer is null then
      v_pick_complete := false;
    end if;

    if not v_pick_complete then
      v_pts := null;
      v_tag := null;
    elsif not v_is_ko then
      -- GROUP stage
      if gs.home = g.score_home and gs.away = g.score_away then
        v_pts := gs.pts_full;  v_tag := 'exact';
      elsif sign(gs.home - gs.away) = sign(g.score_home - g.score_away) then
        v_pts := gs.pts_partial; v_tag := 'outcome';
      else
        v_pts := 0; v_tag := 'miss';
      end if;
    else
      -- KNOCKOUT stage
      if gs.home > gs.away then
        v_pick_adv := g.home;
      elsif gs.away > gs.home then
        v_pick_adv := g.away;
      else
        v_pick_adv := gs.advancer;
      end if;

      if gs.home = g.score_home and gs.away = g.score_away
         and v_pick_adv is not distinct from v_result_adv then
        v_pts := gs.pts_full; v_tag := 'exact';                 -- rule 1
      elsif g.score_home = g.score_away and gs.home = gs.away then
        v_pts := gs.pts_partial; v_tag := 'draw';               -- rule 2
      elsif v_pick_adv is not distinct from v_result_adv then
        v_pts := gs.pts_partial; v_tag := 'outcome';            -- rule 3
      else
        v_pts := 0; v_tag := 'miss';                            -- rule 4
      end if;
    end if;

    update public.guesses
       set points = v_pts,
           tag    = v_tag
     where pool_id = gs.pool_id
       and user_id = gs.user_id
       and game_id = p_game_id;
  end loop;

  perform set_config('quiniela.scoring', 'off', true);
end;
$$;

revoke all on function public.score_game(bigint) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Trigger on games: re-score when a result is confirmed or relevant fields
-- change. Fires AFTER UPDATE of score_home/score_away/advancer/voided/
-- result_status when:
--   * the new state is confirmed, OR
--   * the voided flag flipped, OR
--   * a previously-confirmed result had a relevant field changed (correction).
-- ---------------------------------------------------------------------------
create or replace function public.games_score_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.result_status = 'confirmed')
     or (old.voided is distinct from new.voided)
     or (old.result_status = 'confirmed' and (
            old.score_home is distinct from new.score_home
         or old.score_away is distinct from new.score_away
         or old.advancer   is distinct from new.advancer
         or old.result_status is distinct from new.result_status
        ))
  then
    perform public.score_game(new.id);
  end if;
  return new;
end;
$$;

create trigger trg_games_score
  after update of score_home, score_away, advancer, voided, result_status
  on public.games
  for each row
  execute function public.games_score_trigger();
