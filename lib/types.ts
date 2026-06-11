/* Quiniela — shared TypeScript types.
 *
 * Two families of types live here:
 *  1. DB row types that mirror the Supabase schema in CLAUDE-CODE-BRIEF.md §4
 *     exactly (snake_case columns, nullability, enums).
 *  2. App-level / engine types consumed by lib/engine.ts and the UI.
 *
 * No runtime values, no RN/Expo imports — pure type declarations.
 */

/* ------------------------------------------------------------------ *
 * Stage enum (brief §4: postgres `stage` enum)
 * ------------------------------------------------------------------ */

export type GroupStage =
  | 'GROUP_A'
  | 'GROUP_B'
  | 'GROUP_C'
  | 'GROUP_D'
  | 'GROUP_E'
  | 'GROUP_F'
  | 'GROUP_G'
  | 'GROUP_H'
  | 'GROUP_I'
  | 'GROUP_J'
  | 'GROUP_K'
  | 'GROUP_L';

export type KnockoutStage = 'R32' | 'R16' | 'QF' | 'SF' | 'THIRD' | 'FINAL';

export type Stage = GroupStage | KnockoutStage;

/* The 12 group-stage values, useful for the group-letter interpolation. */
export const GROUP_STAGES: readonly GroupStage[] = [
  'GROUP_A',
  'GROUP_B',
  'GROUP_C',
  'GROUP_D',
  'GROUP_E',
  'GROUP_F',
  'GROUP_G',
  'GROUP_H',
  'GROUP_I',
  'GROUP_J',
  'GROUP_K',
  'GROUP_L',
] as const;

export const KNOCKOUT_STAGES: readonly KnockoutStage[] = [
  'R32',
  'R16',
  'QF',
  'SF',
  'THIRD',
  'FINAL',
] as const;

/* ------------------------------------------------------------------ *
 * Result status (brief §4: games.result_status check constraint)
 * ------------------------------------------------------------------ */

export type ResultStatus = 'none' | 'provisional' | 'confirmed';

/* ------------------------------------------------------------------ *
 * DB row types — mirror brief §4 schema column-for-column.
 * `timestamptz` columns are ISO-8601 strings as returned by supabase-js.
 * A 3-letter team code (e.g. 'MEX') is modelled as `TeamCode`.
 * ------------------------------------------------------------------ */

export type TeamCode = string;

/** `tournaments` table row. */
export interface Tournament {
  id: number;
  name: string;
  external_league_id: string | null;
}

/** `teams` table row. */
export interface Team {
  code: TeamCode;
  name_en: string;
  name_es: string;
  flag: string;
}

/** `games` table row. */
export interface Game {
  id: number;
  tournament_id: number;
  external_id: string | null;
  stage: Stage;
  /** nullable: KO slots are TBD before the draw. */
  home: TeamCode | null;
  away: TeamCode | null;
  /** UTC ISO-8601 string; render device-local. */
  kickoff: string;
  location: string | null;
  /** post-ET score (90' if no ET). null until a result exists. */
  score_home: number | null;
  score_away: number | null;
  /** KO only; pens decide the advancer when the post-ET score is drawn. */
  advancer: TeamCode | null;
  result_status: ResultStatus;
  confirmed_at: string | null;
  voided: boolean;
  postponed: boolean;
  corrected: boolean;
  updated_at: string;
}

/** `pools` table row. */
export interface Pool {
  id: number;
  tournament_id: number;
  name: string;
  invite_code: string;
  pts_full: number;
  pts_partial: number;
  scoring_locked: boolean;
  created_by: string | null;
}

/** `profiles` table row. */
export interface Profile {
  id: string;
  name: string;
  emoji: string | null;
  lang: Lang;
}

export type MembershipRole = 'admin' | 'player';

/** `memberships` table row. */
export interface Membership {
  pool_id: number;
  user_id: string;
  role: MembershipRole;
  hidden: boolean;
}

/** `guesses` table row. */
export interface Guess {
  pool_id: number;
  user_id: string;
  game_id: number;
  home: number;
  away: number;
  /** required iff KO stage and home === away. */
  advancer: TeamCode | null;
  /** written ONLY by score_game(); null otherwise. */
  points: number | null;
  tag: ScoredTag | null;
  updated_at: string;
}

/* ------------------------------------------------------------------ *
 * App / engine types
 * ------------------------------------------------------------------ */

export type Lang = 'es' | 'en';

/** A participant's prediction for one game. */
export interface Pick {
  home: number;
  away: number;
  /** advancing team code; required only for KO draws. */
  advancer?: TeamCode | null;
}

/**
 * Scoring tags.
 * `ScoredTag` is the subset persisted in `guesses.tag` (brief §4 check).
 * `Tag` additionally carries 'none' for the in-app "no pick / incomplete" case.
 */
export type ScoredTag = 'exact' | 'outcome' | 'draw' | 'miss';
export type Tag = ScoredTag | 'none';

/** Result of scoring one pick against a result. */
export interface ScoreResult {
  pts: number;
  tag: Tag;
}

/**
 * Match lifecycle status (brief §6.4 precedence:
 * void → final → postponed → live → awaiting → upcoming).
 * 'final' is shown to participants only on a confirmed result; a provisional
 * result renders as 'awaiting' with a separate provisional marker for admins.
 */
export type MatchStatus =
  | 'void'
  | 'final'
  | 'postponed'
  | 'live'
  | 'awaiting'
  | 'upcoming';

/** Lookup of teams by their 3-letter code. */
export type TeamsMap = Record<TeamCode, Team>;

/**
 * A confirmed result distilled from a Game row for scoring.
 * `advancer` is meaningful for KO games only.
 */
export interface MatchResult {
  home: number;
  away: number;
  advancer: TeamCode | null;
}

/** Per-tag tally used by the admin confirm sheet (impactOf). */
export interface ImpactCounts {
  exact: number;
  outcome: number;
  draw: number;
  miss: number;
  none: number;
}

/** A single leaderboard row (port of engine.js standings). */
export interface StandingRow {
  /** participant id (auth user id / member id). */
  id: string;
  pts: number;
  exact: number;
  rank: number;
  /** true when more than one row shares this rank (display "T-2"). */
  tied: boolean;
  /** movement vs previous matchday: 1 up, -1 down, 0 unchanged. */
  move: number;
}

/** Minimal member shape the standings/pending helpers need. */
export interface Member {
  id: string;
}
