-- Store the source channel per transcript row so mixed-medium conversations can
-- show exactly which turns happened over voice, SMS, WhatsApp, or dashboard/test.

alter table public.transcripts
  add column if not exists channel text;

alter table public.transcripts
  drop constraint if exists transcripts_channel_check;

alter table public.transcripts
  add constraint transcripts_channel_check
    check (channel is null or channel in ('sms', 'whatsapp', 'voice', 'webchat', 'test', 'sandbox'));

create index if not exists transcripts_session_channel_created_idx
  on public.transcripts (session_id, channel, created_at);

update public.transcripts t
set channel = s.channel
from public.sessions s
where t.session_id = s.id
  and t.channel is null
  and s.channel in ('sms', 'whatsapp', 'voice', 'webchat');
