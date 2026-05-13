create table if not exists public.sms_messages (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  session_id uuid references public.sessions(id) on delete set null,
  transcript_id uuid references public.transcripts(id) on delete set null,
  salon_id uuid references public.business_profiles(id) on delete set null,
  twilio_message_sid text not null unique,
  direction text check (direction in ('inbound', 'outbound')),
  from_number text,
  to_number text,
  status text,
  price numeric,
  price_unit text,
  error_code text,
  error_message text,
  num_segments integer,
  raw_payload jsonb not null default '{}'::jsonb,
  priced_at timestamptz,
  last_price_lookup_at timestamptz,
  price_lookup_attempts integer not null default 0
);

create index if not exists sms_messages_session_id_idx
  on public.sms_messages(session_id);

create index if not exists sms_messages_transcript_id_idx
  on public.sms_messages(transcript_id);

create index if not exists sms_messages_salon_id_idx
  on public.sms_messages(salon_id);

create index if not exists sms_messages_created_at_idx
  on public.sms_messages(created_at);

create index if not exists sms_messages_unpriced_idx
  on public.sms_messages(created_at)
  where price is null;

alter table public.sms_messages enable row level security;

drop policy if exists "Service role access" on public.sms_messages;
create policy "Service role access" on public.sms_messages
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

insert into public.sms_messages (
  session_id,
  transcript_id,
  salon_id,
  twilio_message_sid,
  direction,
  from_number,
  to_number,
  status,
  price,
  price_unit,
  error_code,
  error_message,
  num_segments,
  priced_at,
  updated_at
)
select
  t.session_id,
  t.id,
  s.salon_id,
  t.twilio_message_sid,
  t.sms_direction,
  t.sms_from_number,
  t.sms_to_number,
  t.sms_status,
  t.sms_price,
  t.sms_price_unit,
  t.sms_error_code,
  t.sms_error_message,
  t.sms_num_segments,
  case when t.sms_price is not null then coalesce(t.sms_updated_at, t.created_at) else null end,
  coalesce(t.sms_updated_at, now())
from public.transcripts t
left join public.sessions s on s.id = t.session_id
where t.twilio_message_sid is not null
on conflict (twilio_message_sid) do update set
  session_id = coalesce(public.sms_messages.session_id, excluded.session_id),
  transcript_id = coalesce(public.sms_messages.transcript_id, excluded.transcript_id),
  salon_id = coalesce(public.sms_messages.salon_id, excluded.salon_id),
  direction = coalesce(public.sms_messages.direction, excluded.direction),
  from_number = coalesce(public.sms_messages.from_number, excluded.from_number),
  to_number = coalesce(public.sms_messages.to_number, excluded.to_number),
  status = coalesce(public.sms_messages.status, excluded.status),
  price = coalesce(public.sms_messages.price, excluded.price),
  price_unit = coalesce(public.sms_messages.price_unit, excluded.price_unit),
  error_code = coalesce(public.sms_messages.error_code, excluded.error_code),
  error_message = coalesce(public.sms_messages.error_message, excluded.error_message),
  num_segments = coalesce(public.sms_messages.num_segments, excluded.num_segments),
  priced_at = coalesce(public.sms_messages.priced_at, excluded.priced_at),
  updated_at = now();
