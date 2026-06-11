# Quiniela — Seed Scripts

## Files

| File | Purpose |
|---|---|
| `seed.ts` | Production seed — fetches real WC 2026 fixtures from API-Football, upserts teams/games/tournament/pool, creates Pablo's admin user. Run once locally before launch. |
| `seed-dev.sql` | Local dev seed — inserts deterministic relative-time fixtures covering every match-card state and pick variety. Run against local Supabase stack only. |

---

## Production seed (`seed.ts`)

### Prerequisites

- Node.js 18+
- `tsx` available via `npx` (not a project dep — uses network; or `npm install -g tsx` once)
- Local or remote Supabase project with migrations already applied

### Environment variables

| Variable | Description |
|---|---|
| `SUPABASE_URL` | Supabase project URL, e.g. `https://xyzcompany.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role JWT — **never expose to clients or commit to source control** |
| `API_FOOTBALL_KEY` | API-Football `x-apisports-key` header value |
| `API_FOOTBALL_LEAGUE_ID` | Numeric league ID for WC 2026 on API-Football (e.g. `1`) |

### Run

```bash
SUPABASE_URL=https://... \
SUPABASE_SERVICE_ROLE_KEY=eyJ... \
API_FOOTBALL_KEY=your_key \
API_FOOTBALL_LEAGUE_ID=1 \
npx tsx supabase/seed/seed.ts
```

### What it does

1. Fetches all WC 2026 fixtures from `v3.football.api-sports.io` (one request for the full season).
2. Upserts all teams found in fixtures using a static mapping (FIFA codes, ES names, emoji flags). Unknown team names produce a loud `⚠️ UNKNOWN TEAM` warning — add them to `TEAM_MAP` in `seed.ts`.
3. Upserts the `World Cup 2026` tournament keyed on `external_league_id`.
4. Upserts all games with `external_id`, stage mapping, UTC kickoff, and venue city. Knockout fixtures with TBD teams set `home`/`away` to NULL.
5. Creates the `Quiniela Familiar` pool with `pts_full=3`, `pts_partial=1`, and a generated 6-char invite code (printed to stdout).
6. Creates Pablo's auth user (`palv2602@gmail.com`, email confirmed) if absent.
7. Upserts Pablo's profile (`name=Pablo`, `emoji=🦊`, `lang=es`).
8. Upserts Pablo's membership as `admin`.

**Idempotent** — safe to re-run. All writes use upsert keyed on external IDs or unique constraints.

### Stage mapping

API-Football round strings → DB `stage` enum:

| API round | DB stage |
|---|---|
| `Group A - 1`, `Group Stage (Group A)`, … | `GROUP_A` … `GROUP_L` |
| `Round of 32` | `R32` |
| `Round of 16` | `R16` |
| `Quarter-finals` | `QF` |
| `Semi-finals` | `SF` |
| `3rd Place Final` | `THIRD` |
| `Final` | `FINAL` |

### API-Football free tier note

**100 requests/day** on the free tier. This script uses **1 request** (full season fixture list). The `sync-results` Edge Function also consumes quota — plan accordingly if running both frequently on the same day.

---

## Dev seed (`seed-dev.sql`)

### Prerequisites

- Local Supabase stack running (`supabase start`)
- Migrations applied

### Run via `supabase db reset` (recommended)

`supabase db reset` resets the local DB, re-applies all migrations, and then runs any SQL files in `supabase/seed/`. Rename or symlink `seed-dev.sql` → `seed.sql` if your Supabase CLI version picks it up automatically, or pass it explicitly:

```bash
supabase db reset
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres \
  -f supabase/seed/seed-dev.sql
```

### Run directly (no reset)

```bash
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres \
  -f supabase/seed/seed-dev.sql
```

Default local Supabase credentials: `host=127.0.0.1 port=54322 user=postgres password=postgres db=postgres`.

### Match-card states covered

| Game | State | Description |
|---|---|---|
| dev-m1 | `final` (confirmed) | MEX 2-1 RSA — scoring trigger fires; exact/outcome/miss washes |
| dev-m2 | `final` (confirmed) | CAN 1-1 BIH — draw/exact/miss washes |
| dev-m3 | `awaiting` | USA vs PAR, kicked off ~3h ago, no result yet |
| dev-m4 | `live` | QAT vs SUI, kicked off ~60min ago |
| dev-m5 | `upcoming` urgent | BRA vs MAR, <2h, Pablo has NO pick |
| dev-m6 | `upcoming` normal | HAI vs SCO, >2h, Pablo has pick |
| dev-m7 | `upcoming` normal | GER vs CUW, >26h, no picks |
| dev-m8 | `postponed` | AUS vs TUR, future kickoff |
| dev-m9 | `void` | KOR vs CZE |
| dev-m10 | `upcoming` KO | MEX vs SCO (R32), draw picks with advancers |
| dev-m11 | `final` KO | MEX vs BRA (R16), 1-1 draw, MEX advances; KO scoring variants |

### Pick varieties covered (via scoring trigger)

| Member | Game | Pick | Expected result |
|---|---|---|---|
| Pablo | dev-m1 | 2-1 | `exact` |
| Carmen | dev-m1 | 2-1 | `exact` |
| Jose | dev-m1 | 1-0 | `outcome` |
| Sofia | dev-m1 | 0-1 | `miss` |
| Raúl | dev-m1 | (none) | em-dash (no pick) |
| Carmen | dev-m2 | 1-1 | `exact` |
| Lupita | dev-m2 | 0-0 | `outcome` |
| Pablo | dev-m2 | 2-1 | `miss` |
| Pablo | dev-m11 | 1-1 adv=MEX | KO `exact` |
| Carmen | dev-m11 | 2-2 adv=MEX | KO `draw` (rule 2 before rule 3) |
| Raúl | dev-m11 | 1-1 adv=BRA | KO `draw` |
| Diego | dev-m11 | 2-1 (MEX by score) | KO `outcome` |
| Sofía | dev-m11 | 1-2 (BRA by score) | KO `miss` |

---

## TypeScript typecheck note

`seed.ts` has its own `supabase/seed/tsconfig.json` and is excluded from the app
typecheck (`tsconfig.json` at repo root uses `"**/*.ts"` include but the seed's
own tsconfig scopes it independently). Run `npx tsc --noEmit` from the repo root
to verify the app typecheck is clean.
