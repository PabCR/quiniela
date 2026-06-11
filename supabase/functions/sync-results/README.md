# sync-results — Edge Function

Scheduled every 10 minutes via pg_cron + pg_net. Fetches fixture results from
API-Football and writes provisional scores, auto-confirms stale provisionals,
and locks pool scoring when the first game with guesses has kicked off.

---

## Environment variables

| Variable | Where set | Purpose |
|---|---|---|
| `SUPABASE_URL` | Auto-injected by runtime | Project API URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Auto-injected by runtime | Bypasses RLS; also used as the auth bearer the cron caller sends |
| `API_FOOTBALL_KEY` | Supabase Function secrets | `x-apisports-key` header value |
| `API_FOOTBALL_LEAGUE_ID` | Supabase Function secrets | Numeric league id for WC 2026 (e.g. `"1"`) |

### Setting secrets (remote)

```bash
supabase secrets set API_FOOTBALL_KEY=your_key_here
supabase secrets set API_FOOTBALL_LEAGUE_ID=1
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are auto-injected — do not set
them manually.

---

## Deploy

```bash
# From the repo root:
supabase functions deploy sync-results --no-verify-jwt
```

`verify_jwt = false` is required because this function performs its own auth
check (compares the Bearer token against the service role key). Add to
`supabase/config.toml`:

```toml
[functions.sync-results]
verify_jwt = false
```

---

## One-time Vault setup (remote project)

Run once in the Supabase SQL Editor after deploying:

```sql
-- Store project URL (replace with your actual project ref)
select vault.create_secret(
  'https://<your-project-ref>.supabase.co',
  'project_url'
);

-- Store the service role key
select vault.create_secret(
  '<your-service-role-jwt>',
  'service_role_key'
);
```

The cron migration (`0009_cron_sync.sql`) will no-op on the local stack and on
any remote project where these secrets have not yet been set.

---

## Schedule

The cron job is set up by migration `0009_cron_sync.sql`:

- Schedule: `*/10 * * * *` (every 10 minutes)
- Job name: `sync-results-every-10-min`
- Caller: `pg_cron` → `pg_net.http_post` → this function

### Check the cron job

```sql
select * from cron.job where jobname = 'sync-results-every-10-min';
```

### Check recent invocations

```sql
select * from cron.job_run_details
where jobid = (select jobid from cron.job where jobname = 'sync-results-every-10-min')
order by start_time desc
limit 20;
```

---

## Manual invoke (curl)

```bash
# Local stack
curl -i -X POST \
  "http://127.0.0.1:54421/functions/v1/sync-results" \
  -H "Authorization: Bearer sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz" \
  -H "Content-Type: application/json" \
  -d '{}'

# Remote (replace <ref> and <service-role-key>)
curl -i -X POST \
  "https://<ref>.supabase.co/functions/v1/sync-results" \
  -H "Authorization: Bearer <service-role-key>" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Expected response when no games are in the active window (frugality gate):

```json
{
  "message": "No games in active window — API call skipped",
  "stats": { "apiCalls": 0, "kickoffUpdated": 0, "provisional": 0, "skipped": 0, "autoConfirmed": 0, "poolsLocked": 0, "errors": [] }
}
```

When games are in window but `API_FOOTBALL_KEY` is not set (safe fallback):

```json
{
  "message": "Games in window but missing env vars: API_FOOTBALL_KEY — skipping API call",
  "stats": { ... }
}
```

---

## Frugality (free-tier API: 100 req/day)

The function gates the API-Football call. A call is made **only** when at least
one non-voided game has a kickoff within:

```
[now() - 4 hours,  now() + 5 minutes]
```

Outside of match days this means zero API calls. On heavy match days (multiple
overlapping windows) the call is still exactly **one** request per 10-minute
cron tick where the gate passes.

The local maintenance steps (auto-confirm + pool locking) always run regardless
of whether the frugality gate passes.

---

## Email (Resend SMTP)

Transactional auth emails (OTP codes) are sent by Supabase Auth using Resend as
the SMTP provider. Configure in the Supabase dashboard:

- **Dashboard → Project Settings → Authentication → SMTP Settings**
- Host: `smtp.resend.com`, Port: `465`, Username: `resend`, Password: `<RESEND_API_KEY>`
- Sender name / address: configure as desired

No code changes are needed — this is pure infrastructure configuration.
