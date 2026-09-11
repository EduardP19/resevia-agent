-- Record the customer's phone number (the number that called/texted/WhatsApp'd)
-- directly on each transcript row, so a transcript is attributable without a
-- join back to sessions.client_identifier.

alter table public.transcripts
  add column if not exists from_number text;

create index if not exists transcripts_from_number_idx
  on public.transcripts (from_number);

-- Backfill from the owning session's client_identifier — the customer's number
-- has been stable there since session creation.
update public.transcripts t
set from_number = s.client_identifier
from public.sessions s
where t.session_id = s.id
  and t.from_number is null
  and s.client_identifier is not null;
