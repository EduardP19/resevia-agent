-- Add dashboard-user identity and browser-session grouping to app_logs.
--
-- `session_id` is a foreign key to public.sessions — the customer conversation
-- table — so it can never represent a dashboard user's browsing session. And
-- `request_id` only covers server-side inbound webhooks. That left interaction
-- rows with no way to group a single sitting: 0 of 400 sampled interaction rows
-- had any grouping key, and only 9 carried a user id (in metadata, on login).
--
-- Two distinct axes, deliberately separate:
--   user_id         — WHO. Taken from the signed session cookie server-side, so
--                     it cannot be spoofed by the browser.
--   user_session_id — WHICH SITTING. Minted client-side, held in sessionStorage,
--                     rolled over after idle. Not security-sensitive; it only
--                     needs to be consistent, not trustworthy.

alter table public.app_logs
  add column if not exists user_id         text,
  add column if not exists user_session_id text;

create index if not exists app_logs_user_id_idx
  on public.app_logs (user_id, created_at desc);

create index if not exists app_logs_user_session_idx
  on public.app_logs (user_session_id, created_at);

-- Promote the user ids that were already being written into metadata.
update public.app_logs
   set user_id = metadata->>'user_id'
 where user_id is null
   and coalesce(metadata->>'user_id', '') <> '';

comment on column public.app_logs.user_id is
  'Dashboard user (email) from the signed session cookie. Server-derived, not client-supplied.';
comment on column public.app_logs.user_session_id is
  'Groups one browsing sitting. Client-minted, sessionStorage-backed, rolls over after idle.';
comment on column public.app_logs.session_id is
  'Customer CONVERSATION id (FK to public.sessions). Not a dashboard user session — see user_session_id.';
