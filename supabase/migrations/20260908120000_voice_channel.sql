-- Voice channel: per-tenant call handling mode + 'voice' as a session channel.
--
-- Until now /api/twilio/voice unconditionally answered with <Reject> and sent a
-- missed-call follow-up over WhatsApp/SMS. `voice_mode` makes that behaviour a
-- per-tenant setting the owner controls from the dashboard:
--
--   reject  — current behaviour: hang up, send the missed-call follow-up
--   forward — <Dial> voice_forward_number (the salon's real line)
--   agent   — <Connect> the call to the Deepgram Voice Agent
--
-- Default is 'reject' so existing tenants keep exactly the behaviour they have.

alter table public.business_profiles
  add column if not exists voice_mode text not null default 'reject';

alter table public.business_profiles
  drop constraint if exists business_profiles_voice_mode_check;

alter table public.business_profiles
  add constraint business_profiles_voice_mode_check
    check (voice_mode in ('reject', 'forward', 'agent'));

-- E.164 number to <Dial> when voice_mode = 'forward'. Nullable: the API and the
-- webhook both fall back to 'reject' when the mode is 'forward' but this is unset,
-- so a half-configured tenant can never drop calls into a dead <Dial>.
alter table public.business_profiles
  add column if not exists voice_forward_number text;

-- Admit voice conversations. `sessions_platform_check` already permits 'voice';
-- `channel` is the authoritative routing field and did not.
alter table public.sessions
  drop constraint if exists sessions_channel_check;

alter table public.sessions
  add constraint sessions_channel_check
    check (channel in ('sms', 'whatsapp', 'webchat', 'voice'));
