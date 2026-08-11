-- Drop the three legacy app-side log tables, now superseded by app_logs.
--
-- All 2,677 rows were copied across by 20260811120100_app_logs_backfill.sql and
-- verified before this ran. No code references any of them: lib/error-logger.ts
-- was deleted and every call site now goes through lib/logger.ts.
--
-- Not touched here:
--   public.logs           — marketing site analytics (resevia.co.uk), owned and
--                           written by a separate codebase. Actively used.
--   public.app_error_logs — already absent from the remote; the code wrote to it
--                           for months without noticing because supabase-js
--                           returns errors rather than throwing, and the result
--                           was discarded. That write is gone.

-- Guard: refuse to drop unless the backfill actually landed. A silently empty
-- app_logs plus a hard drop would lose the history outright.
do $$
declare
  backfilled bigint;
begin
  select count(*) into backfilled
  from public.app_logs
  where metadata->>'_backfilled_from' in ('event_logs', 'system_logs', 'error_logs');

  if backfilled < 2677 then
    raise exception
      'Refusing to drop legacy log tables: expected >= 2677 backfilled rows in app_logs, found %.',
      backfilled;
  end if;
end $$;

drop table if exists public.event_logs;
drop table if exists public.system_logs;
drop table if exists public.error_logs;
