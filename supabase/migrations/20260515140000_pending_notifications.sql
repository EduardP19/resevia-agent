-- Tracks owner email notifications that are delayed 60s.
-- A row is cancelled (deleted) if the session is viewed before send_after.
create table if not exists public.pending_notifications (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references public.sessions(id) on delete cascade,
  salon_id    uuid not null,
  status      text not null,
  client_phone text,
  send_after  timestamptz not null,
  created_at  timestamptz not null default now()
);

create index if not exists pending_notifications_session_id_idx on public.pending_notifications(session_id);
create index if not exists pending_notifications_send_after_idx on public.pending_notifications(send_after);
