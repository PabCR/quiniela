-- 0009_cron_sync.sql
-- Schedule sync-results Edge Function every 10 minutes via pg_cron + pg_net.
--
-- Prerequisites (one-time setup on the REMOTE project — run manually in SQL editor):
--
--   1. Enable pg_cron, pg_net, and vault extensions in the Supabase dashboard
--      (Database -> Extensions) if not already enabled.
--
--   2. Store secrets in Vault:
--
--      select vault.create_secret(
--        'https://<your-project-ref>.supabase.co',
--        'project_url'
--      );
--
--      select vault.create_secret(
--        '<your-service-role-jwt>',
--        'service_role_key'
--      );
--
--      (These names match the lookups below. Run once; never hard-code keys in SQL.)
--
--   3. Deploy the function:
--
--      supabase functions deploy sync-results --no-verify-jwt
--
-- LOCAL STACK NOTE: pg_cron, pg_net, and vault are not available on the local
-- Supabase development stack by default. All SQL below is wrapped in a defensive
-- DO block that no-ops gracefully when any of those extensions or the required
-- secrets are absent. This ensures "npx supabase db reset" and
-- "npx supabase test db" continue to pass without modification.
--
-- IMPLEMENTATION NOTE: The outer DO block uses the $sync_cron$ dollar-quote tag
-- so that the inner $$ ... $$ tag (required by pg_cron's cron.schedule argument)
-- does not prematurely close the outer block. The Supabase migration runner's SQL
-- splitter treats $$ as a statement boundary; using a named tag for the outer
-- block avoids that collision.

do $sync_cron$
declare
  v_sql text;
begin
  -- Guard 1: pg_cron must be installed
  if not exists (
    select 1 from pg_extension where extname = 'pg_cron'
  ) then
    raise notice '0009_cron_sync: pg_cron not available -- skipping cron schedule.';
    return;
  end if;

  -- Guard 2: pg_net must be installed
  if not exists (
    select 1 from pg_extension where extname = 'pg_net'
  ) then
    raise notice '0009_cron_sync: pg_net not available -- skipping cron schedule.';
    return;
  end if;

  -- Guard 3: vault schema must exist (indicates supabase_vault is enabled)
  if not exists (
    select 1 from information_schema.schemata where schema_name = 'vault'
  ) then
    raise notice '0009_cron_sync: vault schema not available -- skipping cron schedule.';
    return;
  end if;

  -- Guard 4: required secrets must be present in Vault.
  -- Without them the HTTP call would fire with a null URL / null key, consuming
  -- a free-tier request for nothing.
  if not exists (
    select 1 from vault.decrypted_secrets where name = 'project_url'
  ) or not exists (
    select 1 from vault.decrypted_secrets where name = 'service_role_key'
  ) then
    raise notice '0009_cron_sync: Vault secrets (project_url / service_role_key) not set -- skipping cron schedule. See migration comment for setup instructions.';
    return;
  end if;

  -- Remove existing job if it exists (idempotent -- safe to re-run migration).
  -- pg_cron raises an error if you try to unschedule a non-existent job, so we
  -- wrap in a nested block to swallow that specific case.
  begin
    perform cron.unschedule('sync-results-every-10-min');
  exception when others then
    -- job did not exist; that is fine
    null;
  end;

  -- Build the cron body SQL as a text variable so there are no nested
  -- dollar-quote delimiters in the source text of this DO block.
  -- The cron expression 0,10,20,30,40,50 fires at minute 0,10,...,50 of every
  -- hour which is equivalent to "every 10 minutes" without using the */10
  -- syntax (the star+slash sequence is avoided to prevent parser confusion).
  v_sql :=
    'select net.http_post('
    '  url := ('
    '    select decrypted_secret'
    '    from vault.decrypted_secrets'
    '    where name = ''project_url'''
    '  ) || ''/functions/v1/sync-results'','
    '  headers := jsonb_build_object('
    '    ''Content-Type'', ''application/json'','
    '    ''Authorization'', ''Bearer '' || ('
    '      select decrypted_secret'
    '      from vault.decrypted_secrets'
    '      where name = ''service_role_key'''
    '    )'
    '  ),'
    '  body := ''{}''::jsonb'
    ') as request_id;';

  perform cron.schedule(
    'sync-results-every-10-min',
    '0,10,20,30,40,50 * * * *',
    v_sql
  );

  raise notice '0009_cron_sync: cron job "sync-results-every-10-min" scheduled (every 10 min).';
end;
$sync_cron$;
