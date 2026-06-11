# sync-results — Edge Function

Scheduled every 10 minutes via pg_cron + pg_net. Fetches match results from
football-data.org (v4) and writes provisional scores, auto-confirms stale
provisionals, and locks pool scoring when the first game with guesses has
kicked off.

---

## Environment variables

| Variable | Where set | Purpose |
|---|---|---|
| `SUPABASE_URL` | Auto-injected by runtime | Project API URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Auto-injected by runtime | Bypasses RLS (DB access); auth-bearer fallback on the local stack |
| `CRON_SECRET` | Supabase Function secrets | Dedicated bearer the cron caller sends (`openssl rand -hex 32`); the same value is stored in Vault under the name `service_role_key` |
| `FOOTBALL_DATA_TOKEN` | Supabase Function secrets | football-data.org API token (`X-Auth-Token` header) |
| `FOOTBALL_DATA_COMPETITION` | Supabase Function secrets | Competition code or id (optional — defaults to `WC`, the FIFA World Cup) |

### Setting secrets (remote)

```bash
supabase secrets set CRON_SECRET=$(openssl rand -hex 32)   # keep a copy for Vault below
supabase secrets set FOOTBALL_DATA_TOKEN=your_token_here
supabase secrets set FOOTBALL_DATA_COMPETITION=WC
```

Why a dedicated `CRON_SECRET`: on new-generation Supabase projects the
auto-injected `SUPABASE_SERVICE_ROLE_KEY` doesn't match the dashboard's legacy
service-role JWT, and `sb_secret_…` keys sent as a bearer are intercepted by
the functions gateway — so the cron caller and the function share a minted
secret instead. On the local stack `CRON_SECRET` is unset and the function
falls back to comparing against the local service role key.

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

-- Store the cron bearer. The Vault name 'service_role_key' is what migration
-- 0009 looks up — the VALUE is the minted CRON_SECRET, not the platform key.
select vault.create_secret(
  '<your-CRON_SECRET-value>',
  'service_role_key'
);
```

The cron migration (`0009_cron_sync.sql`) will no-op on the local stack and on
any remote project where these secrets have not yet been set. **If `db push`
ran before the Vault secrets existed, the cron job was never scheduled** — re-run
the body of `0009_cron_sync.sql` in the SQL Editor after creating the secrets
(it is idempotent), then verify with the `cron.job` query below.

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

# Remote (replace <ref> and <CRON_SECRET>)
curl -i -X POST \
  "https://<ref>.supabase.co/functions/v1/sync-results" \
  -H "Authorization: Bearer <CRON_SECRET>" \
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

When games are in window but `FOOTBALL_DATA_TOKEN` is not set (safe fallback):

```json
{
  "message": "Games in window but missing env vars: FOOTBALL_DATA_TOKEN — skipping API call",
  "stats": { ... }
}
```

---

## Frugality (free-tier API: 10 req/min)

football-data.org's free tier allows **10 requests/minute** with no daily cap,
so quota pressure is low. The function still gates the API call as hygiene: a
call is made **only** when at least one non-voided game has a kickoff within:

```
[now() - 4 hours,  now() + 5 minutes]
```

Outside of match days this means zero API calls. On heavy match days (multiple
overlapping windows) the call is still exactly **one** request per 10-minute
cron tick where the gate passes — far below the per-minute limit.

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
