alter table public.transcripts
  add column if not exists twilio_message_sid text,
  add column if not exists sms_direction text check (sms_direction in ('inbound', 'outbound')),
  add column if not exists sms_status text,
  add column if not exists sms_price numeric,
  add column if not exists sms_price_unit text,
  add column if not exists sms_error_code text,
  add column if not exists sms_error_message text,
  add column if not exists sms_num_segments integer,
  add column if not exists sms_from_number text,
  add column if not exists sms_to_number text,
  add column if not exists sms_updated_at timestamptz;

create unique index if not exists transcripts_twilio_message_sid_key
  on public.transcripts(twilio_message_sid)
  where twilio_message_sid is not null;

create index if not exists transcripts_sms_updated_at_idx
  on public.transcripts(sms_updated_at);

drop table if exists public.sms_message_fees;
