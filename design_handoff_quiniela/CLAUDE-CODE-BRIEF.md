# Build Brief: Quiniela — Family World Cup Prediction App

**Audience:** Claude Code (implementing agent)
**Goal:** One-shot a working Expo Native app + Supabase backend, faithful to the design prototype in `prototype/`.
**Companion docs in this folder:** `quiniela-product-spec.md` (product requirements), `README.md` (design handoff), `prototype/` (hifi design reference).

---

## 0. Locked decisions — do not revisit

| Area | Decision |
|---|---|
| Frontend | **Expo Native** (iOS + Android), TypeScript, **Expo Router**, **NativeWind** |
| Backend | **Supabase**: Postgres + RLS, Auth (email OTP), Edge Functions, pg_cron |
| Auth | Supabase **email OTP** (passwordless 6-digit code). **Self-serve sign-up/sign-in** — same screen, `signInWithOtp` creates the account if new. Pool admission gated by an **invite code**. No passwords, no social login, no anonymous auth |
| Results | **API-Football** sync via Edge Function + cron; admin override in-app; manual entry fallback |
| Scoring | Computed **only** in a Postgres function via trigger. Client never writes points |
| Push notifications | **DEFERRED — do not build.** No expo-notifications, no service workers, no Background Sync. In-app "picks pending" badge is the reminder mechanism |
| Distribution | EAS builds → TestFlight internal + Play internal. Configure `eas.json`; submission itself is manual |
| Email | Supabase Auth SMTP via **Resend** (config note only — env vars, no code) |
| i18n | Full ES/EN from day one. Port the dictionary from `prototype/app/i18n.js` |

**Non-goals (from product spec — build none of this):** money/payments, multiple pools UI, other tournaments, bracket/champion predictions, chat/comments, dark mode (but theme must be token-swappable), web output.

---

## 1. What the app is

~16 family members predict World Cup scores. Picks lock server-side at kickoff and become visible to everyone after lock. Results sync from API-Football (admin can override/enter manually). Points compute automatically. A tournament-long leaderboard ranks the family. Full UX, all screens, all states, copy, and visual design are specified in `README.md` and demonstrated in `prototype/` — **read both before writing UI code.**

---

## 2. How to use the prototype (`prototype/`)

| File | Action |
|---|---|
| `tokens.css` | **Translate token-for-token** into `tailwind.config.js` theme (NativeWind). Keep names recognizable (`exact`, `partialSoft`, `surface2`…). No hardcoded colors anywhere in components |
| `app/engine.js` | **Port to TypeScript** (`lib/engine.ts`) with changes in §6. The scoring/status/standings logic is correct and verified — do not redesign it |
| `app/i18n.js` | **Port the dictionary as-is** to a typed i18n module |
| `app/components.jsx`, `screens-*.jsx`, `app.css` | **Visual reference only.** Recreate in RN/NativeWind. `app.css` contains exact spacing/sizing — honor the values |
| `app/data.js` | **Data shapes reference + mock data for dev.** Production data comes from Supabase |
| `ios-frame.jsx`, `tweaks-panel.jsx`, `design-canvas.jsx`, `cards.css`, `directions.jsx`, `Match Card Directions.html` | **Ignore entirely** — prototype scaffolding |

RN translation notes: emoji flags render fine on iOS/Android — keep them. `tabular-nums` → `fontVariant: ['tabular-nums']`. The `qBounce` spring → `react-native-reanimated` spring on stepper values and the "Saved ✓" pill (the one sanctioned delight moment). Respect reduced-motion.

---

## 3. Repository structure

