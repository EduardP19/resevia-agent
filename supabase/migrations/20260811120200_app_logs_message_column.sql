-- Separate `event` (stable machine name, groupable) from `message` (human /
-- error detail, unique per occurrence).
--
-- Without this, error rows have to put the exception text in `event`, which
-- makes "how many times did this fail" unanswerable — every occurrence looks
-- like a distinct event. That is what the old error_logs table did.

alter table public.app_logs
  add column if not exists message text;

-- Backfilled rows from system_logs / error_logs carry their message text in
-- `event` (those tables had no separate event name). Mirror it into `message`
-- so error queries read the same column for old and new rows alike.
update public.app_logs
   set message = event
 where message is null
   and metadata->>'_backfilled_from' in ('system_logs', 'error_logs');

comment on column public.app_logs.event is
  'Stable machine name for grouping, e.g. sms_send_failed. Not the error text.';
comment on column public.app_logs.message is
  'Human-readable detail or exception message for this specific occurrence.';
