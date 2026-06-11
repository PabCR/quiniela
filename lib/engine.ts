/* Quiniela — scoring engine + match status + standings + date formatting.
 *
 * Faithful TypeScript port of prototype/app/engine.js operating on the
 * DB-shaped `Game` rows from CLAUDE-CODE-BRIEF.md §4, with the §6 required
 * changes:
 *
 *  - No globals. Every function takes `now: Date`, `teams`, and the pool's
 *    point values as explicit parameters. Pure functions only; no RN/Expo
 *    imports, no module-level mutable state.
 *  - resultOf() returns non-null only for confirmed results (participants see
 *    final only on confirmed). isProvisional() exposes the provisional case
 *    for the admin screen.
 *  - Status precedence: void → final(confirmed) → postponed → live →
 *    awaiting → upcoming. Live window: GROUP 115 min, KO 165 min.
 *  - liveMinute() may exceed 90 for KO (cap 120; caller renders "120+");
 *    group cap 90.
 *  - Stage labels come from the full enum (group letter interpolation +
 *    R32/R16/QF/SF/THIRD/FINAL i18n keys).
 */

import type { Translate } from './i18n';
import type {
  Game,
  ImpactCounts,
  Lang,
  Member,
  MatchResult,
  MatchStatus,
  Pick,
  ScoreResult,
  StandingRow,
  Stage,
  TeamCode,
  TeamsMap,
} from './types';

const MS_MIN = 60_000;

/* Live-window cutoffs (minutes after kickoff). Brief §6.2. */
const LIVE_WINDOW_GROUP = 115;
const LIVE_WINDOW_KO = 165;

/* liveMinute caps. Brief §6.2: group 90, KO 120 (caller renders "120+"). */
const MINUTE_CAP_GROUP = 90;
const MINUTE_CAP_KO = 120;

/* Provisional → confirmed marker key isn't needed here; status handles it. */

/* ------------------------------------------------------------------ *
 * Pick / Guess shapes accepted by the engine.
 * The engine is tolerant about where a pick comes from: an app `Pick`
 * ({home, away, advancer?}) or a DB-ish guess row ({home, away, advancer}).
 * `null`/`undefined` mean "no pick".
 * ------------------------------------------------------------------ */
export type EnginePick = Pick | null | undefined;

/** A member's picks keyed by game id. */
export type PicksByGame = Record<number, EnginePick>;

/** Everyone's picks: gameId → (memberId → pick). */
export type AllPicks = Record<number, Record<string, EnginePick>>;

/* ------------------------------------------------------------------ *
 * Stage helpers
 * ------------------------------------------------------------------ */

/** A knockout stage is any stage that does not start with 'GROUP'. */
export function isKO(game: { stage: Stage }): boolean {
  return !game.stage.startsWith('GROUP');
}

/** True when a status means the pick is locked (live/awaiting/final). */
export function isLocked(status: MatchStatus): boolean {
  return status === 'live' || status === 'awaiting' || status === 'final';
}

/* ------------------------------------------------------------------ *
 * Results
 * ------------------------------------------------------------------ */

/** Parse a game's kickoff (ISO-8601 UTC string) into a Date. */
export function kickoffOf(game: Game): Date {
  return new Date(game.kickoff);
}

/**
 * The scorable result of a game — non-null ONLY when the result is confirmed
 * (brief §6.4: participants see a final result only once confirmed).
 * A provisional result returns null here; use isProvisional() for the admin UI.
 */
export function resultOf(game: Game): MatchResult | null {
  if (game.result_status !== 'confirmed') return null;
  if (game.score_home == null || game.score_away == null) return null;
  return {
    home: game.score_home,
    away: game.score_away,
    advancer: game.advancer ?? null,
  };
}

/** True when a game has an unconfirmed (auto-synced) result awaiting admin confirm. */
export function isProvisional(game: Game): boolean {
  return game.result_status === 'provisional';
}

/* ------------------------------------------------------------------ *
 * Match status (brief §6.4 precedence)
 *   void → final(confirmed) → postponed → live → awaiting → upcoming
 * ------------------------------------------------------------------ */

