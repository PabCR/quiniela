# Quiniela — Family World Cup Prediction Pool

~16 family members predict World Cup scores. Picks lock server-side at kickoff
and reveal to everyone after lock. Results sync from API-Football (admin can
override or enter manually). Points compute automatically in Postgres. A
tournament-long leaderboard ranks the family. Full ES/EN UI.

Built from the design handoff in [`design_handoff_quiniela/`](design_handoff_quiniela/)
— see [`CLAUDE-CODE-BRIEF.md`](design_handoff_quiniela/CLAUDE-CODE-BRIEF.md) for
the locked decisions this implementation follows.

## Stack

- **App** — Expo (iOS + Android), TypeScript, Expo Router, NativeWind v5 +
  Tailwind CSS v4 (design tokens live in [`global.css`](global.css) `@theme`),
  react-native-reanimated for the one sanctioned delight moment.
- **Backend** — Supabase: Postgres + RLS (the integrity layer), email-OTP auth,
  Edge Function results sync on pg_cron, scoring computed **only** by the
  `score_game()` Postgres function via trigger. Clients can never write points.

## Repository layout

```
app/                Expo Router routes
  (tabs)/           matches · leaderboard · me
  match/[id]        match detail / pick entry
  member/[id]       member profile
  admin/            results queue/entry · members (admin role only)
  auth/             invite code → email → OTP code → profile
components/         MatchCard, Stepper, PointsTag, Sheet, PicksTable, …
lib/                engine.ts (scoring/status), i18n.ts, supabase.ts, data.tsx,
                    providers.tsx, theme.ts, types.ts
supabase/
  migrations/       schema · RLS · score_game + trigger · RPCs · realtime · cron
  tests/            pgTAP: 12 golden scoring cases + RLS negative paths
  seed/             seed.ts (API-Football, production) · seed-dev.sql (local states)
  functions/
    sync-results/   cron-driven results sync (frugal: free tier 100 req/day)
```

## Local development

Prereqs: Node 22+, Docker, Xcode and/or Android Studio for simulators.

```bash
npm install
npx supabase start            # local stack (API :54421, DB :54422, Studio :54423, Mailpit :54424)
npx supabase db reset         # apply migrations
docker exec -i $(docker ps --format '{{.Names}}' | grep supabase_db_quiniela) \
  psql -U postgres -d postgres < supabase/seed/seed-dev.sql   # dev fixtures
cp .env.example .env          # fill EXPO_PUBLIC_SUPABASE_URL/ANON_KEY from `npx supabase status`
npm run ios                   # or: npm run android / npm start
```

The dev seed makes **every match-card state reachable** (final exact/partial/
miss, awaiting, live, urgent unpicked, upcoming, postponed, void, KO draw with
advancer) and creates 7 members with picks. All seeded users sign in with the
OTP flow (Mailpit catches the codes) — the admin is `palv2602@gmail.com`.

## Tests

```bash
npm run typecheck         # tsc strict
npm run lint              # expo lint
npm test                  # vitest — engine golden table (§5 of the brief) + edges
npx supabase test db      # pgTAP — same 12 golden cases in SQL + RLS proofs
```

The 12 golden scoring cases pass in **both** TypeScript and SQL. The pgTAP
suite also proves the product's integrity layer: picks rejected after kickoff,
no cross-user reads before kickoff (reveal after), `points`/`tag` not writable
by clients, membership-gated visibility, and non-admin RPC rejections.

## Production setup (one-time)

1. **Supabase project** — `supabase link`, `supabase db push`, then deploy the
   sync function: `supabase functions deploy sync-results --no-verify-jwt` and
   set secrets (`API_FOOTBALL_KEY`, `API_FOOTBALL_LEAGUE_ID`). Store
   `project_url` + `service_role_key` in Vault so the pg_cron job activates —
   see [`supabase/functions/sync-results/README.md`](supabase/functions/sync-results/README.md).
2. **Auth email** — configure Resend SMTP in dashboard Auth settings and make
   the Magic Link template deliver `{{ .Token }}` (the app consumes 6-digit
   codes, not links).
3. **Seed fixtures** — `npx tsx supabase/seed/seed.ts` with the env vars in
   [`supabase/seed/README.md`](supabase/seed/README.md). Never hand-written:
   fixtures come from API-Football.
4. **Builds** — `eas build --profile preview` (TestFlight internal / Play
   internal). Bundle ids: `com.pablo.quiniela`.
