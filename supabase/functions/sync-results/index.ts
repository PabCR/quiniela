/**
 * sync-results — Supabase Edge Function
 *
 * Scheduled every 10 minutes via pg_cron + pg_net (see migration 0009_cron_sync.sql).
 * Fetches finished / live fixtures from API-Football and writes provisional results,
 * auto-confirms stale provisionals, and locks pool scoring when applicable.
 *
 * ─── Required environment variables ─────────────────────────────────────────────
 *   API_FOOTBALL_KEY         — x-apisports-key header value
 *   API_FOOTBALL_LEAGUE_ID   — numeric league id for WC 2026 (e.g. "1")
 *   SUPABASE_URL             — project URL (auto-injected by Supabase runtime)
 *   SUPABASE_SERVICE_ROLE_KEY — service-role JWT (auto-injected; also used as auth
 *                               bearer by the cron caller to protect this endpoint)
 *
 * ─── Deploy command ──────────────────────────────────────────────────────────────
 *   supabase functions deploy sync-results --no-verify-jwt
 *   (JWT verification is off; we do our own Bearer check against the service role key)
 *
 * ─── config.toml snippet (add to supabase/config.toml) ──────────────────────────
 *   [functions.sync-results]
 *   verify_jwt = false
 *
 * ─── Manual invoke ───────────────────────────────────────────────────────────────
 *   See README.md for the full curl example.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface APIFixtureTeam {
  id: number;
  name: string;
}

interface APIFixture {
  fixture: {
    id: number;
    date: string; // ISO 8601 UTC
    venue: { city: string | null };
    status: { short: string; elapsed: number | null };
  };
  league: {
    id: number;
    round: string;
    season: number;
  };
  teams: {
    home: APIFixtureTeam;
    away: APIFixtureTeam;
  };
  score: {
    fulltime: { home: number | null; away: number | null };
    extratime: { home: number | null; away: number | null };
    penalty: { home: number | null; away: number | null };
  };
}

interface APIResponse<T> {
  results: number;
  response: T[];
  errors?: unknown;
}

interface GameRow {
  id: number;
  external_id: string | null;
  kickoff: string;
  score_home: number | null;
  score_away: number | null;
  result_status: string;
  voided: boolean;
  updated_at: string;
}

interface SyncStats {
  apiCalls: number;
  kickoffUpdated: number;
  provisional: number;
  skipped: number;
  autoConfirmed: number;
  poolsLocked: number;
  errors: string[];
}

// ─── Finished statuses from API-Football ───────────────────────────────────────

const FINISHED_STATUSES = new Set(["FT", "AET", "PEN"]);

// Statuses that indicate a postponement / cancellation
const POSTPONED_STATUSES = new Set(["PST", "CANC", "SUSP", "ABD", "AWD", "WO"]);

// Live statuses
const LIVE_STATUSES = new Set([
  "1H", "HT", "2H", "ET", "BT", "P", "INT", "LIVE",
]);

// ─── Auth guard ────────────────────────────────────────────────────────────────

function authorize(req: Request, serviceRoleKey: string): boolean {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  return token === serviceRoleKey;
}

// ─── API-Football fetch ─────────────────────────────────────────────────────────

async function fetchFixtures(
  leagueId: string,
  season: number,
  apiKey: string,
): Promise<APIFixture[]> {
  const url =
    `https://v3.football.api-sports.io/fixtures?league=${leagueId}&season=${season}`;

  const res = await fetch(url, {
    headers: {
      "x-apisports-key": apiKey,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    throw new Error(
      `API-Football request failed: ${res.status} ${res.statusText}`,
    );
  }

  const body = (await res.json()) as APIResponse<APIFixture>;

  if (
    body.errors &&
    typeof body.errors === "object" &&
    Object.keys(body.errors as object).length > 0
  ) {
    throw new Error(`API-Football errors: ${JSON.stringify(body.errors)}`);
  }

  if (!Array.isArray(body.response)) {
    throw new Error(
      `Unexpected API response: ${JSON.stringify(body).slice(0, 200)}`,
    );
  }

  return body.response;
}

// ─── Post-ET score computation ──────────────────────────────────────────────────
// post-ET = 90' + ET goals (NEVER add penalty shootout goals)

function computePostETScore(score: APIFixture["score"]): {
  home: number | null;
  away: number | null;
} {
  const ftHome = score.fulltime.home;
  const ftAway = score.fulltime.away;

  if (ftHome === null || ftAway === null) return { home: null, away: null };

  const etHome = score.extratime.home ?? 0;
  const etAway = score.extratime.away ?? 0;

  return {
    home: ftHome + etHome,
    away: ftAway + etAway,
  };
}

// ─── Advancer from penalty result ──────────────────────────────────────────────

function computeAdvancer(
  fixture: APIFixture,
  homeCode: string | null | undefined,
  awayCode: string | null | undefined,
): string | null {
  const status = fixture.fixture.status.short;
  const postET = computePostETScore(fixture.score);

  if (postET.home === null || postET.away === null) return null;

  // Non-draw result: higher score advances
  if (postET.home > postET.away) return homeCode ?? null;
  if (postET.away > postET.home) return awayCode ?? null;

  // Draw after ET: penalty winner advances (PEN fixture status)
  if (status === "PEN") {
    const penHome = fixture.score.penalty.home;
    const penAway = fixture.score.penalty.away;
    if (penHome !== null && penAway !== null) {
      if (penHome > penAway) return homeCode ?? null;
      if (penAway > penHome) return awayCode ?? null;
    }
  }

  return null;
}

// ─── Main handler ───────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const stats: SyncStats = {
    apiCalls: 0,
    kickoffUpdated: 0,
    provisional: 0,
    skipped: 0,
    autoConfirmed: 0,
    poolsLocked: 0,
    errors: [],
  };

  try {
    // ── Read env vars ──────────────────────────────────────────────────────────
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const apiFootballKey = Deno.env.get("API_FOOTBALL_KEY") ?? "";
    const apiFootballLeagueId = Deno.env.get("API_FOOTBALL_LEAGUE_ID") ?? "";

    // ── 1. Auth guard ──────────────────────────────────────────────────────────
    if (!serviceRoleKey || !authorize(req, serviceRoleKey)) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!supabaseUrl) {
      return new Response(
        JSON.stringify({ error: "SUPABASE_URL not configured" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }

    // ── Service-role Supabase client (bypasses RLS) ────────────────────────────
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // ── 3b. Auto-confirm: provisional games older than 2 hours ────────────────
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

    const { data: provisionalGames, error: provErr } = await supabase
      .from("games")
      .select("id")
      .eq("result_status", "provisional")
      .lt("updated_at", twoHoursAgo)
      .eq("voided", false);

    if (provErr) {
      stats.errors.push(`auto-confirm query: ${provErr.message}`);
    } else if (provisionalGames && provisionalGames.length > 0) {
      const ids = provisionalGames.map((g: { id: number }) => g.id);
      const { error: confirmErr } = await supabase
        .from("games")
        .update({
          result_status: "confirmed",
          confirmed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .in("id", ids)
        .eq("voided", false);

      if (confirmErr) {
        stats.errors.push(`auto-confirm update: ${confirmErr.message}`);
      } else {
        stats.autoConfirmed = ids.length;
      }
    }

    // ── 3c. Lock pools where scoring should be locked ─────────────────────────
    // A pool should be locked when its tournament has at least one non-voided game
    // with guesses that has already passed kickoff, and the pool is not yet locked.
    const { data: unlocked, error: unlockErr } = await supabase
      .from("pools")
      .select("id, tournament_id")
      .eq("scoring_locked", false);

    if (unlockErr) {
      stats.errors.push(`pools query: ${unlockErr.message}`);
    } else if (unlocked && unlocked.length > 0) {
      for (const pool of unlocked) {
        // Check if any non-voided game in this tournament has guesses and is past kickoff
        const { data: lockCheck } = await supabase
          .from("guesses")
          .select("pool_id, game_id, games!inner(kickoff, voided, tournament_id)")
          .eq("pool_id", pool.id)
          .eq("games.tournament_id", pool.tournament_id)
          .eq("games.voided", false)
          .lt("games.kickoff", new Date().toISOString())
          .limit(1);

        if (lockCheck && lockCheck.length > 0) {
          const { error: lockErr } = await supabase
            .from("pools")
            .update({ scoring_locked: true })
            .eq("id", pool.id);

          if (lockErr) {
            stats.errors.push(`lock pool ${pool.id}: ${lockErr.message}`);
          } else {
            stats.poolsLocked++;
          }
        }
      }
    }

    // ── 2. Frugality gate: check if any game is in [kickoff-5m, kickoff+4h] ──
    // A game is "in window" if kickoff is within [now - 4h, now + 5min]
    // i.e. kickoff >= (now - 4h) AND kickoff <= (now + 5min)
    const now = new Date();
    const windowUpperBound = new Date(now.getTime() + 5 * 60 * 1000).toISOString(); // now + 5 min
    const windowLowerBound = new Date(now.getTime() - 4 * 60 * 60 * 1000).toISOString(); // now - 4h

    const { data: gamesInWindow, error: windowErr } = await supabase
      .from("games")
      .select("id")
      .gte("kickoff", windowLowerBound)
      .lte("kickoff", windowUpperBound)
      .eq("voided", false)
      .limit(1);

    if (windowErr) {
      stats.errors.push(`window check: ${windowErr.message}`);
    }

    const isInWindow = gamesInWindow && gamesInWindow.length > 0;

    // If no game is in window, skip API call (maintenance steps already done above)
    if (!isInWindow) {
      return new Response(
        JSON.stringify({
          message: "No games in active window — API call skipped",
          stats,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    // ── Env check for API Football ─────────────────────────────────────────────
    if (!apiFootballKey || !apiFootballLeagueId) {
      const missing = [];
      if (!apiFootballKey) missing.push("API_FOOTBALL_KEY");
      if (!apiFootballLeagueId) missing.push("API_FOOTBALL_LEAGUE_ID");
      return new Response(
        JSON.stringify({
          message: `Games in window but missing env vars: ${missing.join(", ")} — skipping API call`,
          stats,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    // ── 3a. ONE API-Football call: all fixtures for league+season ─────────────
    // Fetching the entire league+season covers live, recent, and finished fixtures
    // in a single request. The frugality gate above ensures this only fires on
    // match days. Free tier: 100 req/day.
    stats.apiCalls++;
    const fixtures = await fetchFixtures(
      apiFootballLeagueId,
      2026,
      apiFootballKey,
    );

    // Build external_id to fixture map for quick lookup
    const fixtureMap = new Map<string, APIFixture>();
    for (const f of fixtures) {
      fixtureMap.set(String(f.fixture.id), f);
    }

    // ── Fetch all games that have an external_id ───────────────────────────────
    const { data: dbGames, error: dbGamesErr } = await supabase
      .from("games")
      .select(
        "id, external_id, kickoff, score_home, score_away, result_status, voided, updated_at",
      )
      .not("external_id", "is", null);

    if (dbGamesErr) {
      throw new Error(`Failed to fetch games: ${dbGamesErr.message}`);
    }

    if (!dbGames || dbGames.length === 0) {
      return new Response(
        JSON.stringify({
          message: "No games with external_id found",
          stats,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    // ── Process each game ──────────────────────────────────────────────────────
    for (const game of dbGames as GameRow[]) {
      if (!game.external_id) continue;

      const fixture = fixtureMap.get(game.external_id);
      if (!fixture) {
        stats.skipped++;
        continue;
      }

      const apiStatus = fixture.fixture.status.short;
      const apiKickoff = fixture.fixture.date;

      // Skip voided games entirely (admin override wins)
      if (game.voided) {
        stats.skipped++;
        continue;
      }

      // Never overwrite a confirmed result (admin override always wins)
      const isConfirmed = game.result_status === "confirmed";

      const updates: Record<string, unknown> = {};

      // ── Kickoff changes / postponements ────────────────────────────────────
      const kickoffChanged =
        new Date(apiKickoff).getTime() !== new Date(game.kickoff).getTime();

      if (kickoffChanged) {
        updates.kickoff = apiKickoff;
        stats.kickoffUpdated++;
      }

      if (POSTPONED_STATUSES.has(apiStatus)) {
        updates.postponed = true;
      } else if (updates.kickoff !== undefined) {
        // kickoff changed but not a postponement status
        updates.postponed = false;
      }

      // ── Finished fixtures ──────────────────────────────────────────────────
      if (FINISHED_STATUSES.has(apiStatus) && !isConfirmed) {
        const postET = computePostETScore(fixture.score);

        if (postET.home !== null && postET.away !== null) {
          // Fetch team codes for advancer computation
          const { data: gameTeams } = await supabase
            .from("games")
            .select("home, away")
            .eq("id", game.id)
            .single();

          const homeCode = gameTeams?.home ?? null;
          const awayCode = gameTeams?.away ?? null;

          const advancer = computeAdvancer(fixture, homeCode, awayCode);

          updates.score_home = postET.home;
          updates.score_away = postET.away;
          updates.advancer = advancer;
          updates.result_status = "provisional";
          updates.updated_at = new Date().toISOString();

          stats.provisional++;
        }
      } else if (LIVE_STATUSES.has(apiStatus)) {
        // Live: only kickoff corrections are stored (handled above).
        // Result status is derived client-side from kickoff time.
      }

      // Apply updates if any
      if (Object.keys(updates).length > 0) {
        if (!updates.updated_at) {
          updates.updated_at = new Date().toISOString();
        }

        const { error: updateErr } = await supabase
          .from("games")
          .update(updates)
          .eq("id", game.id);

        if (updateErr) {
          stats.errors.push(`update game ${game.id}: ${updateErr.message}`);
          stats.skipped++;
          if (updates.score_home !== undefined) stats.provisional--;
          if (updates.kickoff !== undefined) stats.kickoffUpdated--;
        }
      } else {
        stats.skipped++;
      }
    }

    return new Response(
      JSON.stringify({
        message: "sync-results completed",
        stats,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    stats.errors.push(message);
    console.error("[sync-results] Fatal error:", message);

    return new Response(
      JSON.stringify({
        error: "sync-results failed",
        message,
        stats,
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
