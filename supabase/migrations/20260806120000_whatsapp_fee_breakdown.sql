-- Per-message WhatsApp fee breakdown.
--
-- Twilio's `price` is what Twilio reports for the message; Meta's share is billed
-- against the 24h conversation and isn't reliably visible there. These columns hold
-- our own rate-card estimate so WhatsApp spend can be broken down per message.
-- They are an ESTIMATE and must never be summed together with `price`.

alter table public.sms_messages
  add column if not exists meta_fee_usd numeric,
  add column if not exists twilio_fee_usd numeric,
  add column if not exists service_window text;

comment on column public.sms_messages.meta_fee_usd is
  'Rate-card Meta fee (USD) for this message: charged on sends outside the 24h customer service window and on template sends; 0 for free-form replies inside the window and for inbound. Estimate — not Twilio-reported.';

comment on column public.sms_messages.twilio_fee_usd is
  'Rate-card Twilio per-message WhatsApp platform fee (USD), applied in both directions. Estimate — not Twilio-reported.';

comment on column public.sms_messages.service_window is
  'State of Meta''s 24h customer service window when the message was recorded: open (a free-form reply is free) or closed. Null for SMS.';

alter table public.sms_messages
  drop constraint if exists sms_messages_service_window_check;

alter table public.sms_messages
  add constraint sms_messages_service_window_check
  check (service_window is null or service_window in ('open', 'closed'));

-- Backs the service-window lookup: latest inbound WhatsApp message from a customer.
create index if not exists sms_messages_inbound_window_idx
  on public.sms_messages(from_number, created_at desc)
  where direction = 'inbound';