export function statusOf(game: Game, now: Date): MatchStatus {
  if (game.voided) return 'void';
  // final only when confirmed
  if (resultOf(game) != null) return 'final';
  const ko = kickoffOf(game);
  if (game.postponed && now < ko) return 'postponed';
  if (now >= ko) {
    const mins = (now.getTime() - ko.getTime()) / MS_MIN;
    const window = isKO(game) ? LIVE_WINDOW_KO : LIVE_WINDOW_GROUP;
    return mins > window ? 'awaiting' : 'live';
  }
  return 'upcoming';
}

/**
 * Minute to display while a game is live.
 * May exceed 90 for KO games (extra time); capped at 120 (caller renders
 * "120+" when capped). Group games cap at 90.
 */
export function liveMinute(game: Game, now: Date): number {
  const ko = kickoffOf(game);
  const cap = isKO(game) ? MINUTE_CAP_KO : MINUTE_CAP_GROUP;
  const raw = Math.round((now.getTime() - ko.getTime()) / MS_MIN - 1);
  return Math.min(cap, Math.max(1, raw));
}

/* ------------------------------------------------------------------ *
 * Picks
 * ------------------------------------------------------------------ */

/** A pick is complete unless a score is missing, or it's a KO draw with no advancer. */
export function pickComplete(pick: EnginePick, game: { stage: Stage }): boolean {
  if (!pick || pick.home == null || pick.away == null) return false;
  if (isKO(game) && pick.home === pick.away && !pick.advancer) return false;
  return true;
}

/**
 * The advancing team for a KO game given its result:
 * non-draw → the higher-scoring side; draw → the explicit penalty winner.
 * Group games (or no result) → null.
 */
export function advancerOf(game: Game, result: MatchResult | null): TeamCode | null {
  if (!isKO(game) || !result) return null;
  if (result.home > result.away) return game.home;
  if (result.away > result.home) return game.away;
  return result.advancer ?? null;
}

/* ------------------------------------------------------------------ *
 * Scoring (brief §5 table)
 * ------------------------------------------------------------------ */

/**
 * Score one pick against a game's result.
 *
 *  - Returns { pts: 0, tag: 'none' } for an incomplete / absent pick
 *    (rendered as an em-dash, never "0").
 *  - Returns null when there is no result to score against yet.
 *  - `ptsFull` / `ptsPartial` come from the pool (defaults 3 / 1).
 *
 * Knockout ordering matters (brief rule 10): a draw pick on a drawn result
 * scores `draw` (rule 2) BEFORE the advancer check (rule 3), so a 2-2 draw
 * pick on a 1-1 result can never award full/`outcome` over `draw`.
 */
export function scorePick(
  pick: EnginePick,
  game: Game,
  result: MatchResult | null,
  ptsFull: number,
  ptsPartial: number,
): ScoreResult | null {
  if (!pickComplete(pick, game)) return { pts: 0, tag: 'none' };
  if (!result) return null;

  // pickComplete guarantees pick is non-null with numeric home/away here.
  const p = pick as Pick;

  if (!isKO(game)) {
    if (p.home === result.home && p.away === result.away) {
      return { pts: ptsFull, tag: 'exact' };
    }
    const sg = Math.sign(p.home - p.away);
    const so = Math.sign(result.home - result.away);
    return sg === so ? { pts: ptsPartial, tag: 'outcome' } : { pts: 0, tag: 'miss' };
  }

  // Knockout
  const realAdv = advancerOf(game, result);
  const pickAdv =
    p.home > p.away ? game.home : p.away > p.home ? game.away : (p.advancer ?? null);

  // Rule 1: exact post-ET score AND correct advancer
  if (p.home === result.home && p.away === result.away && pickAdv === realAdv) {
    return { pts: ptsFull, tag: 'exact' };
  }
  // Rule 2: pick is a draw AND result is a draw (before the advancer check)
  if (result.home === result.away && p.home === p.away) {
    return { pts: ptsPartial, tag: 'draw' };
  }
  // Rule 3: correct advancer
  if (pickAdv === realAdv) {
    return { pts: ptsPartial, tag: 'outcome' };
  }
  // Rule 4: otherwise
  return { pts: 0, tag: 'miss' };
}

