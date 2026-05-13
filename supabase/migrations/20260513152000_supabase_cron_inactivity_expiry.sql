-- Expire inactive sessions internally via Supabase cron (no outbound SMS).

create extension if not exists pg_cron with schema extensions;

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

grant execute on function public.expire_inactive_sessions_and_holds() to authenticated, service_role;

do $$
declare
  existing_job_id bigint;
begin
  select jobid
    into existing_job_id
    from cron.job
   where jobname = 'expire-inactive-sessions-every-minute'
   limit 1;

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  perform cron.schedule(
    'expire-inactive-sessions-every-minute',
    '* * * * *',
    $job$select public.expire_inactive_sessions_and_holds();$job$
  );
end;
$$;
