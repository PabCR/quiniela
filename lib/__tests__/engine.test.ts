import { describe, expect, it } from 'vitest';
import {
  advancerOf,
  fmtCountdown,
  impactOf,
  isKO,
  isProvisional,
  liveMinute,
  pendingMatches,
  resultOf,
  scorePick,
  stageLabel,
  standings,
  standingsWithMovement,
  statusOf,
  teamName,
  type AllPicks,
} from '../engine';
import { makeT } from '../i18n';
import type { Game, MatchResult, Member, Pick, Stage, TeamsMap } from '../types';

/* ------------------------------------------------------------------ *
 * Test fixtures / builders
 * ------------------------------------------------------------------ */

const PTS_FULL = 3;
const PTS_PARTIAL = 1;

/* A fixed reference clock. */
const NOW = new Date('2026-06-13T16:36:00Z');

/** ISO string for `min` minutes after NOW. */
function isoFromNow(min: number): string {
  return new Date(NOW.getTime() + min * 60_000).toISOString();
}

let gameSeq = 1;

interface GameOpts {
  stage?: Stage;
  home?: string | null;
  away?: string | null;
  kickoff?: string;
  scoreHome?: number | null;
  scoreAway?: number | null;
  advancer?: string | null;
  resultStatus?: Game['result_status'];
  voided?: boolean;
  postponed?: boolean;
  id?: number;
}

function makeGame(opts: GameOpts = {}): Game {
  return {
    id: opts.id ?? gameSeq++,
    tournament_id: 1,
    external_id: null,
    stage: opts.stage ?? 'GROUP_A',
    home: opts.home ?? 'HOM',
    away: opts.away ?? 'AWY',
    kickoff: opts.kickoff ?? isoFromNow(-30),
    location: null,
    score_home: opts.scoreHome ?? null,
    score_away: opts.scoreAway ?? null,
    advancer: opts.advancer ?? null,
    result_status: opts.resultStatus ?? 'none',
    confirmed_at: null,
    voided: opts.voided ?? false,
    postponed: opts.postponed ?? false,
    corrected: false,
    updated_at: NOW.toISOString(),
  };
}

/**
 * Build a confirmed-result game from a stage + a result tuple.
 * The result is set as confirmed so resultOf() returns it.
 */
function gameWithResult(stage: Stage, result: MatchResult): Game {
  return makeGame({
    stage,
    home: 'HOM',
    away: 'AWY',
    scoreHome: result.home,
    scoreAway: result.away,
    advancer: result.advancer,
    resultStatus: 'confirmed',
  });
}

const TEAMS: TeamsMap = {
  HOM: { code: 'HOM', name_en: 'Home', name_es: 'Local', flag: '🏠' },
  AWY: { code: 'AWY', name_en: 'Away', name_es: 'Visitante', flag: '✈️' },
  MEX: { code: 'MEX', name_en: 'Mexico', name_es: 'México', flag: '🇲🇽' },
};

/* ------------------------------------------------------------------ *
 * §5 Golden cases — table driven (defaults 3/1)
 * ------------------------------------------------------------------ */

interface GoldenCase {
  n: number;
  ko: boolean;
  pick: Pick | null;
  result: MatchResult;
  expectPts: number | null; // null => scorePick returns {pts:0, tag:'none'} (no pick)
  expectTag: 'exact' | 'outcome' | 'draw' | 'miss' | 'none';
}

