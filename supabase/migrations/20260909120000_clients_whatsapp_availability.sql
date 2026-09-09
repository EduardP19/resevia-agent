-- Whether this client's phone number is reachable on WhatsApp.
--
-- null = never tried, true = a WhatsApp message to them was confirmed sent,
-- false = a send was attempted and failed/never confirmed, so outbound
-- messages to them should go straight to SMS instead of paying for (and
-- waiting on) a WhatsApp attempt that is going to fall back anyway.
alter table public.clients
  add column if not exists whatsapp_available boolean,
  add column if not exists whatsapp_checked_at timestamptz;

comment on column public.clients.whatsapp_available is
  'null = unknown, true = WhatsApp send confirmed, false = WhatsApp send failed (use SMS).';
comment on column public.clients.whatsapp_checked_at is
  'When whatsapp_available was last determined by an actual send attempt.';
