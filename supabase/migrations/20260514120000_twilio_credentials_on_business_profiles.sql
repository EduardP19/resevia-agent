-- Add per-business Twilio credentials and SMS notification target to business_profiles.
-- twilio_auth_token is stored AES-256-CBC encrypted (iv:ciphertext hex) by the application layer.
-- twilio_account_sid and notify_sms_to are stored as plain text.

alter table public.business_profiles
  add column if not exists twilio_account_sid text,
  add column if not exists twilio_auth_token  text,
  add column if not exists notify_sms_to      text;
