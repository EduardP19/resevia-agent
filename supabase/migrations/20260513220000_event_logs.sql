create table if not exists public.event_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  level text not null default 'info',
  category text not null,
  event text not null,
  tenant_id uuid references public.business_profiles(id) on delete set null,
  session_id uuid references public.sessions(id) on delete set null,
  environment text,
  metadata jsonb not null default '{}'::jsonb,
  constraint event_logs_level_check
    check (level in ('info', 'warning', 'error')),
  constraint event_logs_metadata_object_check
    check (jsonb_typeof(metadata) = 'object')
);

create index if not exists event_logs_created_at_idx on public.event_logs (created_at desc);
create index if not exists event_logs_level_idx on public.event_logs (level);
create index if not exists event_logs_category_idx on public.event_logs (category);
create index if not exists event_logs_tenant_id_idx on public.event_logs (tenant_id);
create index if not exists event_logs_session_id_idx on public.event_logs (session_id);

alter table public.event_logs enable row level security;

drop policy if exists "Service role access on event_logs" on public.event_logs;
create policy "Service role access on event_logs"
  on public.event_logs
  using (true);
