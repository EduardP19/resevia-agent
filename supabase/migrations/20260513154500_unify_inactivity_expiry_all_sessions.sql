-- Apply the same 5-minute inactivity expiry to all sessions, including Sophia Sandbox.

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
    status = 'completed',
    updated_at = now(),
    metadata = coalesce(metadata, '{}'::jsonb)
      || jsonb_build_object('expired_at', now_iso, 'expired_by', 'cron-inactivity')
  where status in ('active', 'review')
    and updated_at < now() - interval '5 minutes'
    and updated_at > now() - interval '48 hours'
    and coalesce(metadata->>'expired_at', '') = '';

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

grant execute on function public.expire_inactive_sessions_and_holds() to authenticated, service_role;
