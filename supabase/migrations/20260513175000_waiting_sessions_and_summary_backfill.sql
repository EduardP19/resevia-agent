-- Keep waiting sessions open and backfill missing conversation summaries.
--
-- Rules:
-- 1) Do not expire sessions when we're waiting on the agent/owner:
--    - latest transcript role is 'user'   (agent still owes a reply)
--    - latest transcript role is 'draft'  (owner still owes approval)
-- 2) Continue expiring truly inactive sessions after 5 minutes.
-- 3) Backfill missing session summaries from latest transcript content.

create or replace function public.expire_inactive_sessions_and_holds()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  expired_count integer := 0;
  expired_without_transcript_count integer := 0;
  holds_expired_count integer := 0;
  now_iso text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  with latest_roles as (
    select distinct on (t.session_id)
      t.session_id,
      t.role
    from public.transcripts t
    where t.role in ('user', 'assistant', 'draft')
    order by t.session_id, t.created_at desc
  )
  update public.sessions s
  set
    status = 'expired',
    updated_at = now(),
    summary = case
      when coalesce(btrim(s.summary), '') = '' then 'Session timed out before completion.'
      else s.summary
    end,
    metadata = coalesce(s.metadata, '{}'::jsonb)
      || jsonb_build_object('expired_at', now_iso, 'expired_by', 'cron-inactivity')
  from latest_roles lr
  where s.id = lr.session_id
    and s.status = 'active'
    and s.updated_at < now() - interval '5 minutes'
    and s.updated_at > now() - interval '48 hours'
    and coalesce(s.metadata->>'expired_at', '') = ''
    and coalesce(s.metadata->>'source', '') <> 'sophia-sandbox'
    and lr.role not in ('user', 'draft');

  get diagnostics expired_count = row_count;

  -- Expire stale active sessions that never received transcript messages.
  update public.sessions s
  set
    status = 'expired',
    updated_at = now(),
    summary = case
      when coalesce(btrim(s.summary), '') = '' then 'Session timed out before completion.'
      else s.summary
    end,
    metadata = coalesce(s.metadata, '{}'::jsonb)
      || jsonb_build_object('expired_at', now_iso, 'expired_by', 'cron-inactivity')
  where s.status = 'active'
    and s.updated_at < now() - interval '5 minutes'
    and s.updated_at > now() - interval '48 hours'
    and coalesce(s.metadata->>'expired_at', '') = ''
    and coalesce(s.metadata->>'source', '') <> 'sophia-sandbox'
    and not exists (
      select 1
      from public.transcripts t
      where t.session_id = s.id
        and t.role in ('user', 'assistant', 'draft')
    );

  get diagnostics expired_without_transcript_count = row_count;
  expired_count := expired_count + expired_without_transcript_count;

  update public.bookings
  set status = 'expired'
  where status = 'held'
    and expires_at < now();

  get diagnostics holds_expired_count = row_count;

  return jsonb_build_object(
    'expired', expired_count,
    'holdsExpired', holds_expired_count
  );
end;
$$;

grant execute on function public.expire_inactive_sessions_and_holds() to authenticated, service_role;

create index if not exists transcripts_session_created_desc_idx
  on public.transcripts (session_id, created_at desc);

with latest_messages as (
  select distinct on (t.session_id)
    t.session_id,
    t.role,
    btrim(t.content) as content
  from public.transcripts t
  where t.role in ('user', 'assistant', 'draft')
  order by t.session_id, t.created_at desc
)
update public.sessions s
set summary = case
  when s.status = 'needs_approval' then
    coalesce(
      left('Needs approval: ' || nullif(lm.content, ''), 180),
      'Awaiting owner approval.'
    )
  when s.status = 'escalated' then
    coalesce(
      left('Escalated after client request: ' || nullif(lm.content, ''), 180),
      'Escalated to the team for manual handling.'
    )
  when s.status = 'expired' then
    'Session timed out before completion.'
  when s.status = 'completed' then
    coalesce(left(nullif(lm.content, ''), 180), 'Conversation completed.')
  else
    coalesce(left(nullif(lm.content, ''), 180), 'Conversation active.')
end
from latest_messages lm
where s.id = lm.session_id
  and coalesce(btrim(s.summary), '') = '';

update public.sessions s
set summary = case
  when s.status = 'needs_approval' then 'Awaiting owner approval.'
  when s.status = 'escalated' then 'Escalated to the team for manual handling.'
  when s.status = 'expired' then 'Session timed out before completion.'
  when s.status = 'completed' then 'Conversation completed.'
  else 'Conversation active.'
end
where coalesce(btrim(s.summary), '') = '';
