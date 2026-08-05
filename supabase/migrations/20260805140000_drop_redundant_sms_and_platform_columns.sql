-- Remove columns whose data is fully duplicated elsewhere.
--
-- 1. transcripts.sms_* / twilio_message_sid
--    The sms_messages ledger (20260513130000) was created one day after these
--    columns and backfilled *from* them. Verified 1:1 duplication on live data
--    (44/44 SIDs, 6/6 prices, 17/17 price units, 0/0 error codes). Nothing reads
--    them: the status callback and inbound dedupe now look up sms_messages by
--    twilio_message_sid, and sms_messages.transcript_id preserves the link back
--    to the conversational content. Transcripts keep role/content only.
--
-- 2. sessions.platform
--    Legacy free-text stamp superseded by sessions.channel (authoritative per
--    CLAUDE.md). It had already drifted from channel on live rows
--    ('web' vs 'webchat', 21 vs 20 sms, 1 vs 2 whatsapp) and no code read it.

drop index if exists public.transcripts_twilio_message_sid_key;
drop index if exists public.transcripts_sms_updated_at_idx;

alter table public.transcripts
  drop column if exists twilio_message_sid,
  drop column if exists sms_direction,
  drop column if exists sms_status,
  drop column if exists sms_price,
  drop column if exists sms_price_unit,
  drop column if exists sms_error_code,
  drop column if exists sms_error_message,
  drop column if exists sms_num_segments,
  drop column if exists sms_from_number,
  drop column if exists sms_to_number,
  drop column if exists sms_updated_at;

alter table public.sessions
  drop column if exists platform;

-- sessions.metadata.tokens was a third copy of token counts (alongside
-- sessions.tokens_used and the token_usage ledger). The app no longer writes it;
-- strip the stale key from existing rows.
update public.sessions
set metadata = metadata - 'tokens'
where metadata ? 'tokens';
