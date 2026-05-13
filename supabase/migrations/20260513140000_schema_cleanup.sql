-- Schema cleanup: fix missing columns/tables and drop unused tables.

-- 1. sessions: add missing updated_at (code calls .update({ updated_at: ... }) in several places)
alter table public.sessions
  add column if not exists updated_at timestamptz not null default now();

-- 2. sessions: add missing summary column (dashboard queries select it)
alter table public.sessions
  add column if not exists summary text;

-- 3. sessions: widen status to include 'review'
--    Code queries .in('status', ['active', 'review', 'handed_over']) but the constraint excluded 'review'.
alter table public.sessions
  drop constraint if exists sessions_status_check;

alter table public.sessions
  add constraint sessions_status_check
    check (status in ('active', 'review', 'completed', 'handed_over'));

-- 4. Create transcripts-sophia-sandbox table.
--    Prior migrations added columns to it (t, param) but the table itself was never created.
--    lib/sophia-sandbox.ts writes all test-UI conversation data here.
create table if not exists public."transcripts-sophia-sandbox" (
  id uuid default gen_random_uuid() primary key,
  session_id uuid not null references public.sessions(id) on delete cascade,
  created_at timestamptz not null default now(),
  role text not null check (role in ('system', 'assistant', 'user', 'draft')),
  content text not null,
  t text,
  param text
);

create index if not exists idx_sophia_sandbox_transcripts_session_created
  on public."transcripts-sophia-sandbox" (session_id, created_at);

create index if not exists idx_sophia_sandbox_transcripts_role
  on public."transcripts-sophia-sandbox" (role);

alter table public."transcripts-sophia-sandbox" enable row level security;

drop policy if exists "Service role access on transcripts-sophia-sandbox" on public."transcripts-sophia-sandbox";
create policy "Service role access on transcripts-sophia-sandbox"
  on public."transcripts-sophia-sandbox"
  using (true);

-- 5. Create workers table.
--    lib/booking_service.ts and lib/tool-handler.ts query: id, name, cal_event_type_id, services, salon_id, is_active.
create table if not exists public.workers (
  id uuid default gen_random_uuid() primary key,
  created_at timestamptz not null default now(),
  salon_id uuid references public.business_profiles(id) on delete cascade,
  name text not null,
  role text,
  cal_event_type_id integer,
  services text[] not null default '{}',
  is_active boolean not null default true
);

create index if not exists workers_salon_id_idx on public.workers(salon_id);

alter table public.workers enable row level security;
create policy "Service role access" on public.workers using (true);

-- Unused tables identified (not dropped yet, pending confirmation):
--   transcripts-test-ui       -- superseded by transcripts-sophia-sandbox, zero code references
--   1_workers                 -- new multi-tenant schema, not yet wired up
--   1_services                -- new multi-tenant schema, not yet wired up
--   1_worker_services         -- new multi-tenant schema, not yet wired up
--   1_faqs                    -- new multi-tenant schema, not yet wired up
--   1_sessions                -- new multi-tenant schema, not yet wired up
--   1_messages                -- new multi-tenant schema, not yet wired up
--   1_bookings                -- new multi-tenant schema, not yet wired up
--   1_logs                    -- new multi-tenant schema, not yet wired up
--   1_billing                 -- new multi-tenant schema, not yet wired up
