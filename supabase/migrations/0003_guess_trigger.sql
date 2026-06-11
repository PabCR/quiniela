-- 0003_guess_trigger.sql
-- BEFORE INSERT OR UPDATE trigger on guesses.
--
-- Responsibilities:
--   1. points/tag protection: clients must never write points/tag. Unless the
--      session GUC `quiniela.scoring` = 'on' (set only by score_game() via
--      set_config(..., true)), force points and tag to NULL.
--   2. advancer validation:
--        - advancer, when present, must be one of the game's two teams.
--        - advancer is REQUIRED iff the game is a KO stage (stage NOT LIKE
--          'GROUP%') AND the picked score is a draw (home = away).
--        - advancer is CLEARED when the pick is not a draw (home <> away), since
--          a non-draw pick implies its own winner as advancer.
--   3. stamp updated_at = now().

create or replace function public.guesses_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stage   public.stage;
  v_home    text;
  v_away    text;
  v_is_ko   boolean;
  v_scoring boolean;
begin
  -- Is score_game() currently running? GUC missing/blank => treat as off.
  v_scoring := coalesce(
    nullif(current_setting('quiniela.scoring', true), ''),
    'off'
  ) = 'on';

  -- Strip client-supplied points/tag unless the scoring engine set the GUC.
  if not v_scoring then
    new.points := null;
    new.tag    := null;
  end if;

  -- Resolve the game's stage and teams for advancer validation.
  select g.stage, g.home, g.away
    into v_stage, v_home, v_away
  from public.games g
  where g.id = new.game_id;

  if not found then
    raise exception 'guesses_guard: game % does not exist', new.game_id;
  end if;

  v_is_ko := v_stage::text not like 'GROUP%';

  -- A non-draw pick implies its winner; never store a stray advancer.
  if new.home <> new.away then
    new.advancer := null;
  end if;

  -- Validate advancer membership in the matchup (only when set).
  if new.advancer is not null then
    if new.advancer is distinct from v_home
       and new.advancer is distinct from v_away then
      raise exception
        'guesses_guard: advancer % is not one of the game teams (% vs %)',
        new.advancer, coalesce(v_home, 'TBD'), coalesce(v_away, 'TBD');
    end if;
  end if;

  -- advancer REQUIRED iff KO stage AND picked a draw.
  if v_is_ko and new.home = new.away and new.advancer is null then
    raise exception
      'guesses_guard: advancer is required for a knockout draw pick (game %)',
      new.game_id;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger trg_guesses_guard
  before insert or update on public.guesses
  for each row
  execute function public.guesses_guard();
