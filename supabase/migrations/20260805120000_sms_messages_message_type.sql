alter table public.sms_messages
  add column if not exists message_type text;

comment on column public.sms_messages.message_type is
  'Outbound send classification: whatsapp_template (business-initiated Content template), auto_reply (agent free-form reply), initiation (owner-triggered dashboard outreach), missed_call_followup (voice webhook fallback). Null for inbound messages.';

create index if not exists sms_messages_message_type_idx
  on public.sms_messages(message_type);
