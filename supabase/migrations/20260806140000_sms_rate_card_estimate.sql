-- Widen the rate-card estimate columns to cover SMS as well as WhatsApp.
--
-- `twilio_fee_usd` now holds the estimated Twilio charge for ANY message:
--   SMS      — num_segments × the per-segment rate for that direction, plus the
--              processing fee if the message ended up failed/undelivered
--   WhatsApp — the flat per-message platform fee
-- `meta_fee_usd` stays WhatsApp-only. Neither is ever summed with `price`, which is
-- Twilio's own reported figure for the same message.

comment on column public.sms_messages.twilio_fee_usd is
  'Rate-card estimate (USD) of Twilio''s charge for this message. SMS: num_segments x per-segment rate by direction (+ failed-message fee). WhatsApp: flat per-message platform fee. Estimate — not Twilio-reported, never add to price.';

comment on column public.sms_messages.meta_fee_usd is
  'Rate-card Meta fee (USD), WhatsApp only: charged on sends outside the 24h customer service window and on template sends; 0 for free-form replies inside the window and for inbound. Estimate — not Twilio-reported.';

comment on column public.sms_messages.service_window is
  'State of Meta''s 24h customer service window when the message was priced: open (a free-form reply is free) or closed. Null for SMS.';
