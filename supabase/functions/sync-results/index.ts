/**
 * sync-results — Supabase Edge Function
 *
 * Scheduled every 10 minutes via pg_cron + pg_net (see migration 0009_cron_sync.sql).
 * Fetches finished / live matches from football-data.org (v4) and writes provisional
 * results, auto-confirms stale provisionals, and locks pool scoring when applicable.
 *
 * ─── Required environment variables ─────────────────────────────────────────────
 *   FOOTBALL_DATA_TOKEN       — X-Auth-Token header value (football-data.org API token)
 *   FOOTBALL_DATA_COMPETITION — competition code or id (default "WC" = FIFA World Cup)
 *   CRON_SECRET               — shared bearer the cron caller sends (same value is
 *                               stored in Vault as `service_role_key`); falls back to
 *                               SUPABASE_SERVICE_ROLE_KEY when unset (local stack)
 *   SUPABASE_URL              — project URL (auto-injected by Supabase runtime)
 *   SUPABASE_SERVICE_ROLE_KEY — service-role key (auto-injected; DB access)
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

// ─── Types (football-data.org v4) ──────────────────────────────────────────────

interface FDTeam {
  id: number | null; // null for undetermined knockout slots
  name: string | null;
  shortName: string | null;
  tla: string | null;
}

interface FDScorePair {
  home: number | null;
  away: number | null;
}

interface FDScore {
  winner: "HOME_TEAM" | "AWAY_TEAM" | "DRAW" | null;
  duration: "REGULAR" | "EXTRA_TIME" | "PENALTY_SHOOTOUT";
  fullTime: FDScorePair;
  regularTime?: FDScorePair | null; // present when the match went to extra time
  extraTime?: FDScorePair | null;
  penalties?: FDScorePair | null;
}

interface FDMatch {
  id: number;
  utcDate: string; // ISO 8601 UTC
  status: string;
  stage: string;
  group: string | null;
  homeTeam: FDTeam;
  awayTeam: FDTeam;
  score: FDScore;
}

interface FDMatchesResponse {
  resultSet?: { count: number };
  matches: FDMatch[];
}

interface GameRow {
  id: number;
  external_id: string | null;
  kickoff: string;
  score_home: number | null;
  score_away: number | null;
  result_status: string;
  voided: boolean;
  postponed: boolean;
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

// ─── football-data.org match statuses ──────────────────────────────────────────
// AWARDED is a decided result (technical win/walkover) — treat as finished so the
// score is written and the advancer recorded, instead of stalling forever.

const FINISHED_STATUSES = new Set(["FINISHED", "AWARDED"]);

// Statuses that indicate a postponement / cancellation
const POSTPONED_STATUSES = new Set(["POSTPONED", "CANCELLED"]);

// In-play statuses (SUSPENDED may resume the same day — not a postponement)
const LIVE_STATUSES = new Set(["IN_PLAY", "PAUSED", "SUSPENDED"]);

// ─── Auth guard ────────────────────────────────────────────────────────────────

function authorize(req: Request, expectedBearer: string): boolean {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  return token === expectedBearer;
}

// ─── football-data.org fetch ────────────────────────────────────────────────────

async function fetchMatches(
  competition: string,
  apiToken: string,
): Promise<FDMatch[]> {
  // No season filter: the endpoint defaults to the competition's current season.
  const url =
    `https://api.football-data.org/v4/competitions/${competition}/matches`;

  const res = await fetch(url, {
    headers: { "X-Auth-Token": apiToken },
  });

  if (!res.ok) {
    // football-data.org returns real HTTP error codes (403 bad token, 429 rate
    // limit) with a JSON body — surface its message, not just the status line.
    let detail = "";
    try {
      const errBody = (await res.json()) as { message?: string; error?: string };
      detail = errBody.message ?? errBody.error ?? "";
    } catch {
      // non-JSON error body — status line is all we have
    }
    const remaining = res.headers.get("X-Requests-Available-Minute");
    throw new Error(
      `football-data.org request failed: ${res.status} ${res.statusText}` +
        (detail ? ` — ${detail}` : "") +
        (remaining !== null ? ` (requests left this minute: ${remaining})` : ""),
    );
  }

  const body = (await res.json()) as FDMatchesResponse;

  if (!Array.isArray(body.matches)) {
    throw new Error(
      `Unexpected API response: ${JSON.stringify(body).slice(0, 200)}`,
    );
  }

  return body.matches;
}

// ─── Post-ET score computation ──────────────────────────────────────────────────
// post-ET = 90' + ET goals (NEVER penalty shootout goals).
// For REGULAR / EXTRA_TIME durations, score.fullTime is exactly that (no shootout
// happened). For PENALTY_SHOOTOUT, fullTime may include shootout goals, so the
// post-ET score is rebuilt from regularTime + extraTime.

function computePostETScore(score: FDScore): {
  home: number | null;
  away: number | null;
} {
  if (score.duration === "PENALTY_SHOOTOUT") {
    const reg = score.regularTime;
    if (!reg || reg.home === null || reg.away === null) {
      return { home: null, away: null };
    }
    return {
      home: reg.home + (score.extraTime?.home ?? 0),
      away: reg.away + (score.extraTime?.away ?? 0),
    };
  }

  return { home: score.fullTime.home, away: score.fullTime.away };
}

// ─── Advancer from final result ────────────────────────────────────────────────

function computeAdvancer(
  match: FDMatch,
  homeCode: string | null | undefined,
  awayCode: string | null | undefined,
): string | null {
  const postET = computePostETScore(match.score);

  if (postET.home === null || postET.away === null) return null;

  // Non-draw result: higher score advances
  if (postET.home > postET.away) return homeCode ?? null;
  if (postET.away > postET.home) return awayCode ?? null;

  // Level after ET: score.winner is authoritative (covers shootouts and awarded
  // results); fall back to comparing the shootout score directly.
  if (match.score.winner === "HOME_TEAM") return homeCode ?? null;
  if (match.score.winner === "AWAY_TEAM") return awayCode ?? null;

  const pen = match.score.penalties;
  if (pen && pen.home !== null && pen.away !== null) {
    if (pen.home > pen.away) return homeCode ?? null;
    if (pen.away > pen.home) return awayCode ?? null;
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
    const footballDataToken = Deno.env.get("FOOTBALL_DATA_TOKEN") ?? "";
    const footballDataCompetition =
      Deno.env.get("FOOTBALL_DATA_COMPETITION") || "WC";
    // Dedicated shared secret for the cron caller; the service role key works as
    // a fallback so the local stack needs no extra setup.
    const cronSecret = Deno.env.get("CRON_SECRET") || serviceRoleKey;

    // ── 1. Auth guard ──────────────────────────────────────────────────────────
    if (!cronSecret || !authorize(req, cronSecret)) {
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

    // ── Env check for football-data.org ───────────────────────────────────────
    if (!footballDataToken) {
      return new Response(
        JSON.stringify({
          message:
            "Games in window but missing env vars: FOOTBALL_DATA_TOKEN — skipping API call",
          stats,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    // ── 3a. ONE football-data.org call: all matches of the current season ─────
    // Fetching the entire competition covers live, recent, and finished matches
    // in a single request. The frugality gate above ensures this only fires on
    // match days. Free tier: 10 req/min — one call per 10-minute tick is far below.
    stats.apiCalls++;
    const matches = await fetchMatches(footballDataCompetition, footballDataToken);

    if (matches.length === 0) {
      stats.errors.push(
        `API returned 0 matches for competition "${footballDataCompetition}" — check FOOTBALL_DATA_COMPETITION / season availability`,
      );
      return new Response(
        JSON.stringify({ message: "sync-results completed (no matches)", stats }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    // Build external_id to match map for quick lookup
    const matchMap = new Map<string, FDMatch>();
    for (const m of matches) {
      matchMap.set(String(m.id), m);
    }

    // ── Fetch all games that have an external_id ───────────────────────────────
    const { data: dbGames, error: dbGamesErr } = await supabase
      .from("games")
      .select(
        "id, external_id, kickoff, score_home, score_away, result_status, voided, postponed, updated_at",
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

      const match = matchMap.get(game.external_id);
      if (!match) {
        stats.skipped++;
        continue;
      }

      const apiStatus = match.status;
      const apiKickoff = match.utcDate;

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
        if (!game.postponed) updates.postponed = true;
      } else if (
        game.postponed &&
        (kickoffChanged ||
          FINISHED_STATUSES.has(apiStatus) ||
          LIVE_STATUSES.has(apiStatus))
      ) {
        // Rescheduled, resumed, or completed — clear the stale flag
        updates.postponed = false;
      }

      // ── Finished matches (incl. AWARDED technical results) ─────────────────
      if (FINISHED_STATUSES.has(apiStatus) && !isConfirmed) {
        const postET = computePostETScore(match.score);

        if (postET.home !== null && postET.away !== null) {
          // Fetch team codes for advancer computation
          const { data: gameTeams } = await supabase
            .from("games")
            .select("home, away")
            .eq("id", game.id)
            .single();

          const homeCode = gameTeams?.home ?? null;
          const awayCode = gameTeams?.away ?? null;

          const advancer = computeAdvancer(match, homeCode, awayCode);

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
