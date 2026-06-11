-- =============================================================================
-- Quiniela — local dev seed
-- =============================================================================
-- Purpose: populate local Supabase stack with enough data to reach every
--          match-card state (brief §12 acceptance) and pick variety.
--
-- Run against local stack:
--   supabase db reset                      (resets + runs migrations + this file)
--   -- OR directly:
--   psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f supabase/seed/seed-dev.sql
--
-- Re-entrant: wrapped in a transaction; truncates seeded tables first.
-- DO NOT run against any remote project.
-- =============================================================================

BEGIN;

-- ─── wipe existing seed data ──────────────────────────────────────────────────
-- Order matters: FK children before parents.
TRUNCATE guesses, memberships, profiles, pools, games, teams, tournaments
  CASCADE;

-- Also clear any auth users we're about to re-create (local stack only)
DELETE FROM auth.users
  WHERE email LIKE '%@quiniela.dev'
     OR email = 'palv2602@gmail.com';

-- ─── teams (subset from prototype data.js) ───────────────────────────────────

INSERT INTO teams (code, name_en, name_es, flag) VALUES
  ('MEX', 'Mexico',              'México',             '🇲🇽'),
  ('RSA', 'South Africa',        'Sudáfrica',          '🇿🇦'),
  ('KOR', 'South Korea',         'Corea del Sur',      '🇰🇷'),
  ('CZE', 'Czechia',             'Chequia',            '🇨🇿'),
  ('CAN', 'Canada',              'Canadá',             '🇨🇦'),
  ('BIH', 'Bosnia & Herzegovina','Bosnia y Herzegovina','🇧🇦'),
  ('USA', 'United States',       'Estados Unidos',     '🇺🇸'),
  ('PAR', 'Paraguay',            'Paraguay',           '🇵🇾'),
  ('QAT', 'Qatar',               'Catar',              '🇶🇦'),
  ('SUI', 'Switzerland',         'Suiza',              '🇨🇭'),
  ('BRA', 'Brazil',              'Brasil',             '🇧🇷'),
  ('MAR', 'Morocco',             'Marruecos',          '🇲🇦'),
  ('HAI', 'Haiti',               'Haití',              '🇭🇹'),
  ('SCO', 'Scotland',            'Escocia',            '🏴󠁧󠁢󠁳󠁣󠁴󠁿'),
  ('GER', 'Germany',             'Alemania',           '🇩🇪'),
  ('CUW', 'Curaçao',             'Curazao',            '🇨🇼'),
  ('CIV', 'Ivory Coast',         'Costa de Marfil',    '🇨🇮'),
  ('ECU', 'Ecuador',             'Ecuador',            '🇪🇨'),
  ('AUS', 'Australia',           'Australia',          '🇦🇺'),
  ('TUR', 'Türkiye',             'Turquía',            '🇹🇷')
ON CONFLICT (code) DO NOTHING;

-- ─── tournament ───────────────────────────────────────────────────────────────

INSERT INTO tournaments (name, external_league_id)
  VALUES ('World Cup 2026', '1')
ON CONFLICT DO NOTHING;

-- ─── games (all times relative to now()) ─────────────────────────────────────
-- Every match-card state must be reachable:
--   (A) finished + confirmed result → scoring trigger fires → exact/partial/miss washes
--   (B) finished awaiting result    → kickoff ~3h ago, no result
--   (C) live                        → kickoff ~60min ago
--   (D) upcoming <2h, no pick       → urgent state
--   (E) upcoming >2h                → normal upcoming
--   (F) postponed                   → postponed=true, future kickoff
--   (G) voided
--   (H) KO game upcoming            → stage R32
--   (I) KO game finished, draw + advancer

-- We use the 'external_id' column to give deterministic IDs we can reference below.

INSERT INTO games (
  tournament_id, external_id, stage, home, away,
  kickoff, location,
  score_home, score_away, advancer,
  result_status, confirmed_at,
  voided, postponed
)
SELECT
  t.id,
  g.external_id,
  g.stage::stage,
  g.home_code,
  g.away_code,
  g.kickoff,
  g.location,
  g.score_home,
  g.score_away,
  g.advancer,
  g.result_status,
  g.confirmed_at,
  g.voided,
  g.postponed
