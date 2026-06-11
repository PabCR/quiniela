-- 0001_schema.sql
-- Core schema for Quiniela (family World Cup prediction pool).
-- SQL is taken verbatim from the build brief §4 — do not redesign.
-- Indexes and a private helper schema are added at the end.

-- ---------------------------------------------------------------------------
-- Private schema for SECURITY DEFINER helper functions used by RLS policies.
-- Keeping helpers out of `public` avoids exposing them via the Data API and
-- prevents recursive RLS evaluation on the memberships table.
-- ---------------------------------------------------------------------------
create schema if not exists private;

-- ---------------------------------------------------------------------------
-- Tables (brief §4 — exact SQL)
-- ---------------------------------------------------------------------------
create table tournaments (
  id    bigint generated always as identity primary key,
  name  text not null,                       -- 'World Cup 2026'
  external_league_id text                    -- API-Football league id
);

create table teams (
  code     text primary key,                 -- FIFA 3-letter: 'MEX'
  name_en  text not null,
  name_es  text not null,
  flag     text not null                     -- emoji
);

create type stage as enum
  ('GROUP_A','GROUP_B','GROUP_C','GROUP_D','GROUP_E','GROUP_F',
   'GROUP_G','GROUP_H','GROUP_I','GROUP_J','GROUP_K','GROUP_L',
   'R32','R16','QF','SF','THIRD','FINAL');

create table games (
  id            bigint generated always as identity primary key,
  tournament_id bigint not null references tournaments(id),
  external_id   text unique,                 -- API-Football fixture id
  stage         stage not null,
  home          text references teams(code), -- nullable: KO slots TBD pre-draw
  away          text references teams(code),
  kickoff       timestamptz not null,        -- UTC; render device-local
  location      text,
  score_home    smallint,                    -- post-ET score (90' if no ET)
  score_away    smallint,
  advancer      text references teams(code), -- KO only; pens decide when draw
  result_status text not null default 'none'
                check (result_status in ('none','provisional','confirmed')),
  confirmed_at  timestamptz,
  voided        boolean not null default false,
  postponed     boolean not null default false,
  corrected     boolean not null default false,
  updated_at    timestamptz not null default now()
);

create table pools (
  id             bigint generated always as identity primary key,
  tournament_id  bigint not null references tournaments(id),
  name           text not null,
  invite_code    text not null unique,        -- short, human-typable; admin can rotate
  pts_full       smallint not null default 3,
  pts_partial    smallint not null default 1,
  scoring_locked boolean not null default false,
  created_by     uuid references auth.users(id)
);

create table profiles (
  id     uuid primary key references auth.users(id) on delete cascade,
  name   text not null,
  emoji  text,
  lang   text not null default 'es' check (lang in ('es','en'))
);

create table memberships (
  pool_id  bigint references pools(id),
  user_id  uuid references profiles(id),
  role     text not null default 'player' check (role in ('admin','player')),
  hidden   boolean not null default false,
  primary key (pool_id, user_id)
);

create table guesses (
  pool_id    bigint not null,
  user_id    uuid not null,
  game_id    bigint not null references games(id),
  home       smallint not null check (home between 0 and 15),
  away       smallint not null check (away between 0 and 15),
  advancer   text references teams(code),  -- required iff KO stage and home = away
  points     smallint,                     -- written ONLY by score_game()
  tag        text check (tag in ('exact','outcome','draw','miss')),
  updated_at timestamptz not null default now(),
  primary key (pool_id, user_id, game_id),
  foreign key (pool_id, user_id) references memberships(pool_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Indexes (brief task list)
-- ---------------------------------------------------------------------------
create index idx_guesses_game_id  on guesses (game_id);
create index idx_guesses_pool_user on guesses (pool_id, user_id);
create index idx_games_kickoff    on games (kickoff);
create index idx_games_tournament on games (tournament_id);
create index idx_memberships_user on memberships (user_id);
create index idx_pools_tournament on pools (tournament_id);
