create table if not exists public.error_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  level text not null default 'error',
  source text not null,
  message text not null,
  stack text,
  context jsonb not null default '{}'::jsonb,
  path text,
  method text,
  session_id uuid,
  salon_id uuid,
  client_identifier text,
  user_agent text,
  runtime text
);

create index if not exists error_logs_created_at_idx
  on public.error_logs (created_at desc);

create index if not exists error_logs_source_idx
  on public.error_logs (source);

create index if not exists error_logs_salon_id_idx
  on public.error_logs (salon_id);

create index if not exists error_logs_session_id_idx
  on public.error_logs (session_id);