FROM tournaments t
CROSS JOIN (VALUES
  -- (A1) finished + confirmed: MEX 2-1 RSA  (exact/outcome/miss washes covered by picks below)
  ('dev-m1',  'GROUP_A', 'MEX', 'RSA',
    now() - INTERVAL '2 days', 'Mexico City',
    2,    1,    NULL,   'confirmed', now() - INTERVAL '2 days', false, false),

  -- (A2) finished + confirmed: CAN 1-1 BIH  (draw picks → outcome, home/away win picks → miss)
  ('dev-m2',  'GROUP_B', 'CAN', 'BIH',
    now() - INTERVAL '1 day 6 hours', 'Toronto',
    1,    1,    NULL,   'confirmed', now() - INTERVAL '1 day 6 hours', false, false),

  -- (B) finished awaiting result: USA vs PAR — kicked off 3h ago, no result yet
  ('dev-m3',  'GROUP_D', 'USA', 'PAR',
    now() - INTERVAL '3 hours', 'New York',
    NULL, NULL, NULL,   'none',      NULL,                               false, false),

  -- (C) live: QAT vs SUI — kicked off 60 min ago
  ('dev-m4',  'GROUP_B', 'QAT', 'SUI',
    now() - INTERVAL '60 minutes', 'Doha',
    NULL, NULL, NULL,   'none',      NULL,                               false, false),

  -- (D) upcoming urgent <2h, no pick for Pablo
  ('dev-m5',  'GROUP_C', 'BRA', 'MAR',
    now() + INTERVAL '90 minutes', 'Los Angeles',
    NULL, NULL, NULL,   'none',      NULL,                               false, false),

  -- (E) upcoming >2h
  ('dev-m6',  'GROUP_C', 'HAI', 'SCO',
    now() + INTERVAL '4 hours', 'Miami',
    NULL, NULL, NULL,   'none',      NULL,                               false, false),

  -- (E2) upcoming >2h — different group, no picks yet
  ('dev-m7',  'GROUP_E', 'GER', 'CUW',
    now() + INTERVAL '26 hours', 'Dallas',
    NULL, NULL, NULL,   'none',      NULL,                               false, false),

  -- (F) postponed: AUS vs TUR — postponed to tomorrow
  ('dev-m8',  'GROUP_D', 'AUS', 'TUR',
    now() + INTERVAL '28 hours', 'Houston',
    NULL, NULL, NULL,   'none',      NULL,                               false, true),

  -- (G) voided: KOR vs CZE
  ('dev-m9',  'GROUP_A', 'KOR', 'CZE',
    now() - INTERVAL '3 days', 'Seattle',
    NULL, NULL, NULL,   'none',      NULL,                               true,  false),

  -- (H) KO upcoming: MEX vs SCO (R32), teams known, no picks yet
  ('dev-m10', 'R32',     'MEX', 'SCO',
    now() + INTERVAL '3 days', 'San Francisco',
    NULL, NULL, NULL,   'none',      NULL,                               false, false),

  -- (I) KO finished, 1-1 draw → MEX advances on pens (confirmed)
  ('dev-m11', 'R16',     'MEX', 'BRA',
    now() - INTERVAL '4 days', 'Kansas City',
    1,    1,    'MEX',  'confirmed', now() - INTERVAL '4 days',         false, false)

) AS g(external_id, stage, home_code, away_code,
        kickoff, location,
        score_home, score_away, advancer,
        result_status, confirmed_at, voided, postponed)
WHERE t.name = 'World Cup 2026';

-- ─── pool ─────────────────────────────────────────────────────────────────────

INSERT INTO pools (tournament_id, name, invite_code, pts_full, pts_partial, scoring_locked)
SELECT t.id, 'Quiniela Familiar', 'DEV123', 3, 1, false
FROM tournaments t WHERE t.name = 'World Cup 2026'
ON CONFLICT (invite_code) DO NOTHING;

-- ─── auth users (fake members, local stack only) ──────────────────────────────
-- Pablo (admin) + 6 fake family members
-- auth.users requires: id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data