```
quiniela/
  app/                  # Expo Router routes
    (tabs)/             #   matches, leaderboard, me
    match/[id].tsx
    admin/              #   results list, result-entry, members
    auth/               #   email entry, OTP code, profile (emoji)
  components/           # MatchCard, Stepper, PointsTag, Avatar, SavedPill, sheets…
  lib/                  # engine.ts, i18n.ts, supabase.ts, types.ts
  supabase/
    migrations/         # SQL below, split sensibly
    functions/
      sync-results/     # Edge Function (cron)
    seed/
      seed.ts           # fixtures via API-Football + teams + pool + memberships
  eas.json
  tailwind.config.js
```

---

## 4. Database schema (use this SQL — do not redesign)

```sql
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
```

### RLS — this is the product's integrity layer. Enable RLS on every table.

- **guesses INSERT/UPDATE:** `user_id = auth.uid()` AND game's `kickoff > now()` AND game not voided. (The lock is server-side; client countdowns are cosmetic.)
- **guesses SELECT:** own rows always; others' rows only when game's `kickoff <= now()`.
- **guesses:** `points`/`tag` must not be writable by clients — use a column-level approach: client RPC or trigger strips/ignores them, or write via `before insert/update` trigger that nulls them unless set by `score_game()`.
- **games/teams/tournaments/pools/profiles/memberships SELECT:** any authenticated member.
- **games INSERT/UPDATE:** service role only. Admin result entry goes through a **SECURITY DEFINER RPC** `admin_set_result(game_id, h, a, adv, void)` that verifies the caller's membership role = 'admin', sets `result_status='confirmed'`, flags `corrected` if a result existed.
- **pools UPDATE (pts config):** admin only, and only while `scoring_locked = false`.
- **profiles UPDATE:** own row only (name/emoji/lang).

### Scoring function + trigger

`score_game(game_id)` — plpgsql port of `prototype/app/engine.js → scorePick` (rules in §5), reading `pts_full`/`pts_partial` from the pool. Rewrites `points`+`tag` for all guesses on that game; on void, nulls them. Trigger: after update of `score_home, score_away, advancer, voided, result_status` on `games`, when `result_status='confirmed'` or `voided` changed. Also set `pools.scoring_locked = true` the first time any game with guesses passes kickoff (can be done in the sync function).

---

## 5. Scoring rules (canonical — port exactly, then prove with the test table)

Group stage: exact score → `pts_full` (tag `exact`); correct outcome (sign of goal difference) → `pts_partial` (`outcome`); else 0 (`miss`).

Knockout (any stage ≥ R32): scored on **post-ET score** + **advancing team**. A non-draw pick implies its winner as advancer; a draw pick requires an explicit `advancer`.

| Priority | Condition | Result |
|---|---|---|
| 1 | exact post-ET score AND correct advancer | `pts_full`, `exact` |
| 2 | pick is a draw AND result is a draw (any score, any advancer pick) | `pts_partial`, `draw` |
| 3 | correct advancer | `pts_partial`, `outcome` |
| 4 | otherwise | 0, `miss` |

No stacking — first matching rule wins. Incomplete pick (missing score, or KO draw without advancer) = no pick: 0 points, rendered as **em-dash, never "0"**. Leaderboard sort: points desc → exact count desc → shared rank (display `T-2`).

### Golden tests (defaults 3/1) — implement as unit tests for `engine.ts` AND as a SQL test for `score_game()`:

| # | Stage | Pick | Result (post-ET, advancer) | Expected |
|---|---|---|---|---|
| 1 | Group | 2-1 | 2-1 | 3 `exact` |
| 2 | Group | 1-0 | 2-1 | 1 `outcome` |
| 3 | Group | 1-1 | 2-2 | 1 `outcome` |
| 4 | Group | 0-1 | 2-1 | 0 `miss` |
| 5 | Group | none | 2-1 | no row / em-dash, 0 |
| 6 | KO | 2-1 | 2-1, home advances | 3 `exact` |
| 7 | KO | 2-1 | 3-1, home advances | 1 `outcome` |
| 8 | KO | 1-1 adv=HOME | 1-1, HOME on pens | 3 `exact` |
| 9 | KO | 1-1 adv=HOME | 1-1, AWAY on pens | 1 `draw` |
| 10 | KO | 2-2 adv=AWAY | 1-1, AWAY on pens | 1 `draw` (rule 2 before 3; never 2 pts) |
| 11 | KO | 2-1 | 1-1, HOME on pens | 1 `outcome` |
| 12 | KO | 1-1, no advancer chosen | any | incomplete = no pick |

