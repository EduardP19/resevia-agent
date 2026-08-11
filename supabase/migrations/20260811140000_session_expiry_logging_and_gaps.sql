-- Make session expiry visible in app_logs, and close two gaps that left
-- sessions stranded forever.
--
-- Context: session expiry does NOT run through /api/cron/cleanup. It runs as a
-- pg_cron job ('expire-inactive-sessions-every-minute', scheduled in
-- 20260513152000) calling this function directly in Postgres. That path never
-- touched app_logs, so 1,440 runs a day were completely invisible — the Vercel
-- route that *is* instrumented has no schedule behind it.
--
-- Gaps being fixed:
--   1. `updated_at > now() - interval '48 hours'` meant any session that stayed
--      active for more than 48h could never be expired by this job. It fell out
--      of the window and stayed active permanently.
--   2. status 'needs_approval' was never expired at all. Four sessions created
--      in May 2026 were still sitting in that state three months later, because
--      a draft nobody approves has nothing else to move it along.

create or replace function public.expire_inactive_sessions_and_holds()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  started_at             timestamptz := clock_timestamp();
  now_iso                text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  -- Overridable per-database with: alter database <db> set app.<name> = '<n>';
  inactivity_minutes     integer := coalesce(nullif(current_setting('app.session_inactivity_minutes', true), '')::integer, 5);
  approval_stale_days    integer := coalesce(nullif(current_setting('app.approval_stale_days', true), '')::integer, 7);
  expired_count          integer := 0;
  approval_expired_count integer := 0;
  holds_expired_count    integer := 0;
  expired_by_tenant      jsonb := '{}'::jsonb;
  approval_by_tenant     jsonb := '{}'::jsonb;
  elapsed_ms             integer;
begin
  -- 1. Conversations idle past the inactivity window.
  --    The 48h upper bound is deliberately gone; it stranded anything older.
  with updated as (
    update public.sessions
       set status = 'completed',
           updated_at = now(),
           metadata = coalesce(metadata, '{}'::jsonb)
             || jsonb_build_object('expired_at', now_iso, 'expired_by', 'cron-inactivity')
     where status in ('active', 'review')
       and updated_at < now() - make_interval(mins => inactivity_minutes)
       and coalesce(metadata->>'expired_at', '') = ''
       and coalesce(metadata->>'source', '') <> 'sophia-sandbox'
    returning salon_id
  ),
  agg as (
    select salon_id, count(*)::int as n from updated group by salon_id
  )
  select coalesce(sum(n), 0)::int,
         coalesce(jsonb_object_agg(salon_id, n) filter (where salon_id is not null), '{}'::jsonb)
    into expired_count, expired_by_tenant
    from agg;

  -- 2. Drafts left awaiting owner approval well past the point of usefulness.
  --    Marked 'expired' rather than 'completed' so they stay distinguishable
  --    from conversations that ran their course.
  with updated as (
    update public.sessions
       set status = 'expired',
           updated_at = now(),
           metadata = coalesce(metadata, '{}'::jsonb)
             || jsonb_build_object('expired_at', now_iso, 'expired_by', 'cron-stale-approval')
     where status = 'needs_approval'
       and updated_at < now() - make_interval(days => approval_stale_days)
       and coalesce(metadata->>'expired_at', '') = ''
       and coalesce(metadata->>'source', '') <> 'sophia-sandbox'
    returning salon_id
  ),
  agg as (
    select salon_id, count(*)::int as n from updated group by salon_id
  )
  select coalesce(sum(n), 0)::int,
         coalesce(jsonb_object_agg(salon_id, n) filter (where salon_id is not null), '{}'::jsonb)
    into approval_expired_count, approval_by_tenant
    from agg;

  -- 3. Held booking slots past their expiry.
  update public.bookings
     set status = 'expired'
   where status = 'held'
     and expires_at < now();

  get diagnostics holds_expired_count = row_count;

  elapsed_ms := (extract(epoch from (clock_timestamp() - started_at)) * 1000)::integer;

  -- Per-tenant rows, so expiry is attributable rather than a global number.
  -- tenant_id goes through a lookup because app_logs.tenant_id is a real FK and
  -- a session could outlive its business_profile.
  insert into public.app_logs (type, category, level, event, source, tenant_id, metadata)
  select 'job', 'session', 'info', 'sessions_expired',
         'db.expire_inactive_sessions_and_holds',
         (select bp.id from public.business_profiles bp where bp.id = t.key::uuid),
         jsonb_build_object('expired', t.value::int, 'reason', 'inactivity')
    from jsonb_each(expired_by_tenant) as t;

  insert into public.app_logs (type, category, level, event, source, tenant_id, metadata)
  select 'job', 'session', 'warning', 'stale_approvals_expired',
         'db.expire_inactive_sessions_and_holds',
         (select bp.id from public.business_profiles bp where bp.id = t.key::uuid),
         jsonb_build_object('expired', t.value::int, 'reason', 'stale_approval',
                            'stale_after_days', approval_stale_days)
    from jsonb_each(approval_by_tenant) as t;

  -- Run summary. This job fires every minute, so logging unconditionally would
  -- add ~43k empty rows a month. Log when it actually did something, plus a
  -- top-of-the-hour heartbeat so "is the cron alive?" stays answerable.
  if (expired_count + approval_expired_count + holds_expired_count) > 0
     or extract(minute from now()) = 0 then
    insert into public.app_logs (type, category, level, event, source, duration_ms, metadata)
    values (
      'job', 'session', 'info', 'session_expiry_run',
      'db.expire_inactive_sessions_and_holds',
      elapsed_ms,
      jsonb_build_object(
        'expired',             expired_count,
        'approval_expired',    approval_expired_count,
        'holds_expired',       holds_expired_count,
        'inactivity_minutes',  inactivity_minutes,
        'approval_stale_days', approval_stale_days,
        'tenants_affected',    (select count(*) from jsonb_each(expired_by_tenant))
      )
    );
  end if;

  return jsonb_build_object(
    'expired',         expired_count,
    'approvalExpired', approval_expired_count,
    'holdsExpired',    holds_expired_count,
    'durationMs',      elapsed_ms
  );
end;
$$;

grant execute on function public.expire_inactive_sessions_and_holds() to authenticated, service_role;
