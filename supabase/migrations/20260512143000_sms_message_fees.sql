create table if not exists public.sms_message_fees (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  session_id uuid references public.sessions(id) on delete set null,
  transcript_id uuid references public.transcripts(id) on delete set null,
  salon_id uuid references public.business_profiles(id) on delete set null,
  twilio_message_sid text not null unique,
  direction text not null check (direction in ('inbound', 'outbound')),
  from_number text,
  to_number text,
  status text,
  price numeric,
  price_unit text,
  error_code text,
  error_message text,
  segments integer,
  raw_payload jsonb not null default '{}'::jsonb
);

create index if not exists sms_message_fees_session_id_idx
  on public.sms_message_fees(session_id);

create index if not exists sms_message_fees_transcript_id_idx
  on public.sms_message_fees(transcript_id);

create index if not exists sms_message_fees_salon_id_idx
  on public.sms_message_fees(salon_id);

create index if not exists sms_message_fees_twilio_message_sid_idx
  on public.sms_message_fees(twilio_message_sid);

create index if not exists sms_message_fees_created_at_idx
  on public.sms_message_fees(created_at);

alter table public.sms_message_fees enable row level security;

create policy "Service role access" on public.sms_message_fees
  for all using (auth.role() = 'service_role');
