-- Token / credit usage tracking per salon account.
--
-- Adds:
--   * token_usage           — append-only ledger, one row per AI interaction (SMS/voice/web turn)
--   * business_profiles.plan / monthly_token_limit — per-tenant plan + credit allowance
--   * sessions.tokens_used / model_used             — running per-session rollup
--   * salon_token_usage_current_month               — convenience view for "used vs limit"
--
-- NOTE: This DB has historical schema drift (e.g. business_profiles.approval_mode was added
-- outside of migrations), so every change here is written defensively with IF (NOT) EXISTS
-- and idempotent constraint drops.

-- 1. Per-interaction token ledger ------------------------------------------------
create table if not exists public.token_usage (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  salon_id          uuid references public.business_profiles(id) on delete cascade,
  session_id        uuid references public.sessions(id) on delete set null,
  model             text,
  channel           text,            -- 'sms' | 'voice' | 'web' | 'test' | 'sandbox'
  interaction       text,            -- e.g. 'inbound_message'
  tokens_prompt     integer not null default 0,
  tokens_completion integer not null default 0,
  tokens_total      integer not null default 0,
  tool_calls        integer not null default 0,
  metadata          jsonb,
  constraint token_usage_tokens_non_negative_check
    check (tokens_prompt >= 0 and tokens_completion >= 0 and tokens_total >= 0)
);

create index if not exists token_usage_salon_id_idx        on public.token_usage(salon_id);
create index if not exists token_usage_session_id_idx       on public.token_usage(session_id);
create index if not exists token_usage_created_at_idx       on public.token_usage(created_at);
create index if not exists token_usage_salon_created_at_idx on public.token_usage(salon_id, created_at);

alter table public.token_usage enable row level security;
drop policy if exists "Service role access" on public.token_usage;
create policy "Service role access" on public.token_usage using (true);

-- 2. Plan + credit allowance on the tenant --------------------------------------
alter table public.business_profiles
  add column if not exists plan                text,
  add column if not exists monthly_token_limit bigint;

-- Default existing/blank plans to 'free'.
update public.business_profiles set plan = 'free' where plan is null or plan = '';

-- Backfill a sensible monthly allowance where none is set (NULL = unlimited).
update public.business_profiles
set monthly_token_limit = case plan
  when 'pro'        then 2000000
  when 'enterprise' then null
  else 200000          -- free tier
end
where monthly_token_limit is null and plan <> 'enterprise';

-- 3. Per-session rollup ----------------------------------------------------------
alter table public.sessions
  add column if not exists tokens_used integer not null default 0,
  add column if not exists model_used  text;

-- 4. Atomic recorder: append a ledger row AND bump the per-session rollup --------
create or replace function public.record_token_usage(
  p_salon_id          uuid,
  p_session_id        uuid,
  p_model             text,
  p_channel           text,
  p_interaction       text,
  p_tokens_prompt     integer,
  p_tokens_completion integer,
  p_tokens_total      integer,
  p_tool_calls        integer,
  p_metadata          jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.token_usage(
    salon_id, session_id, model, channel, interaction,
    tokens_prompt, tokens_completion, tokens_total, tool_calls, metadata
  ) values (
    p_salon_id, p_session_id, p_model, p_channel, p_interaction,
    coalesce(p_tokens_prompt, 0), coalesce(p_tokens_completion, 0), coalesce(p_tokens_total, 0),
    coalesce(p_tool_calls, 0), p_metadata
  ) returning id into v_id;

  if p_session_id is not null then
    update public.sessions
      set tokens_used = coalesce(tokens_used, 0) + coalesce(p_tokens_total, 0),
          model_used  = coalesce(p_model, model_used)
      where id = p_session_id;
  end if;

  return v_id;
end;
$$;

revoke all on function public.record_token_usage(uuid, uuid, text, text, text, integer, integer, integer, integer, jsonb) from public;
grant execute on function public.record_token_usage(uuid, uuid, text, text, text, integer, integer, integer, integer, jsonb) to service_role, authenticated;

-- 5. "Used vs limit" convenience view -------------------------------------------
-- Only real customer channels count toward the plan allowance; internal
-- 'test'/'sandbox' usage is still logged but excluded from billing.
create or replace view public.salon_token_usage_current_month as
select
  bp.id                  as salon_id,
  bp.plan                as plan,
  bp.monthly_token_limit as monthly_token_limit,
  coalesce(
    sum(tu.tokens_total) filter (
      where tu.created_at >= date_trunc('month', now())
        and (tu.channel is null or tu.channel in ('sms', 'voice', 'web'))
    ),
    0
  )::bigint              as tokens_used_this_month
from public.business_profiles bp
left join public.token_usage tu on tu.salon_id = bp.id
group by bp.id, bp.plan, bp.monthly_token_limit;