// Advancer convention in the golden table: 'HOM' = home side, 'AWY' = away side.
const GOLDEN: GoldenCase[] = [
  { n: 1, ko: false, pick: { home: 2, away: 1 }, result: { home: 2, away: 1, advancer: null }, expectPts: 3, expectTag: 'exact' },
  { n: 2, ko: false, pick: { home: 1, away: 0 }, result: { home: 2, away: 1, advancer: null }, expectPts: 1, expectTag: 'outcome' },
  { n: 3, ko: false, pick: { home: 1, away: 1 }, result: { home: 2, away: 2, advancer: null }, expectPts: 1, expectTag: 'outcome' },
  { n: 4, ko: false, pick: { home: 0, away: 1 }, result: { home: 2, away: 1, advancer: null }, expectPts: 0, expectTag: 'miss' },
  { n: 5, ko: false, pick: null, result: { home: 2, away: 1, advancer: null }, expectPts: 0, expectTag: 'none' },
  { n: 6, ko: true, pick: { home: 2, away: 1 }, result: { home: 2, away: 1, advancer: 'HOM' }, expectPts: 3, expectTag: 'exact' },
  { n: 7, ko: true, pick: { home: 2, away: 1 }, result: { home: 3, away: 1, advancer: 'HOM' }, expectPts: 1, expectTag: 'outcome' },
  { n: 8, ko: true, pick: { home: 1, away: 1, advancer: 'HOM' }, result: { home: 1, away: 1, advancer: 'HOM' }, expectPts: 3, expectTag: 'exact' },
  { n: 9, ko: true, pick: { home: 1, away: 1, advancer: 'HOM' }, result: { home: 1, away: 1, advancer: 'AWY' }, expectPts: 1, expectTag: 'draw' },
  { n: 10, ko: true, pick: { home: 2, away: 2, advancer: 'AWY' }, result: { home: 1, away: 1, advancer: 'AWY' }, expectPts: 1, expectTag: 'draw' },
  { n: 11, ko: true, pick: { home: 2, away: 1 }, result: { home: 1, away: 1, advancer: 'HOM' }, expectPts: 1, expectTag: 'outcome' },
  { n: 12, ko: true, pick: { home: 1, away: 1 }, result: { home: 0, away: 0, advancer: 'HOM' }, expectPts: 0, expectTag: 'none' },
];

describe('§5 golden scoring cases (defaults 3/1)', () => {
  it.each(GOLDEN)(
    'case $n: $expectTag ($expectPts pts)',
    ({ ko, pick, result, expectPts, expectTag }) => {
      const stage: Stage = ko ? 'R32' : 'GROUP_A';
      const game = gameWithResult(stage, result);
      const out = scorePick(pick, game, resultOf(game), PTS_FULL, PTS_PARTIAL);
      // Every golden case has a result present, so scorePick is non-null.
      expect(out).not.toBeNull();
      expect(out!.pts).toBe(expectPts);
      expect(out!.tag).toBe(expectTag);
    },
  );
});

/* ------------------------------------------------------------------ *
 * Rule-10 regression — explicit, never 2 points
 * ------------------------------------------------------------------ */

describe('rule-10 regression', () => {
  it('KO 2-2 adv=AWY pick on a 1-1 AWY-pens result scores exactly 1 draw, never 2', () => {
    const game = gameWithResult('R32', { home: 1, away: 1, advancer: 'AWY' });
    const pick: Pick = { home: 2, away: 2, advancer: 'AWY' };
    const out = scorePick(pick, game, resultOf(game), PTS_FULL, PTS_PARTIAL);
    expect(out).toEqual({ pts: 1, tag: 'draw' });
    expect(out!.pts).not.toBe(2);
  });
});

/* ------------------------------------------------------------------ *
 * Status precedence + live-window boundaries
 * ------------------------------------------------------------------ */

describe('statusOf precedence', () => {
  it('voided beats a confirmed result', () => {
    const game = makeGame({
      voided: true,
      resultStatus: 'confirmed',
      scoreHome: 2,
      scoreAway: 1,
      kickoff: isoFromNow(-30),
    });
    expect(statusOf(game, NOW)).toBe('void');
  });

  it('confirmed result before kickoff window → final', () => {
    const game = makeGame({ resultStatus: 'confirmed', scoreHome: 1, scoreAway: 0 });
    expect(statusOf(game, NOW)).toBe('final');
  });

  it('a provisional result renders as awaiting (not final) and is flagged provisional', () => {
    // kickoff 200 min ago: past the live window for a group game.
    const game = makeGame({
      resultStatus: 'provisional',
      scoreHome: 1,
      scoreAway: 0,
      kickoff: isoFromNow(-200),
    });
    expect(resultOf(game)).toBeNull();
    expect(isProvisional(game)).toBe(true);
    expect(statusOf(game, NOW)).toBe('awaiting');
  });

  it('postponed with kickoff in the future → postponed', () => {
    const game = makeGame({ postponed: true, kickoff: isoFromNow(120) });
    expect(statusOf(game, NOW)).toBe('postponed');
  });

  it('upcoming when kickoff is in the future and not postponed', () => {
    const game = makeGame({ kickoff: isoFromNow(60) });
    expect(statusOf(game, NOW)).toBe('upcoming');
  });
});

