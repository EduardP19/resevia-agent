-- Unify session statuses across the codebase.
--
-- Old values: active, review, completed, handed_over
-- New values: active, needs_approval, escalated, expired, completed
--
-- Mapping:
--   review      → needs_approval
--   handed_over → escalated
--   completed (with metadata.expired_at set) → expired

-- 1. Migrate existing data before changing the constraint
update public.sessions set status = 'needs_approval' where status = 'review';
update public.sessions set status = 'escalated'      where status = 'handed_over';
update public.sessions
  set status = 'expired'
  where status = 'completed'
    and coalesce(metadata->>'expired_at', '') <> '';

-- 2. Replace the status check constraint
alter table public.sessions
  drop constraint if exists sessions_status_check;

alter table public.sessions
  add constraint sessions_status_check
    check (status in ('active', 'needs_approval', 'escalated', 'expired', 'completed'));

-- 3. Update the inactivity cron to use new status values
create or replace function public.expire_inactive_sessions_and_holds()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  expired_count integer := 0;
  holds_expired_count integer := 0;
  now_iso text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  update public.sessions
  set
    status = 'expired',
    updated_at = now(),
    metadata = coalesce(metadata, '{}'::jsonb)
      || jsonb_build_object('expired_at', now_iso, 'expired_by', 'cron-inactivity')
  where status in ('active', 'needs_approval')
    and updated_at < now() - interval '5 minutes'
    and updated_at > now() - interval '48 hours'
    and coalesce(metadata->>'expired_at', '') = ''
    and coalesce(metadata->>'source', '') <> 'sophia-sandbox';

  get diagnostics expired_count = row_count;

  update public.bookings
  set status = 'expired'
  where status = 'held'
    and expires_at < now();

  get diagnostics holds_expired_count = row_count;

  return jsonb_build_object(
    'expired', expired_count,
    'holdsExpired', holds_expired_count
  );
end;
$$;

-- 4. Align 1_sessions constraint
alter table public."1_sessions"
  drop constraint if exists one_sessions_status_check;

alter table public."1_sessions"
  add constraint one_sessions_status_check
    check (status in ('active', 'needs_approval', 'escalated', 'expired', 'completed'));