INSERT INTO auth.users (
  id, instance_id, aud, role,
  email, encrypted_password,
  email_confirmed_at, confirmation_sent_at,
  created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data
) VALUES
  -- Pablo (admin)
  ('00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'palv2602@gmail.com', crypt('devpassword', gen_salt('bf')),
   now(), now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}'),

  -- Fake family members
  ('00000000-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'carmen@quiniela.dev', crypt('devpassword', gen_salt('bf')),
   now(), now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}'),

  ('00000000-0000-0000-0000-000000000003',
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'jose@quiniela.dev', crypt('devpassword', gen_salt('bf')),
   now(), now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}'),

  ('00000000-0000-0000-0000-000000000004',
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'lupita@quiniela.dev', crypt('devpassword', gen_salt('bf')),
   now(), now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}'),

  ('00000000-0000-0000-0000-000000000005',
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'diego@quiniela.dev', crypt('devpassword', gen_salt('bf')),
   now(), now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}'),

  ('00000000-0000-0000-0000-000000000006',
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'raul@quiniela.dev', crypt('devpassword', gen_salt('bf')),
   now(), now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}'),

  ('00000000-0000-0000-0000-000000000007',
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'sofia@quiniela.dev', crypt('devpassword', gen_salt('bf')),
   now(), now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}')
ON CONFLICT (id) DO NOTHING;

-- ─── profiles ─────────────────────────────────────────────────────────────────

INSERT INTO profiles (id, name, emoji, lang) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Pablo',       '🦊', 'es'),
  ('00000000-0000-0000-0000-000000000002', 'Tía Carmen',  '🌺', 'es'),
  ('00000000-0000-0000-0000-000000000003', 'Abuelo José', '🎩', 'es'),
  ('00000000-0000-0000-0000-000000000004', 'Lupita',      '🐱', 'es'),
  ('00000000-0000-0000-0000-000000000005', 'Diego',       '⚽', 'es'),
  ('00000000-0000-0000-0000-000000000006', 'Tío Raúl',    '🌮', 'es'),
  ('00000000-0000-0000-0000-000000000007', 'Sofía',       '🌟', 'es')
ON CONFLICT (id) DO NOTHING;

-- ─── memberships ─────────────────────────────────────────────────────────────

INSERT INTO memberships (pool_id, user_id, role, hidden)
SELECT p.id, m.user_id::uuid, m.role, false
FROM pools p
CROSS JOIN (VALUES
  ('00000000-0000-0000-0000-000000000001', 'admin'),
  ('00000000-0000-0000-0000-000000000002', 'player'),
  ('00000000-0000-0000-0000-000000000003', 'player'),
  ('00000000-0000-0000-0000-000000000004', 'player'),
  ('00000000-0000-0000-0000-000000000005', 'player'),
  ('00000000-0000-0000-0000-000000000006', 'player'),
  ('00000000-0000-0000-0000-000000000007', 'player')
) AS m(user_id, role)
WHERE p.name = 'Quiniela Familiar'
ON CONFLICT (pool_id, user_id) DO NOTHING;

-- ─── guesses (picks) ─────────────────────────────────────────────────────────
-- We insert home/away/advancer only; points+tag are computed by the scoring
-- trigger when games are confirmed. We bypass RLS by running as service role /
-- postgres in the local migration context.
--
-- Varieties to cover per brief §12 acceptance:
--   exact:     pablo on m1 (2-1 ✓), carmen on m1 (2-1 ✓)
--   outcome:   jose on m1 (1-0, result 2-1 — correct sign), pablo on m2 (2-1, result 1-1 → miss)
--   draw:      carmen on m2 (1-1 = exact draw), lupita on m2 (0-0 = outcome draw)
--   miss:      sofia on m1 (0-1, wrong sign)
--   no pick:   Pablo has no pick on dev-m5 (urgent upcoming) — intentional omission below
--   KO exact:  pablo on m11 (1-1 adv=MEX — matches confirmed result)
--   KO draw:   carmen on m11 (2-2 adv=MEX — draw correct, advancer correct → exact... wait, rule 2 before 3)
--              raul on m11 (1-1 adv=BRA — draw correct, advancer wrong → draw tag)
--   KO outcome:diego on m11 (2-1 MEX advances by score — advancer correct, score mismatch → outcome)
--   KO miss:   sofia on m11 (2-1 pick, BRA advances → miss)

