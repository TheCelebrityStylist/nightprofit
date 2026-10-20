-- Hourly call from the database to the app that sends due availability reminders.
-- The shared secret lives in Vault; the app checks it with cron_token_valid (service role only).
-- Skipped where pg_cron / pg_net / Vault are not available (local test database).
do $outer$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron')
     or not exists (select 1 from pg_available_extensions where name = 'pg_net')
     or not exists (select 1 from pg_namespace where nspname = 'vault') then
    raise notice 'reminder schedule skipped: pg_cron, pg_net or vault not available';
    return;
  end if;

  create extension if not exists pg_net;
  create extension if not exists pg_cron;

  if not exists (select 1 from vault.secrets where name = 'cliniq_cron_token') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'cliniq_cron_token', 'Shared secret for the hourly reminder call');
  end if;
  if not exists (select 1 from vault.secrets where name = 'cliniq_app_url') then
    perform vault.create_secret('https://nightprofit-two.vercel.app', 'cliniq_app_url', 'Public URL of the Cliniq Team app');
  end if;

  execute $fn$
    create or replace function public.cron_token_valid(candidate text) returns boolean
    language sql stable security definer set search_path = '' as $body$
      select length(coalesce(candidate, '')) = 64
        and exists (select 1 from vault.decrypted_secrets where name = 'cliniq_cron_token' and decrypted_secret = candidate)
    $body$
  $fn$;
  revoke execute on function public.cron_token_valid(text) from public, anon, authenticated;
  grant execute on function public.cron_token_valid(text) to service_role;

  perform cron.schedule(
    'cliniq-availability-reminders',
    '7 * * * *',
    $job$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'cliniq_app_url') || '/api/cron/reminders',
        headers := jsonb_build_object(
          'content-type', 'application/json',
          'authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cliniq_cron_token')
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 25000
      )
    $job$
  );
end
$outer$;