/**
 * Admin confirm-sheet impact: per-tag tally for a hypothetical result across
 * a member list. Used by the confirm sheet to show "this awards N exact…".
 */
export function impactOf(
  game: Game,
  result: MatchResult | null,
  allPicks: AllPicks,
  members: readonly Member[],
  ptsFull: number,
  ptsPartial: number,
): ImpactCounts {
  const c: ImpactCounts = { exact: 0, outcome: 0, draw: 0, miss: 0, none: 0 };
  const forGame = allPicks[game.id] ?? {};
  for (const mb of members) {
    const s = scorePick(forGame[mb.id], game, result, ptsFull, ptsPartial);
    c[(s ?? { tag: 'none' as const }).tag]++;
  }
  return c;
}

/* ------------------------------------------------------------------ *
 * Standings
 * ------------------------------------------------------------------ */

/**
 * Compute standings over the games whose status is 'final' (confirmed).
 * `onlyIds`, when given, restricts the count to those game ids (used by the
 * movement calculation to score "as of the previous matchday").
 *
 * Sort: points desc → exact count desc. Shared ranks for ties, with a `tied`
 * flag when a rank is shared (display "T-2").
 */
export function standings(
  members: readonly Member[],
  games: readonly Game[],
  allPicks: AllPicks,
  now: Date,
  ptsFull: number,
  ptsPartial: number,
  onlyIds?: readonly number[],
): StandingRow[] {
  const rows: StandingRow[] = members.map((mb) => {
    let pts = 0;
    let exact = 0;
    for (const g of games) {
      if (onlyIds && !onlyIds.includes(g.id)) continue;
      if (statusOf(g, now) !== 'final') continue;
      const s = scorePick((allPicks[g.id] ?? {})[mb.id], g, resultOf(g), ptsFull, ptsPartial);
      if (s) {
        pts += s.pts;
        if (s.tag === 'exact') exact++;
      }
    }
    return { id: mb.id, pts, exact, rank: 0, tied: false, move: 0 };
  });

  rows.sort((a, b) => b.pts - a.pts || b.exact - a.exact);

  let rank = 0;
  let prev: string | null = null;
  rows.forEach((r, i) => {
    const key = r.pts + ':' + r.exact;
    if (key !== prev) {
      rank = i + 1;
      prev = key;
    }
    r.rank = rank;
  });
  for (const r of rows) {
    r.tied = rows.filter((x) => x.rank === r.rank).length > 1;
  }
  return rows;
}

/**
 * Standings with movement vs the previous matchday (port of withMovement).
 * `move`: 1 = climbed, -1 = dropped, 0 = unchanged.
 *
 * "Previous matchday" = the standings computed over all confirmed-final games
 * except the most-recently-kicked-off one. With ≤1 final, movement is 0.
 */
export function standingsWithMovement(
  members: readonly Member[],
  games: readonly Game[],
  allPicks: AllPicks,
  now: Date,
  ptsFull: number,
  ptsPartial: number,
): StandingRow[] {
  const current = standings(members, games, allPicks, now, ptsFull, ptsPartial);

  const finals = games
    .filter((g) => statusOf(g, now) === 'final')
    .sort((a, b) => kickoffOf(a).getTime() - kickoffOf(b).getTime());

  if (finals.length > 1) {
    const prevIds = finals.slice(0, -1).map((g) => g.id);
    const prev = standings(members, games, allPicks, now, ptsFull, ptsPartial, prevIds);
    const prevRank: Record<string, number> = {};
    for (const r of prev) prevRank[r.id] = r.rank;
    for (const r of current) {
      r.move = Math.sign((prevRank[r.id] ?? r.rank) - r.rank);
    }
  } else {
    for (const r of current) r.move = 0;
  }
  return current;
}

