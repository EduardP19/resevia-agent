-- Separate WhatsApp Content template for booking confirmations.
--
-- `whatsapp_template_sid` remains the business-initiated outreach/missed-call
-- template. Booking confirmations have different variables, so they need their
-- own optional per-salon override.

alter table public.business_profiles
  add column if not exists whatsapp_booking_confirmation_template_sid text;

comment on column public.business_profiles.whatsapp_booking_confirmation_template_sid is
  'Optional Twilio Content SID for the WhatsApp booking confirmation template. Falls back to TWILIO_WHATSAPP_BOOKING_CONFIRMATION_TEMPLATE_SID.';
