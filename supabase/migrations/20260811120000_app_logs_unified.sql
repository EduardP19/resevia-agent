-- Unified application log table.
--
-- Replaces event_logs + system_logs + error_logs, which split logs by severity
-- (an axis nothing ever read back) and duplicated the same dashboard clickstream
-- across two of them. The axis that matters is `type` — what kind of thing
-- happened — with `category` as the subsystem sub-axis.
--
-- Deliberately NO check constraints on type/category/source: the old
-- system_logs.source enum needed two separate migrations (20260512133000,
-- 20260513120000) purely to widen it. Plain text + indexes instead.
--
-- Website analytics live in public.logs and are owned by the marketing site.
-- This table is app-side only and must not absorb them.

create table if not exists public.app_logs (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),

  -- Primary axis. One of: error | timeout | interaction | integration | job | audit
  type        text not null,
  -- Subsystem. One of: sms | ai | tool | session | dashboard | auth | billing | observer | system
  category    text not null,
  level       text not null default 'info',
  -- Event name (interaction/audit/job) or error message (error/timeout).
  event       text not null,
  -- Origin identifier, e.g. 'lib.twilio.sendSMS', 'api.twilio.voice'.
  source      text,

  tenant_id   uuid references public.business_profiles(id) on delete set null,
  session_id  uuid references public.sessions(id) on delete set null,

  -- Correlates every row emitted while handling one inbound message / request,
  -- so a full conversation turn can be reconstructed in order.
  request_id  text,
  -- Elapsed time for integration/timeout rows. Null elsewhere.
  duration_ms integer,

  environment text,
  runtime     text,
  path        text,
  method      text,
  stack       text,
  metadata    jsonb not null default '{}'::jsonb,

  constraint app_logs_metadata_object_check
    check (jsonb_typeof(metadata) = 'object')
);

create index if not exists app_logs_created_at_idx  on public.app_logs (created_at desc);
create index if not exists app_logs_type_idx        on public.app_logs (type, created_at desc);
create index if not exists app_logs_category_idx    on public.app_logs (category, created_at desc);
create index if not exists app_logs_level_idx       on public.app_logs (level, created_at desc);
create index if not exists app_logs_tenant_id_idx   on public.app_logs (tenant_id, created_at desc);
create index if not exists app_logs_session_id_idx  on public.app_logs (session_id);
create index if not exists app_logs_request_id_idx  on public.app_logs (request_id);
create index if not exists app_logs_source_idx      on public.app_logs (source);

-- Partial index for the two things we actually watch for.
create index if not exists app_logs_problems_idx
  on public.app_logs (created_at desc)
  where type in ('error', 'timeout');

alter table public.app_logs enable row level security;

drop policy if exists "Service role access on app_logs" on public.app_logs;
create policy "Service role access on app_logs"
  on public.app_logs
  using (true);

comment on table public.app_logs is
  'Unified app-side log. type = error|timeout|interaction|integration|job|audit. Website analytics belong in public.logs, not here.';
