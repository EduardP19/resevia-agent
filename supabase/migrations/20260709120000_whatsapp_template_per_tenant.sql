-- Per-tenant WhatsApp initiation template, so each business can use its own
-- approved Content Template instead of a single global TWILIO_WHATSAPP_TEMPLATE_SID.
-- Falls back to the env var when a tenant hasn't set one (see lib/twilio.ts).

alter table public.business_profiles
  add column if not exists whatsapp_template_sid text;

alter table public.business_profiles
  add column if not exists whatsapp_template_preview text;
