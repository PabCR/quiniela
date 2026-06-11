/**
 * Quiniela — production seed script
 *
 * Run once locally after deploying migrations:
 *   npx tsx supabase/seed/seed.ts
 *
 * Required environment variables:
 *   SUPABASE_URL              — e.g. https://xyzcompany.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY — service role JWT (never expose to clients)
 *   FOOTBALL_DATA_TOKEN       — football-data.org API token (X-Auth-Token header)
 *   FOOTBALL_DATA_COMPETITION — competition code or id (optional, default "WC")
 *
 * Runtime: Node via `npx tsx supabase/seed/seed.ts`
 * Idempotent: safe to re-run (upserts keyed on external_id / unique keys).
 */

import { createClient } from "@supabase/supabase-js";

// ─── env validation ──────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const FOOTBALL_DATA_TOKEN = process.env.FOOTBALL_DATA_TOKEN;
const FOOTBALL_DATA_COMPETITION = process.env.FOOTBALL_DATA_COMPETITION || "WC";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !FOOTBALL_DATA_TOKEN) {
  console.error(
    "❌  Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, FOOTBALL_DATA_TOKEN"
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ─── static team mapping ─────────────────────────────────────────────────────
// Primary lookup is by FIFA code (football-data.org's `tla` field); the name
// keys are a fallback for any tla mismatch. ~60 plausible WC 2026 qualifiers.
// Add more as the draw is finalised.

interface TeamDef {
  code: string; // FIFA 3-letter
  name_en: string;
  name_es: string;
  flag: string; // emoji
}

const TEAM_MAP: Record<string, TeamDef> = {
  // CONCACAF
  "United States": { code: "USA", name_en: "United States", name_es: "Estados Unidos", flag: "🇺🇸" },
  Mexico:          { code: "MEX", name_en: "Mexico",         name_es: "México",         flag: "🇲🇽" },
  Canada:          { code: "CAN", name_en: "Canada",         name_es: "Canadá",         flag: "🇨🇦" },
  Panama:          { code: "PAN", name_en: "Panama",         name_es: "Panamá",         flag: "🇵🇦" },
  "Costa Rica":    { code: "CRC", name_en: "Costa Rica",     name_es: "Costa Rica",     flag: "🇨🇷" },
  Honduras:        { code: "HON", name_en: "Honduras",       name_es: "Honduras",       flag: "🇭🇳" },
  Jamaica:         { code: "JAM", name_en: "Jamaica",        name_es: "Jamaica",        flag: "🇯🇲" },
  Haiti:           { code: "HAI", name_en: "Haiti",          name_es: "Haití",          flag: "🇭🇹" },
  Trinidad:        { code: "TRI", name_en: "Trinidad & Tobago", name_es: "Trinidad y Tobago", flag: "🇹🇹" },
  Curaçao:         { code: "CUW", name_en: "Curaçao",        name_es: "Curazao",        flag: "🇨🇼" },
  // CONMEBOL
  Brazil:          { code: "BRA", name_en: "Brazil",         name_es: "Brasil",         flag: "🇧🇷" },
  Argentina:       { code: "ARG", name_en: "Argentina",      name_es: "Argentina",      flag: "🇦🇷" },
  Colombia:        { code: "COL", name_en: "Colombia",       name_es: "Colombia",       flag: "🇨🇴" },
  Uruguay:         { code: "URU", name_en: "Uruguay",        name_es: "Uruguay",        flag: "🇺🇾" },
  Ecuador:         { code: "ECU", name_en: "Ecuador",        name_es: "Ecuador",        flag: "🇪🇨" },
  Paraguay:        { code: "PAR", name_en: "Paraguay",       name_es: "Paraguay",       flag: "🇵🇾" },
  Chile:           { code: "CHI", name_en: "Chile",          name_es: "Chile",          flag: "🇨🇱" },
  Bolivia:         { code: "BOL", name_en: "Bolivia",        name_es: "Bolivia",        flag: "🇧🇴" },
  Venezuela:       { code: "VEN", name_en: "Venezuela",      name_es: "Venezuela",      flag: "🇻🇪" },
  Peru:            { code: "PER", name_en: "Peru",           name_es: "Perú",           flag: "🇵🇪" },
  // UEFA
  France:          { code: "FRA", name_en: "France",         name_es: "Francia",        flag: "🇫🇷" },
  England:         { code: "ENG", name_en: "England",        name_es: "Inglaterra",     flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿" },
  Germany:         { code: "GER", name_en: "Germany",        name_es: "Alemania",       flag: "🇩🇪" },
  Spain:           { code: "ESP", name_en: "Spain",          name_es: "España",         flag: "🇪🇸" },
  Portugal:        { code: "POR", name_en: "Portugal",       name_es: "Portugal",       flag: "🇵🇹" },
  Netherlands:     { code: "NED", name_en: "Netherlands",    name_es: "Países Bajos",   flag: "🇳🇱" },
  Belgium:         { code: "BEL", name_en: "Belgium",        name_es: "Bélgica",        flag: "🇧🇪" },
  Italy:           { code: "ITA", name_en: "Italy",          name_es: "Italia",         flag: "🇮🇹" },
  Croatia:         { code: "CRO", name_en: "Croatia",        name_es: "Croacia",        flag: "🇭🇷" },
  Switzerland:     { code: "SUI", name_en: "Switzerland",    name_es: "Suiza",          flag: "🇨🇭" },
  Denmark:         { code: "DEN", name_en: "Denmark",        name_es: "Dinamarca",      flag: "🇩🇰" },
  Austria:         { code: "AUT", name_en: "Austria",        name_es: "Austria",        flag: "🇦🇹" },
  Serbia:          { code: "SRB", name_en: "Serbia",         name_es: "Serbia",         flag: "🇷🇸" },
  Poland:          { code: "POL", name_en: "Poland",         name_es: "Polonia",        flag: "🇵🇱" },
  Ukraine:         { code: "UKR", name_en: "Ukraine",        name_es: "Ucrania",        flag: "🇺🇦" },
  Scotland:        { code: "SCO", name_en: "Scotland",       name_es: "Escocia",        flag: "🏴󠁧󠁢󠁳󠁣󠁴󠁿" },
  Turkey:          { code: "TUR", name_en: "Türkiye",        name_es: "Turquía",        flag: "🇹🇷" },
  Czechia:         { code: "CZE", name_en: "Czechia",        name_es: "Chequia",        flag: "🇨🇿" },
  Hungary:         { code: "HUN", name_en: "Hungary",        name_es: "Hungría",        flag: "🇭🇺" },
  Romania:         { code: "ROU", name_en: "Romania",        name_es: "Rumania",        flag: "🇷🇴" },
  Slovakia:        { code: "SVK", name_en: "Slovakia",       name_es: "Eslovaquia",     flag: "🇸🇰" },
  Slovenia:        { code: "SVN", name_en: "Slovenia",       name_es: "Eslovenia",      flag: "🇸🇮" },
  Greece:          { code: "GRE", name_en: "Greece",         name_es: "Grecia",         flag: "🇬🇷" },
  Albania:         { code: "ALB", name_en: "Albania",        name_es: "Albania",        flag: "🇦🇱" },
  Bosnia:          { code: "BIH", name_en: "Bosnia & Herzegovina", name_es: "Bosnia y Herzegovina", flag: "🇧🇦" },
  Georgia:         { code: "GEO", name_en: "Georgia",        name_es: "Georgia",        flag: "🇬🇪" },
  Wales:           { code: "WAL", name_en: "Wales",          name_es: "Gales",          flag: "🏴󠁧󠁢󠁷󠁬󠁳󠁿" },
  Sweden:          { code: "SWE", name_en: "Sweden",         name_es: "Suecia",         flag: "🇸🇪" },
  Norway:          { code: "NOR", name_en: "Norway",         name_es: "Noruega",        flag: "🇳🇴" },
  // CAF
  Morocco:         { code: "MAR", name_en: "Morocco",        name_es: "Marruecos",      flag: "🇲🇦" },
  Senegal:         { code: "SEN", name_en: "Senegal",        name_es: "Senegal",        flag: "🇸🇳" },
  Egypt:           { code: "EGY", name_en: "Egypt",          name_es: "Egipto",         flag: "🇪🇬" },
  Nigeria:         { code: "NGA", name_en: "Nigeria",        name_es: "Nigeria",        flag: "🇳🇬" },
  Ghana:           { code: "GHA", name_en: "Ghana",          name_es: "Ghana",          flag: "🇬🇭" },
  "South Africa":  { code: "RSA", name_en: "South Africa",   name_es: "Sudáfrica",      flag: "🇿🇦" },
  "Ivory Coast":   { code: "CIV", name_en: "Ivory Coast",    name_es: "Costa de Marfil",flag: "🇨🇮" },
  Cameroon:        { code: "CMR", name_en: "Cameroon",       name_es: "Camerún",        flag: "🇨🇲" },
  Algeria:         { code: "ALG", name_en: "Algeria",        name_es: "Argelia",        flag: "🇩🇿" },
  Mali:            { code: "MLI", name_en: "Mali",           name_es: "Malí",           flag: "🇲🇱" },
  Tunisia:         { code: "TUN", name_en: "Tunisia",        name_es: "Túnez",          flag: "🇹🇳" },
  "Cape Verde Islands": { code: "CPV", name_en: "Cape Verde", name_es: "Cabo Verde",    flag: "🇨🇻" },
  "Congo DR":      { code: "COD", name_en: "DR Congo",       name_es: "RD del Congo",   flag: "🇨🇩" },
  // AFC
  Japan:           { code: "JPN", name_en: "Japan",          name_es: "Japón",          flag: "🇯🇵" },
  "South Korea":   { code: "KOR", name_en: "South Korea",    name_es: "Corea del Sur",  flag: "🇰🇷" },
  Australia:       { code: "AUS", name_en: "Australia",      name_es: "Australia",      flag: "🇦🇺" },
  Iran:            { code: "IRN", name_en: "Iran",           name_es: "Irán",           flag: "🇮🇷" },
  "Saudi Arabia":  { code: "KSA", name_en: "Saudi Arabia",   name_es: "Arabia Saudita", flag: "🇸🇦" },
  Qatar:           { code: "QAT", name_en: "Qatar",          name_es: "Catar",          flag: "🇶🇦" },
  Iraq:            { code: "IRQ", name_en: "Iraq",           name_es: "Irak",           flag: "🇮🇶" },
  Jordan:          { code: "JOR", name_en: "Jordan",         name_es: "Jordania",       flag: "🇯🇴" },
  Uzbekistan:      { code: "UZB", name_en: "Uzbekistan",     name_es: "Uzbekistán",     flag: "🇺🇿" },
  // OFC
  "New Zealand":   { code: "NZL", name_en: "New Zealand",    name_es: "Nueva Zelanda",  flag: "🇳🇿" },
};

// Index by FIFA code for tla-based lookup
const TEAM_BY_CODE = new Map<string, TeamDef>(
  Object.values(TEAM_MAP).map((t) => [t.code, t])
);

// ─── stage mapping ────────────────────────────────────────────────────────────

type StageEnum =
  | "GROUP_A" | "GROUP_B" | "GROUP_C" | "GROUP_D" | "GROUP_E" | "GROUP_F"
  | "GROUP_G" | "GROUP_H" | "GROUP_I" | "GROUP_J" | "GROUP_K" | "GROUP_L"
  | "R32" | "R16" | "QF" | "SF" | "THIRD" | "FINAL";

/**
 * Maps football-data.org stage/group enums to our stage enum.
 * Group-stage matches carry the group directly as "GROUP_A".."GROUP_L";
 * knockout stages use the stage enum (LAST_32, LAST_16, ...).
 */
function mapStage(stage: string, group: string | null): StageEnum {
  if (group) {
    if (/^GROUP_[A-L]$/.test(group)) return group as StageEnum;
    console.warn(`⚠️  Unrecognized group "${group}" — falling through to stage "${stage}"`);
  }

  switch (stage) {
    case "LAST_32": return "R32";
    case "LAST_16": return "R16";
    case "QUARTER_FINALS": return "QF";
    case "SEMI_FINALS": return "SF";
    case "THIRD_PLACE": return "THIRD";
    case "FINAL": return "FINAL";
  }

  console.warn(`⚠️  Unknown stage: "${stage}" (group=${group}) — defaulting to GROUP_A`);
  return "GROUP_A";
}

// ─── football-data.org v4 types ───────────────────────────────────────────────

interface FDTeam {
  id: number | null; // null for undetermined knockout slots
  name: string | null;
  shortName: string | null;
  tla: string | null;
  crest?: string | null;
}

interface FDMatch {
  id: number;
  utcDate: string; // ISO 8601 UTC
  status: string;
  stage: string;
  group: string | null;
  venue?: string | null;
  homeTeam: FDTeam;
  awayTeam: FDTeam;
}

interface FDMatchesResponse {
  resultSet?: { count: number };
  matches: FDMatch[];
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function generateInviteCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function isTBD(team: FDTeam | null | undefined): boolean {
  return !team || team.id === null || !team.name;
}

function resolveTeam(team: FDTeam): TeamDef {
  // tla is football-data.org's FIFA-style trigram — primary key into our map
  if (team.tla) {
    const byCode = TEAM_BY_CODE.get(team.tla);
    if (byCode) return byCode;
  }
  if (team.name && TEAM_MAP[team.name]) return TEAM_MAP[team.name];

  const code =
    team.tla ??
    ((team.name ?? "").replace(/[^a-zA-Z]/g, "").slice(0, 3).toUpperCase() || "UNK");
  console.warn(
    `⚠️  UNKNOWN TEAM: "${team.name}" (tla=${team.tla}) — using code "${code}". Add to TEAM_MAP for proper ES name / flag.`
  );
  return { code, name_en: team.name ?? code, name_es: team.name ?? code, flag: "🏳️" };
}

async function fetchMatches(
  competition: string,
  apiToken: string
): Promise<FDMatch[]> {
  // No season filter: defaults to the competition's current season.
  const url = `https://api.football-data.org/v4/competitions/${competition}/matches`;
  console.log(`Fetching matches from: ${url}`);

  const res = await fetch(url, {
    headers: { "X-Auth-Token": apiToken },
  });

  if (!res.ok) {
    let detail = "";
    try {
      const errBody = (await res.json()) as { message?: string; error?: string };
      detail = errBody.message ?? errBody.error ?? "";
    } catch {
      // non-JSON error body
    }
    throw new Error(
      `football-data.org request failed: ${res.status} ${res.statusText}${detail ? ` — ${detail}` : ""}`
    );
  }

  const body = (await res.json()) as FDMatchesResponse;

  if (!Array.isArray(body.matches)) {
    throw new Error(
      `Unexpected API response shape: ${JSON.stringify(body).slice(0, 200)}`
    );
  }

  console.log(`Fetched ${body.matches.length} matches.`);
  return body.matches;
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== Quiniela seed script ===\n");

  // 1. Fetch matches
  const matches = await fetchMatches(
    FOOTBALL_DATA_COMPETITION,
    FOOTBALL_DATA_TOKEN!
  );

  if (matches.length === 0) {
    throw new Error("No matches returned. Check competition code and season.");
  }

  // 2. Collect all unique teams from matches
  const teamsFromAPI = new Map<string, TeamDef>();
  for (const m of matches) {
    for (const side of [m.homeTeam, m.awayTeam]) {
      if (!isTBD(side)) {
        const def = resolveTeam(side);
        teamsFromAPI.set(def.code, def);
      }
    }
  }

  // Also ensure every team in the static map is available (for TBD KO slots)
  for (const def of Object.values(TEAM_MAP)) {
    if (!teamsFromAPI.has(def.code)) {
      teamsFromAPI.set(def.code, def);
    }
  }

  // 3. Upsert teams
  console.log(`Upserting ${teamsFromAPI.size} teams...`);
  const teamRows = Array.from(teamsFromAPI.values()).map((t) => ({
    code: t.code,
    name_en: t.name_en,
    name_es: t.name_es,
    flag: t.flag,
  }));

  const { error: teamsErr } = await supabase
    .from("teams")
    .upsert(teamRows, { onConflict: "code" });

  if (teamsErr) throw new Error(`Failed to upsert teams: ${teamsErr.message}`);
  console.log("  ✓ Teams upserted.");

  // 4. Upsert tournament
  console.log("Upserting tournament...");
  const { data: existingTournament } = await supabase
    .from("tournaments")
    .select("id")
    .eq("external_league_id", FOOTBALL_DATA_COMPETITION)
    .maybeSingle();

  let tournamentId: number;
  if (existingTournament) {
    tournamentId = existingTournament.id;
    console.log(`  ✓ Tournament already exists (id=${tournamentId}).`);
  } else {
    const { data: newTournament, error: tournErr } = await supabase
      .from("tournaments")
      .insert({
        name: "World Cup 2026",
        external_league_id: FOOTBALL_DATA_COMPETITION,
      })
      .select("id")
      .single();

    if (tournErr || !newTournament) {
      throw new Error(`Failed to insert tournament: ${tournErr?.message}`);
    }
    tournamentId = newTournament.id;
    console.log(`  ✓ Tournament inserted (id=${tournamentId}).`);
  }

  // 5. Upsert games
  console.log("Upserting games...");

  const gameRows = matches.map((m) => {
    const externalId = String(m.id);
    const stage = mapStage(m.stage, m.group);

    const homeCode = isTBD(m.homeTeam) ? null : resolveTeam(m.homeTeam).code;
    const awayCode = isTBD(m.awayTeam) ? null : resolveTeam(m.awayTeam).code;

    const kickoff = m.utcDate; // already ISO 8601 UTC
    const location = m.venue ?? null;

    return {
      tournament_id: tournamentId,
      external_id: externalId,
      stage,
      home: homeCode,
      away: awayCode,
      kickoff,
      location,
    };
  });

  const { error: gamesErr } = await supabase
    .from("games")
    .upsert(gameRows, { onConflict: "external_id" });

  if (gamesErr) throw new Error(`Failed to upsert games: ${gamesErr.message}`);
  console.log(`  ✓ ${gameRows.length} games upserted.`);

  // 6. Upsert pool
  console.log("Upserting pool...");
  const { data: existingPool } = await supabase
    .from("pools")
    .select("id, invite_code")
    .eq("tournament_id", tournamentId)
    .eq("name", "Quiniela Familiar")
    .maybeSingle();

  let poolId: number;
  let inviteCode: string;

  if (existingPool) {
    poolId = existingPool.id;
    inviteCode = existingPool.invite_code;
    console.log(`  ✓ Pool already exists (id=${poolId}, invite_code=${inviteCode}).`);
  } else {
    inviteCode = generateInviteCode();
    const { data: newPool, error: poolErr } = await supabase
      .from("pools")
      .insert({
        tournament_id: tournamentId,
        name: "Quiniela Familiar",
        invite_code: inviteCode,
        pts_full: 3,
        pts_partial: 1,
      })
      .select("id")
      .single();

    if (poolErr || !newPool) {
      throw new Error(`Failed to insert pool: ${poolErr?.message}`);
    }
    poolId = newPool.id;
    console.log(`  ✓ Pool inserted (id=${poolId}).`);
  }

  // ╔══════════════════════════════════════════╗
  // ║  INVITE CODE — share with family:        ║
  console.log(`\n  ┌─────────────────────────────┐`);
  console.log(`  │  Invite code:  ${inviteCode.padEnd(13)}│`);
  console.log(`  └─────────────────────────────┘\n`);
  // ╚══════════════════════════════════════════╝

  // 7. Create Pablo's auth user if absent
  console.log("Ensuring Pablo's auth user...");
  const pabloEmail = "palv2602@gmail.com";

  // List users to check existence (admin API)
  const { data: usersPage, error: listErr } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });

  if (listErr) throw new Error(`Failed to list users: ${listErr.message}`);

  let pabloUserId: string | undefined = usersPage?.users.find(
    (u) => u.email === pabloEmail
  )?.id;

  if (pabloUserId) {
    console.log(`  ✓ Pablo's user already exists (id=${pabloUserId}).`);
  } else {
    const { data: newUser, error: createErr } = await supabase.auth.admin.createUser({
      email: pabloEmail,
      email_confirm: true,
    });

    if (createErr || !newUser?.user) {
      throw new Error(`Failed to create Pablo's user: ${createErr?.message}`);
    }
    pabloUserId = newUser.user.id;
    console.log(`  ✓ Pablo's user created (id=${pabloUserId}).`);
  }

  // 8. Upsert Pablo's profile
  console.log("Upserting Pablo's profile...");
  const { error: profileErr } = await supabase
    .from("profiles")
    .upsert(
      { id: pabloUserId, name: "Pablo", emoji: "🦊", lang: "es" },
      { onConflict: "id" }
    );

  if (profileErr) throw new Error(`Failed to upsert profile: ${profileErr.message}`);
  console.log("  ✓ Profile upserted.");

  // 9. Upsert admin membership
  console.log("Upserting Pablo's membership...");
  const { error: memberErr } = await supabase
    .from("memberships")
    .upsert(
      { pool_id: poolId, user_id: pabloUserId, role: "admin" },
      { onConflict: "pool_id,user_id" }
    );

  if (memberErr) throw new Error(`Failed to upsert membership: ${memberErr.message}`);
  console.log("  ✓ Membership upserted (role=admin).");

  console.log("\n=== Seed complete ✓ ===\n");
}

main().catch((err) => {
  console.error("\n❌  Seed failed:", err);
  process.exit(1);
});
