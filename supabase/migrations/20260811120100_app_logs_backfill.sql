-- Backfill event_logs + system_logs + error_logs into app_logs.
--
-- Historical rows predate the `type` axis, so type is inferred from level,
-- event name and category. Inference is best-effort by nature; every row keeps
-- its origin table in metadata._backfilled_from so it can be re-derived later.
--
-- tenant_id / session_id are resolved through a lookup rather than copied
-- directly: the old error_logs / system_logs had no foreign keys, so they can
-- hold ids whose parent row has since been deleted. The subselect yields null
-- for those instead of failing the migration on an FK violation.

-- 1. event_logs -------------------------------------------------------------
insert into public.app_logs (
  created_at, type, category, level, event, source,
  tenant_id, session_id, environment, runtime, path, stack, metadata
)
select
  e.created_at,
  case
    when e.level in ('error', 'critical')                then 'error'
    when e.event ~* '(timeout|timed_out|deadline)'       then 'timeout'
    when e.event ~* '(_failed|_error)$'                  then 'error'
    when e.category = 'dashboard'                        then 'interaction'
    when e.category = 'auth'                             then 'audit'
    when e.category in ('ai', 'sms', 'tool')             then 'integration'
    else 'audit'
  end,
  coalesce(nullif(e.category, ''), 'system'),
  e.level,
  e.event,
  nullif(e.metadata->>'source', ''),
  (select bp.id from public.business_profiles bp where bp.id = e.tenant_id),
  (select s.id  from public.sessions s          where s.id  = e.session_id),
  e.environment,
  coalesce(nullif(e.metadata->>'runtime', ''), 'server'),
  nullif(e.metadata->>'path', ''),
  nullif(e.metadata->>'stack', ''),
  coalesce(e.metadata, '{}'::jsonb) || jsonb_build_object('_backfilled_from', 'event_logs')
from public.event_logs e;

-- 2. system_logs ------------------------------------------------------------
insert into public.app_logs (
  created_at, type, category, level, event, source,
  tenant_id, session_id, runtime, path, method, stack, metadata
)
select
  s.created_at,
  case
    when s.level in ('error', 'critical')                then 'error'
    when s.message ~* '(timeout|timed_out|deadline)'     then 'timeout'
    when s.source = 'dashboard_event'                    then 'interaction'
    when s.source = 'cron'                               then 'job'
    when s.source in ('auth', 'billing')                 then 'audit'
    else 'integration'
  end,
  coalesce(nullif(s.metadata->>'category', ''), 'system'),
  -- system_logs allowed 'critical'; app_logs standardises on error.
  case when s.level = 'critical' then 'error' else s.level end,
  s.message,
  coalesce(nullif(s.metadata->>'original_source', ''), s.source),
  (select bp.id from public.business_profiles bp where bp.id = s.tenant_id),
  (select se.id from public.sessions se         where se.id = s.session_id),
  coalesce(nullif(s.metadata->>'runtime', ''), 'server'),
  nullif(s.metadata->>'path', ''),
  nullif(s.metadata->>'method', ''),
  nullif(s.metadata->>'stack', ''),
  coalesce(s.metadata, '{}'::jsonb)
    || jsonb_build_object('_backfilled_from', 'system_logs', '_legacy_level', s.level)
from public.system_logs s;

-- 3. error_logs -------------------------------------------------------------
insert into public.app_logs (
  created_at, type, category, level, event, source,
  tenant_id, session_id, runtime, path, method, stack, metadata
)
select
  l.created_at,
  case when l.message ~* '(timeout|timed_out|deadline)' then 'timeout' else 'error' end,
  'system',
  case when l.level = 'warn' then 'warning' else l.level end,
  l.message,
  l.source,
  (select bp.id from public.business_profiles bp where bp.id = l.salon_id),
  (select se.id from public.sessions se         where se.id = l.session_id),
  coalesce(nullif(l.runtime, ''), 'server'),
  l.path,
  l.method,
  l.stack,
  jsonb_build_object(
    '_backfilled_from', 'error_logs',
    'context',           coalesce(l.context, '{}'::jsonb),
    'client_identifier', l.client_identifier,
    'user_agent',        l.user_agent
  )
from public.error_logs l;