INSERT INTO guesses (pool_id, user_id, game_id, home, away, advancer, updated_at)
SELECT
  p.id,
  g_vals.user_id::uuid,
  gm.id,
  g_vals.home,
  g_vals.away,
  g_vals.advancer,
  now()
FROM pools p
CROSS JOIN (VALUES

  -- ── game dev-m1: MEX 2-1 RSA (confirmed) ───────────────────────────────
  -- exact: pablo 2-1, carmen 2-1
  -- outcome: jose 1-0 (home wins → correct sign), lupita 3-1 (home wins → correct sign)
  -- miss: sofia 0-1 (away win → wrong sign)
  -- no_pick: (no row for raul — em-dash in leaderboard)
  ('dev-m1', '00000000-0000-0000-0000-000000000001', 2, 1, NULL),  -- pablo EXACT
  ('dev-m1', '00000000-0000-0000-0000-000000000002', 2, 1, NULL),  -- carmen EXACT
  ('dev-m1', '00000000-0000-0000-0000-000000000003', 1, 0, NULL),  -- jose OUTCOME
  ('dev-m1', '00000000-0000-0000-0000-000000000004', 3, 1, NULL),  -- lupita OUTCOME
  ('dev-m1', '00000000-0000-0000-0000-000000000007', 0, 1, NULL),  -- sofia MISS

  -- ── game dev-m2: CAN 1-1 BIH (confirmed) ──────────────────────────────
  -- exact draw: carmen 1-1
  -- outcome draw: lupita 0-0 (draw sign = draw sign → outcome)
  -- miss: pablo 2-1 (home win pick, result draw → miss)
  --       jose 1-0 (home win pick, result draw → miss)
  ('dev-m2', '00000000-0000-0000-0000-000000000001', 2, 1, NULL),  -- pablo MISS
  ('dev-m2', '00000000-0000-0000-0000-000000000002', 1, 1, NULL),  -- carmen EXACT
  ('dev-m2', '00000000-0000-0000-0000-000000000003', 1, 0, NULL),  -- jose MISS
  ('dev-m2', '00000000-0000-0000-0000-000000000004', 0, 0, NULL),  -- lupita OUTCOME
  ('dev-m2', '00000000-0000-0000-0000-000000000005', 1, 1, NULL),  -- diego EXACT

  -- ── game dev-m3: USA vs PAR (awaiting, no result yet) ─────────────────
  -- Picks are locked (kickoff past), points null until admin enters result
  ('dev-m3', '00000000-0000-0000-0000-000000000001', 2, 0, NULL),  -- pablo
  ('dev-m3', '00000000-0000-0000-0000-000000000002', 1, 0, NULL),  -- carmen
  ('dev-m3', '00000000-0000-0000-0000-000000000003', 2, 1, NULL),  -- jose
  ('dev-m3', '00000000-0000-0000-0000-000000000005', 3, 1, NULL),  -- diego

  -- ── game dev-m4: QAT vs SUI (live ~60min) ─────────────────────────────
  -- Picks are locked
  ('dev-m4', '00000000-0000-0000-0000-000000000001', 0, 2, NULL),  -- pablo
  ('dev-m4', '00000000-0000-0000-0000-000000000002', 0, 1, NULL),  -- carmen
  ('dev-m4', '00000000-0000-0000-0000-000000000005', 1, 1, NULL),  -- diego
  ('dev-m4', '00000000-0000-0000-0000-000000000006', 2, 1, NULL),  -- raul

  -- ── game dev-m5: BRA vs MAR (<2h, urgent) ─────────────────────────────
  -- Pablo intentionally has NO pick → "urgent unpicked" card state
  -- Others have picks (visible count, but hidden values pre-lock)
  ('dev-m5', '00000000-0000-0000-0000-000000000002', 3, 0, NULL),  -- carmen
  ('dev-m5', '00000000-0000-0000-0000-000000000003', 2, 0, NULL),  -- jose
  ('dev-m5', '00000000-0000-0000-0000-000000000004', 2, 1, NULL),  -- lupita
  ('dev-m5', '00000000-0000-0000-0000-000000000005', 4, 1, NULL),  -- diego

  -- ── game dev-m6: HAI vs SCO (>2h upcoming) ────────────────────────────
  -- Pablo has picked
  ('dev-m6', '00000000-0000-0000-0000-000000000001', 1, 2, NULL),  -- pablo (picked)
  ('dev-m6', '00000000-0000-0000-0000-000000000002', 0, 1, NULL),  -- carmen

  -- ── game dev-m10: MEX vs SCO KO upcoming ──────────────────────────────
  -- A few picks with advancers (draw picks must have advancer)
  ('dev-m10', '00000000-0000-0000-0000-000000000002', 1, 1, 'MEX'),  -- carmen: draw, MEX adv
  ('dev-m10', '00000000-0000-0000-0000-000000000005', 2, 1, NULL),   -- diego: MEX by score
  ('dev-m10', '00000000-0000-0000-0000-000000000006', 0, 0, 'SCO'),  -- raul: draw, SCO adv

  -- ── game dev-m11: MEX vs BRA KO R16 confirmed (1-1, MEX advances) ─────
  -- KO scoring variants:
  -- pablo:  1-1 adv=MEX → exact score + correct advancer → EXACT
  -- carmen: 2-2 adv=MEX → draw + correct advancer → DRAW (rule 2 before rule 3)
  -- raul:   1-1 adv=BRA → draw + wrong advancer    → DRAW (rule 2, any draw pick on draw result)
  -- diego:  2-1 (MEX by score, no draw) → advancer correct → OUTCOME
  -- sofia:  2-1 (BRA implied by... wait, 2-1 means MEX wins by score, advancer=MEX) → OUTCOME
  --         actually let's make sofia 1-2 → BRA implied, wrong adv → MISS
  ('dev-m11', '00000000-0000-0000-0000-000000000001', 1, 1, 'MEX'),  -- pablo KO EXACT
  ('dev-m11', '00000000-0000-0000-0000-000000000002', 2, 2, 'MEX'),  -- carmen KO DRAW (rule 2)
  ('dev-m11', '00000000-0000-0000-0000-000000000006', 1, 1, 'BRA'),  -- raul KO DRAW (rule 2, wrong adv)
  ('dev-m11', '00000000-0000-0000-0000-000000000005', 2, 1, NULL),   -- diego KO OUTCOME (correct adv by score)
  ('dev-m11', '00000000-0000-0000-0000-000000000007', 1, 2, NULL)    -- sofia KO MISS (BRA by score, wrong adv)

) AS g_vals(ext_id, user_id, home, away, advancer)
JOIN games gm ON gm.external_id = g_vals.ext_id
WHERE p.name = 'Quiniela Familiar'
ON CONFLICT (pool_id, user_id, game_id) DO UPDATE
  SET home = EXCLUDED.home,
      away = EXCLUDED.away,
      advancer = EXCLUDED.advancer,
      updated_at = EXCLUDED.updated_at;

