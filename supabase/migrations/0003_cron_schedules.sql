-- ============================================================================
-- 0003_cron_schedules.sql — Daily schedules for the maintenance/notification
-- Edge Functions, using pg_cron + pg_net (the same mechanism the Supabase
-- dashboard "Schedule" toggle creates).
--
-- Both functions are deployed with verify_jwt = false, so no Authorization
-- header is needed (and no secret lands in this file).
-- Re-running is safe: cron.schedule upserts by job name.
-- ============================================================================

-- Enable the required extensions (idempotent).
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'app-scadenza-mark-expired',
  '20 6 * * *',
  $$
  select net.http_post(
    url := 'https://irpazhimrzitqxswjjde.supabase.co/functions/v1/mark-expired',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := '{}'::jsonb
  ) as request_id;
  $$
);

select cron.schedule(
  'app-scadenza-notify-expiring',
  '0 6 * * *',
  $$
  select net.http_post(
    url := 'https://irpazhimrzitqxswjjde.supabase.co/functions/v1/notify-expiring',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := '{}'::jsonb
  ) as request_id;
  $$
);