/* ------------------------------------------------------------------ *
 * Pending picks
 * ------------------------------------------------------------------ */

/**
 * Games still open for a member to pick (status upcoming or postponed) whose
 * pick is missing or incomplete. A KO draw without an advancer counts as
 * pending. `myOverrides` lets the caller layer unsaved local edits on top.
 */
export function pendingMatches(
  memberId: string,
  games: readonly Game[],
  allPicks: AllPicks,
  now: Date,
  myOverrides?: PicksByGame,
): Game[] {
  return games.filter((g) => {
    const st = statusOf(g, now);
    if (st !== 'upcoming' && st !== 'postponed') return false;
    const pick = (myOverrides && myOverrides[g.id]) ?? (allPicks[g.id] ?? {})[memberId];
    return !pickComplete(pick, g);
  });
}

/* ------------------------------------------------------------------ *
 * Formatting — device-local rendering, `now` passed as a parameter.
 * es → es-MX (24h), en → en-US (12h).
 * ------------------------------------------------------------------ */

function locale(lang: Lang): string {
  return lang === 'es' ? 'es-MX' : 'en-US';
}

export function fmtTime(d: Date, lang: Lang): string {
  return new Intl.DateTimeFormat(locale(lang), {
    hour: 'numeric',
    minute: '2-digit',
    hour12: lang !== 'es',
  }).format(d);
}

export function fmtDay(d: Date, lang: Lang, t: Translate, now: Date): string {
  const sameDay = (a: Date, b: Date): boolean =>
    a.getDate() === b.getDate() &&
    a.getMonth() === b.getMonth() &&
    a.getFullYear() === b.getFullYear();
  if (sameDay(d, now)) return t('today');
  const tom = new Date(now);
  tom.setDate(now.getDate() + 1);
  if (sameDay(d, tom)) return t('tomorrow');
  return new Intl.DateTimeFormat(locale(lang), {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(d);
}

/**
 * Compact countdown to `toDate` from `now`:
 *  ≥ 24h → "Nd" / "N d"; ≥ 1h → "Hh Mm" / "H h M min"; else "Mm" / "M min".
 */
export function fmtCountdown(toDate: Date, lang: Lang, now: Date): string {
  const mins = Math.max(1, Math.round((toDate.getTime() - now.getTime()) / MS_MIN));
  const h = Math.floor(mins / 60);
  const mm = mins % 60;
  if (h >= 24) {
    const dd = Math.floor(h / 24);
    return lang === 'es' ? dd + ' d' : dd + 'd';
  }
  if (h > 0) {
    return lang === 'es' ? h + ' h ' + mm + ' min' : h + 'h ' + mm + 'm';
  }
  return lang === 'es' ? mm + ' min' : mm + 'm';
}

/* ------------------------------------------------------------------ *
 * Team / stage labels
 * ------------------------------------------------------------------ */

/** Localised team name for a 3-letter code; falls back to the code itself. */
export function teamName(code: TeamCode | null | undefined, teams: TeamsMap, lang: Lang): string {
  if (!code) return '';
  const team = teams[code];
  if (!team) return code;
  return lang === 'es' ? team.name_es : team.name_en;
}

/* Map every KO stage enum value to its i18n key. */
const KO_STAGE_KEY = {
  R32: 'stageR32',
  R16: 'stageR16',
  QF: 'stageQF',
  SF: 'stageSF',
  THIRD: 'stageThird',
  FINAL: 'stageFinal',
} as const;

/**
 * Localised label for any stage:
 *  - GROUP_x → "Group X" with the letter interpolated.
 *  - KO stages → the matching i18n key (R32/R16/QF/SF/THIRD/FINAL).
 */
export function stageLabel(stage: Stage, t: Translate): string {
  if (stage.startsWith('GROUP_')) {
    const letter = stage.slice('GROUP_'.length);
    return t('group', { g: letter });
  }
  return t(KO_STAGE_KEY[stage as keyof typeof KO_STAGE_KEY]);
}