-- ─── trigger scoring for confirmed games ─────────────────────────────────────
-- The scoring trigger fires on UPDATE of score_home/score_away/advancer/result_status
-- when result_status transitions to 'confirmed'. We force a no-op update on
-- confirmed games so the trigger re-evaluates all guesses.
--
-- NOTE: score_game() must be defined in migrations before this seed runs.
-- If running seed-dev.sql independently (not via supabase db reset), ensure
-- migrations have already been applied.

SELECT public.score_game(g.id)
FROM games g
WHERE g.external_id IN ('dev-m1', 'dev-m2', 'dev-m11')
  AND g.result_status = 'confirmed';

-- ─── verify ───────────────────────────────────────────────────────────────────

DO $$
DECLARE
  team_count    int;
  game_count    int;
  member_count  int;
  guess_count   int;
BEGIN
  SELECT COUNT(*) INTO team_count   FROM teams;
  SELECT COUNT(*) INTO game_count   FROM games;
  SELECT COUNT(*) INTO member_count FROM memberships;
  SELECT COUNT(*) INTO guess_count  FROM guesses;

  RAISE NOTICE 'Seed summary: % teams, % games, % members, % guesses',
    team_count, game_count, member_count, guess_count;

  IF game_count < 11 THEN
    RAISE EXCEPTION 'Expected at least 11 games, found %', game_count;
  END IF;
  IF member_count < 7 THEN
    RAISE EXCEPTION 'Expected 7 memberships, found %', member_count;
  END IF;
END;
$$;

COMMIT;
