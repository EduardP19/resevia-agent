-- Per-chat Manual/Auto override.
--
-- The global Manual/Auto switch lives on business_profiles.approval_mode.
-- response_mode_override lets a single conversation opt out of the global setting:
--   NULL     -> inherit the salon's global approval_mode (default for every chat)
--   'manual' -> this chat always drafts for owner approval
--   'auto'   -> this chat always sends automatically
--
-- Changing one chat's override only affects that chat; the global setting is untouched.

alter table public.sessions
  add column if not exists response_mode_override text;

alter table public.sessions
  drop constraint if exists sessions_response_mode_override_check;

alter table public.sessions
  add constraint sessions_response_mode_override_check
    check (response_mode_override is null or response_mode_override in ('auto', 'manual'));