---

## 6. Engine port — required changes from the prototype

1. **No globals.** `engine.ts` functions take `now: Date`, `teams`, and pool point values as parameters (prototype used `window.Q_NOW` / `Q_TEAMS` and hardcoded 3/1).
2. **KO live window.** Prototype flips live→awaiting at 115 min — wrong for extra time. Use: group stages 115 min, KO stages **165 min**. `liveMinute` may exceed 90 for KO (cap display at 120+).
3. **Stage labels.** Prototype hardcoded "Round of 32" for all KO. Label from the `stage` enum (R32/R16/QF/SF/THIRD/FINAL) — add the i18n strings for each (ES: Dieciseisavos, Octavos, Cuartos, Semifinal, Tercer lugar, Final).
4. Status precedence stays: `void → final(confirmed) → postponed → live → awaiting → upcoming`. Treat `provisional` results as status `awaiting`+"provisional" marker on the admin screen; participants see `final` only on confirmed.

---

## 7. Auth & onboarding flow (self-serve)

1. App first-run: **invite code screen** ("the key to the house"). Validated via an anon-callable RPC `check_invite_code(code) returns boolean` (SECURITY DEFINER; returns no pool data). Wrong code → inline error; user goes no further. NOTE: this gate is UX-level — real enforcement is steps 3's revalidation + membership-scoped RLS.
2. Code OK → **email entry** → Supabase `signInWithOtp` (creates account if new) → **6-digit code** screen. Returning users with an existing session skip straight to Matches; returning users re-authing skip step 1 if they already hold a membership (check after OTP).
3. New members then see the **profile screen**: display name + **emoji avatar picker** (reuse the prototype's Join visual language; the name-grid is replaced by a name input). Submitting calls a **SECURITY DEFINER RPC** `join_pool(invite_code, name, emoji)` — the invite code is passed through from step 1 and **revalidated server-side** — which creates the `profiles` row and a `memberships` row (role 'player'). Clients can NEVER insert memberships directly. Seed makes Pablo's membership role 'admin'.
3b. **RLS reminder:** all data SELECT policies must require an active (non-hidden) membership — an authenticated user without membership sees nothing.
4. Session persists (Supabase session in SecureStore). Sign-out only from Me screen.
5. Edge states: wrong invite code → inline error ("Ask Pablo for the code"); wrong/expired OTP → retry; duplicate display name in pool → reject with suggestion.
6. **Admin: Members** screen shows the invite code with Copy + Rotate actions (replaces the old invite-link row), plus member list with soft-hide.

---

## 8. Edge Function: `sync-results` (+ seed script)

- **Seed (`supabase/seed/seed.ts`, run once locally):** fetch WC2026 fixtures from API-Football (league id via env), upsert `teams` (with ES names + emoji flags — a static mapping in the script is fine) and all `games` with `external_id`, stage mapping, UTC kickoffs, location. Insert tournament + pool + Pablo as admin membership. **Never hand-write the fixture list from memory.**
- **`sync-results` Edge Function**, scheduled via pg_cron every 10 min: fetch fixtures changed/live for the league; map API status; when a fixture is finished (`FT`/`AET`/`PEN`), write **post-ET** scores (API-Football provides `score.fulltime` + `score.extratime` + `penalty` — compute post-ET as 90' + ET goals; advancer from penalty winner when drawn), set `result_status='provisional'` with timestamp. Update changed kickoffs (postponements) — lock follows the new time automatically via RLS.
- **Auto-confirm:** same function run: any `provisional` older than **2h** → `confirmed` (trigger then scores it). Admin RPC override always wins and sets `corrected` when changing a confirmed result.
- Be frugal: free tier = 100 req/day. Poll only when a game is within [kickoff − 5 min, kickoff + 4h]; otherwise the run exits without an API call.

---

## 9. Screens

Build exactly what `README.md` documents — it enumerates every screen and state. Summary checklist:

- **Tabs:** Matches (default) / Leaderboard / Me. Tab badge dot when picks pending.
- **Matches:** date groups, Today pinned, filter All/My pending, pending-picks header pill. Match card with **7 states** (upcoming-unpicked, upcoming-picked, locked/live, final with result-tinted wash + points tag, void, postponed, urgent <2h) + awaiting. Never encode state by color alone.
- **Match detail:** steppers 0–15 with spring bounce, autosave → "Saved ✓", KO-draw advancer picker with incomplete warning, who-has-picked avatar row pre-lock, everyone's-picks table post-lock (points column: lock glyph before result, tags after, sorted by points; em-dash for no-pick).
- **Leaderboard:** ~16 rows, top-3 emphasized, exact-count column, movement arrows, sticky "me" row, tie display `T-2`, tap → member profile (locked-match history + stats). Empty state pre-first-result.
- **Me:** avatar edit, stat tiles, language toggle (persisted to profile), pick history, sign out; admin section (admin role only).
- **Admin:** Results (awaiting queue incl. provisional, entry with steppers + advancer, **confirm sheet showing points impact** via `impactOf`, edit with "corrected" stamp, void with its own confirm) · Members (list, add member doc/note — user creation is via Supabase, the screen manages memberships/release).

Realtime: subscribe to `games` and `guesses` changes (Supabase Realtime) so results and reveals appear without refresh; fall back to refetch-on-focus.

---

## 10. Environment & config

```
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_ANON_KEY=
# server-side only (Edge Function secrets / seed script):
SUPABASE_SERVICE_ROLE_KEY=
API_FOOTBALL_KEY=
API_FOOTBALL_LEAGUE_ID=
RESEND_API_KEY=            # configured in Supabase Auth SMTP settings, not in code
```

`eas.json`: `development`, `preview` (internal distribution), `production` (store) profiles. Bundle ids: `com.pablo.quiniela` (adjust if taken).

---

## 11. Build order

1. Migrations + RLS + `score_game` + trigger + SQL tests (golden table §5)
2. Seed script (teams, fixtures, tournament, pool, admin)
3. `lib/engine.ts` port + unit tests (golden table §5) · `lib/i18n.ts`
4. NativeWind theme from `tokens.css`
5. Auth flow → tabs shell → Matches list + card states → Match detail/pick → Leaderboard → Me
6. Admin screens + `admin_set_result` RPC
7. `sync-results` Edge Function + cron schedule
8. `eas.json` + build verification (`npx expo prebuild` sanity, type-check, lint, all tests green)

## 12. Acceptance checklist (self-verify before declaring done)

- [ ] All 12 golden scoring tests pass in **both** TS and SQL
- [ ] A guess INSERT/UPDATE after kickoff is rejected by RLS (test with two users)
- [ ] An authenticated user with no membership can read no pool/game/guess data; `join_pool` rejects a bad invite code
- [ ] User A cannot read user B's guess before kickoff; can after
- [ ] Client cannot write `points`/`tag`
- [ ] Admin result entry → points + leaderboard update; correction restamps and recomputes; void nulls points
- [ ] Every screen renders in ES and EN without truncation (ES is the width worst case)
- [ ] All 7 match-card states + awaiting reachable with seeded dev data
- [ ] No hardcoded colors — components consume the NativeWind theme only
- [ ] em-dash vs "0" distinction everywhere points render
- [ ] App runs on iOS simulator + Android emulator; type-check and lint clean