describe('live-window boundaries', () => {
  it('group: 114 min after kickoff is live, 116 min is awaiting (cutoff 115)', () => {
    const liveG = makeGame({ stage: 'GROUP_A', kickoff: isoFromNow(-114) });
    const awaitG = makeGame({ stage: 'GROUP_A', kickoff: isoFromNow(-116) });
    expect(statusOf(liveG, NOW)).toBe('live');
    expect(statusOf(awaitG, NOW)).toBe('awaiting');
  });

  it('KO: 164 min after kickoff is live, 166 min is awaiting (cutoff 165)', () => {
    const liveK = makeGame({ stage: 'QF', kickoff: isoFromNow(-164) });
    const awaitK = makeGame({ stage: 'QF', kickoff: isoFromNow(-166) });
    expect(statusOf(liveK, NOW)).toBe('live');
    expect(statusOf(awaitK, NOW)).toBe('awaiting');
  });
});

/* ------------------------------------------------------------------ *
 * liveMinute caps
 * ------------------------------------------------------------------ */

describe('liveMinute', () => {
  it('group caps at 90', () => {
    const g = makeGame({ stage: 'GROUP_A', kickoff: isoFromNow(-200) });
    expect(liveMinute(g, NOW)).toBe(90);
  });

  it('KO may exceed 90 and caps at 120', () => {
    const earlyKO = makeGame({ stage: 'SF', kickoff: isoFromNow(-100) });
    expect(liveMinute(earlyKO, NOW)).toBe(99); // 100 - 1 (rounding offset)
    const lateKO = makeGame({ stage: 'SF', kickoff: isoFromNow(-200) });
    expect(liveMinute(lateKO, NOW)).toBe(120);
  });
});

/* ------------------------------------------------------------------ *
 * resultOf gating + isKO + advancerOf
 * ------------------------------------------------------------------ */

describe('resultOf gating', () => {
  it('returns null unless result_status is confirmed', () => {
    expect(resultOf(makeGame({ resultStatus: 'none', scoreHome: 1, scoreAway: 0 }))).toBeNull();
    expect(resultOf(makeGame({ resultStatus: 'provisional', scoreHome: 1, scoreAway: 0 }))).toBeNull();
    expect(resultOf(makeGame({ resultStatus: 'confirmed', scoreHome: 1, scoreAway: 0 }))).toEqual({
      home: 1,
      away: 0,
      advancer: null,
    });
  });
});

describe('isKO', () => {
  it('is false for every GROUP_x stage and true for KO stages', () => {
    for (const s of ['GROUP_A', 'GROUP_L'] as Stage[]) {
      expect(isKO({ stage: s })).toBe(false);
    }
    for (const s of ['R32', 'R16', 'QF', 'SF', 'THIRD', 'FINAL'] as Stage[]) {
      expect(isKO({ stage: s })).toBe(true);
    }
  });
});

