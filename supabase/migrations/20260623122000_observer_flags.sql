-- Observer / supervisor agent findings.
--
-- A lightweight observer watches live conversations and records anomalies here for review:
-- loops, confusion, off-topic drift, repeated/failed tool calls, plan-limit breaches, etc.

create table if not exists public.observer_flags (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  salon_id    uuid references public.business_profiles(id) on delete cascade,
  session_id  uuid references public.sessions(id) on delete cascade,
  flag_type   text not null,                      -- 'loop' | 'off_topic' | 'tool_failure' | 'tool_thrash' | 'confusion' | 'limit' | 'llm'
  severity    text not null default 'warning',    -- 'info' | 'warning' | 'critical'
  source      text not null default 'heuristic',  -- 'heuristic' | 'llm'
  detail      text,
  metadata    jsonb,
  resolved    boolean not null default false,
  resolved_at timestamptz,
  constraint observer_flags_severity_check check (severity in ('info', 'warning', 'critical'))
);

create index if not exists observer_flags_salon_id_idx   on public.observer_flags(salon_id);
create index if not exists observer_flags_session_id_idx  on public.observer_flags(session_id);
create index if not exists observer_flags_created_at_idx  on public.observer_flags(created_at);
create index if not exists observer_flags_unresolved_idx  on public.observer_flags(salon_id, resolved) where resolved = false;

alter table public.observer_flags enable row level security;
drop policy if exists "Service role access" on public.observer_flags;
create policy "Service role access" on public.observer_flags using (true);