describe('advancerOf', () => {
  it('picks the higher-scoring side, or the explicit advancer on a draw', () => {
    const g = makeGame({ stage: 'R32', home: 'HOM', away: 'AWY' });
    expect(advancerOf(g, { home: 2, away: 1, advancer: null })).toBe('HOM');
    expect(advancerOf(g, { home: 0, away: 1, advancer: null })).toBe('AWY');
    expect(advancerOf(g, { home: 1, away: 1, advancer: 'AWY' })).toBe('AWY');
  });

  it('is null for group games', () => {
    const g = makeGame({ stage: 'GROUP_A' });
    expect(advancerOf(g, { home: 2, away: 1, advancer: null })).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * Custom point values
 * ------------------------------------------------------------------ */

describe('custom point values (5/2)', () => {
  it('respects pool point values for exact and outcome', () => {
    const game = gameWithResult('GROUP_A', { home: 2, away: 1, advancer: null });
    expect(scorePick({ home: 2, away: 1 }, game, resultOf(game), 5, 2)).toEqual({
      pts: 5,
      tag: 'exact',
    });
    expect(scorePick({ home: 1, away: 0 }, game, resultOf(game), 5, 2)).toEqual({
      pts: 2,
      tag: 'outcome',
    });
  });

  it('respects pool point values for a KO draw', () => {
    const game = gameWithResult('R32', { home: 1, away: 1, advancer: 'AWY' });
    expect(scorePick({ home: 0, away: 0, advancer: 'HOM' }, game, resultOf(game), 5, 2)).toEqual({
      pts: 2,
      tag: 'draw',
    });
  });
});

/* ------------------------------------------------------------------ *
 * Standings: ties, T- display data, movement
 * ------------------------------------------------------------------ */

const MEMBERS: Member[] = [
  { id: 'a' },
  { id: 'b' },
  { id: 'c' },
  { id: 'd' },
];

describe('standings', () => {
  it('shares rank on ties and flags tied rows (T- display data)', () => {
    // One confirmed group game, exact = 3 pts.
    const g1 = makeGame({ id: 101, stage: 'GROUP_A', resultStatus: 'confirmed', scoreHome: 2, scoreAway: 1, kickoff: isoFromNow(-300) });
    const picks: AllPicks = {
      101: {
        a: { home: 2, away: 1 }, // exact → 3
        b: { home: 2, away: 1 }, // exact → 3 (tie with a)
        c: { home: 1, away: 0 }, // outcome → 1
        d: { home: 0, away: 2 }, // miss → 0
      },
    };
    const rows = standings(MEMBERS, [g1], picks, NOW, PTS_FULL, PTS_PARTIAL);

    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId.a.pts).toBe(3);
    expect(byId.b.pts).toBe(3);
    expect(byId.a.rank).toBe(1);
    expect(byId.b.rank).toBe(1);
    expect(byId.a.tied).toBe(true);
    expect(byId.b.tied).toBe(true);
    // c is rank 3 (shared rank 1 consumes positions 1 and 2)
    expect(byId.c.rank).toBe(3);
    expect(byId.c.tied).toBe(false);
    expect(byId.d.rank).toBe(4);
  });

  it('exact count breaks ties on equal points', () => {
    // Two confirmed games. a: exact+miss=3, b: outcome+outcome=2 -> a ahead by pts.
    // Make a points-tie with different exact counts instead:
    // a: exact (3) ; b: outcome+outcome (1+1=2)+... build equal points, diff exact.
    const g1 = makeGame({ id: 201, stage: 'GROUP_A', resultStatus: 'confirmed', scoreHome: 2, scoreAway: 1, kickoff: isoFromNow(-400) });
    const g2 = makeGame({ id: 202, stage: 'GROUP_B', resultStatus: 'confirmed', scoreHome: 1, scoreAway: 0, kickoff: isoFromNow(-350) });
    const picks: AllPicks = {
      201: {
        a: { home: 2, away: 1 }, // exact → 3
        b: { home: 1, away: 0 }, // outcome → 1
      },
      202: {
        a: { home: 5, away: 5 }, // miss → 0  (a total 3, 1 exact)
        b: { home: 3, away: 0 }, // outcome → 1 (b total 2)
      },
    };
    // Adjust so points tie: give b another outcome game to reach 3.
    const g3 = makeGame({ id: 203, stage: 'GROUP_C', resultStatus: 'confirmed', scoreHome: 4, scoreAway: 0, kickoff: isoFromNow(-300) });
    picks[203] = {
      a: { home: 0, away: 1 }, // miss → 0
      b: { home: 2, away: 1 }, // outcome → 1 (b total 3, 0 exact)
    };
    const rows = standings([{ id: 'a' }, { id: 'b' }], [g1, g2, g3], picks, NOW, PTS_FULL, PTS_PARTIAL);
    expect(rows[0].id).toBe('a'); // equal 3 pts, but a has 1 exact vs b's 0
    expect(rows[0].pts).toBe(3);
    expect(rows[1].pts).toBe(3);
    expect(rows[0].exact).toBe(1);
    expect(rows[1].exact).toBe(0);
    expect(rows[0].rank).toBe(1);
    expect(rows[1].rank).toBe(2);
  });

  it('only counts confirmed-final games (provisional ignored)', () => {
    const confirmed = makeGame({ id: 301, stage: 'GROUP_A', resultStatus: 'confirmed', scoreHome: 2, scoreAway: 1, kickoff: isoFromNow(-400) });
    const provisional = makeGame({ id: 302, stage: 'GROUP_B', resultStatus: 'provisional', scoreHome: 2, scoreAway: 1, kickoff: isoFromNow(-300) });
    const picks: AllPicks = {
      301: { a: { home: 2, away: 1 } },
      302: { a: { home: 2, away: 1 } },
    };
    const rows = standings([{ id: 'a' }], [confirmed, provisional], picks, NOW, PTS_FULL, PTS_PARTIAL);
    expect(rows[0].pts).toBe(3); // only the confirmed game counted
  });
});

describe('standingsWithMovement', () => {
  it('computes movement vs the previous matchday', () => {
    // Game 1 (earlier final): b leads. Game 2 (latest final): a overtakes.
    const g1 = makeGame({ id: 401, stage: 'GROUP_A', resultStatus: 'confirmed', scoreHome: 1, scoreAway: 0, kickoff: isoFromNow(-400) });
    const g2 = makeGame({ id: 402, stage: 'GROUP_B', resultStatus: 'confirmed', scoreHome: 2, scoreAway: 1, kickoff: isoFromNow(-300) });
    const picks: AllPicks = {
      401: {
        a: { home: 5, away: 5 }, // miss → 0
        b: { home: 1, away: 0 }, // exact → 3  (b leads after g1)
      },
      402: {
        a: { home: 2, away: 1 }, // exact → 3  (a now 3)
        b: { home: 0, away: 4 }, // miss → 0   (b stays 3)
      },
    };
    // After both: a=3 (1 exact), b=3 (1 exact) → tie. Previous (g1 only): b=3, a=0.
    const rows = standingsWithMovement([{ id: 'a' }, { id: 'b' }], [g1, g2], picks, NOW, PTS_FULL, PTS_PARTIAL);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    // a climbed from rank 2 to rank 1 → move +1
    expect(byId.a.move).toBe(1);
    // b dropped from rank 1 to a shared rank 1... compute precisely:
    // current: a and b tie at 3pts/1exact → both rank 1. prev: b rank1, a rank2.
    // a: prevRank2 - rank1 = +1. b: prevRank1 - rank1 = 0.
    expect(byId.b.move).toBe(0);
  });

  it('movement is 0 when one or fewer finals exist', () => {
    const g1 = makeGame({ id: 501, stage: 'GROUP_A', resultStatus: 'confirmed', scoreHome: 1, scoreAway: 0, kickoff: isoFromNow(-300) });
    const picks: AllPicks = { 501: { a: { home: 1, away: 0 }, b: { home: 0, away: 1 } } };
    const rows = standingsWithMovement([{ id: 'a' }, { id: 'b' }], [g1], picks, NOW, PTS_FULL, PTS_PARTIAL);
    expect(rows.every((r) => r.move === 0)).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * pendingMatches
 * ------------------------------------------------------------------ */

describe('pendingMatches', () => {
  it('counts a KO draw without an advancer as pending', () => {
    const upcoming = makeGame({ id: 601, stage: 'R32', kickoff: isoFromNow(120) });
    const picks: AllPicks = {
      601: { a: { home: 1, away: 1 } }, // KO draw, no advancer → incomplete
    };
    const pending = pendingMatches('a', [upcoming], picks, NOW);
    expect(pending.map((g) => g.id)).toEqual([601]);
  });

  it('does not count a completed KO draw pick (advancer chosen)', () => {
    const upcoming = makeGame({ id: 602, stage: 'R32', kickoff: isoFromNow(120) });
    const picks: AllPicks = {
      602: { a: { home: 1, away: 1, advancer: 'HOM' } },
    };
    expect(pendingMatches('a', [upcoming], picks, NOW)).toEqual([]);
  });

  it('counts upcoming and postponed games with no pick, ignores live/final', () => {
    const upcoming = makeGame({ id: 603, stage: 'GROUP_A', kickoff: isoFromNow(60) });
    const postponed = makeGame({ id: 604, stage: 'GROUP_B', postponed: true, kickoff: isoFromNow(180) });
    const live = makeGame({ id: 605, stage: 'GROUP_C', kickoff: isoFromNow(-30) });
    const final = makeGame({ id: 606, stage: 'GROUP_D', resultStatus: 'confirmed', scoreHome: 1, scoreAway: 0, kickoff: isoFromNow(-300) });
    const picks: AllPicks = {};
    const pending = pendingMatches('a', [upcoming, postponed, live, final], picks, NOW);
    expect(pending.map((g) => g.id).sort()).toEqual([603, 604]);
  });

  it('honors local overrides over stored picks', () => {
    const upcoming = makeGame({ id: 607, stage: 'GROUP_A', kickoff: isoFromNow(60) });
    const picks: AllPicks = {}; // nothing stored → would be pending
    const pending = pendingMatches('a', [upcoming], picks, NOW, { 607: { home: 1, away: 0 } });
    expect(pending).toEqual([]); // override completes it
  });
});

/* ------------------------------------------------------------------ *
 * impactOf
 * ------------------------------------------------------------------ */

describe('impactOf', () => {
  it('tallies per-tag counts across members for a hypothetical result', () => {
    const game = makeGame({ id: 701, stage: 'GROUP_A', home: 'HOM', away: 'AWY' });
    const result: MatchResult = { home: 2, away: 1, advancer: null };
    const picks: AllPicks = {
      701: {
        a: { home: 2, away: 1 }, // exact
        b: { home: 1, away: 0 }, // outcome
        c: { home: 0, away: 2 }, // miss
        // d has no pick → none
      },
    };
    const impact = impactOf(game, result, picks, MEMBERS, PTS_FULL, PTS_PARTIAL);
    expect(impact).toEqual({ exact: 1, outcome: 1, draw: 0, miss: 1, none: 1 });
  });
});

/* ------------------------------------------------------------------ *
 * Stage labels + team names
 * ------------------------------------------------------------------ */

describe('stageLabel', () => {
  it('labels every stage in EN', () => {
    const t = makeT('en');
    expect(stageLabel('GROUP_A', t)).toBe('Group A');
    expect(stageLabel('GROUP_L', t)).toBe('Group L');
    expect(stageLabel('R32', t)).toBe('Round of 32');
    expect(stageLabel('R16', t)).toBe('Round of 16');
    expect(stageLabel('QF', t)).toBe('Quarter-final');
    expect(stageLabel('SF', t)).toBe('Semi-final');
    expect(stageLabel('THIRD', t)).toBe('Third place');
    expect(stageLabel('FINAL', t)).toBe('Final');
  });

  it('labels every stage in ES', () => {
    const t = makeT('es');
    expect(stageLabel('GROUP_C', t)).toBe('Grupo C');
    expect(stageLabel('R32', t)).toBe('Dieciseisavos');
    expect(stageLabel('R16', t)).toBe('Octavos');
    expect(stageLabel('QF', t)).toBe('Cuartos');
    expect(stageLabel('SF', t)).toBe('Semifinal');
    expect(stageLabel('THIRD', t)).toBe('Tercer lugar');
    expect(stageLabel('FINAL', t)).toBe('Final');
  });
});

describe('teamName', () => {
  it('returns the localized name, falling back to the code', () => {
    expect(teamName('MEX', TEAMS, 'es')).toBe('México');
    expect(teamName('MEX', TEAMS, 'en')).toBe('Mexico');
    expect(teamName('ZZZ', TEAMS, 'en')).toBe('ZZZ');
    expect(teamName(null, TEAMS, 'en')).toBe('');
  });
});

/* ------------------------------------------------------------------ *
 * fmtCountdown
 * ------------------------------------------------------------------ */

describe('fmtCountdown', () => {
  it('formats minutes-only, hours+minutes, and days in both languages', () => {
    const in45 = new Date(NOW.getTime() + 45 * 60_000);
    expect(fmtCountdown(in45, 'en', NOW)).toBe('45m');
    expect(fmtCountdown(in45, 'es', NOW)).toBe('45 min');

    const in2h15 = new Date(NOW.getTime() + (2 * 60 + 15) * 60_000);
    expect(fmtCountdown(in2h15, 'en', NOW)).toBe('2h 15m');
    expect(fmtCountdown(in2h15, 'es', NOW)).toBe('2 h 15 min');

    const in3d = new Date(NOW.getTime() + 3 * 24 * 60 * 60_000);
    expect(fmtCountdown(in3d, 'en', NOW)).toBe('3d');
    expect(fmtCountdown(in3d, 'es', NOW)).toBe('3 d');
  });

  it('never drops below 1 minute', () => {
    const past = new Date(NOW.getTime() - 60_000);
    expect(fmtCountdown(past, 'en', NOW)).toBe('1m');
  });
});
