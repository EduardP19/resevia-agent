-- Reconcile schema drift: 20260623120000_token_usage_and_plan_limits.sql is
-- recorded as applied in migration history, but business_profiles.plan /
-- monthly_token_limit and the salon_token_usage_current_month view were
-- missing on the remote DB (confirmed via REST probe on 2026-06-25 — the
-- token_usage table, sessions.tokens_used/model_used, and record_token_usage()
-- all existed, only these two pieces were gone). Re-running the idempotent
-- parts of that migration to bring the remote back in line with its own
-- recorded history.

-- 2. Plan + credit allowance on the tenant --------------------------------------
alter table public.business_profiles
  add column if not exists plan                text,
  add column if not exists monthly_token_limit bigint;

update public.business_profiles set plan = 'free' where plan is null or plan = '';

update public.business_profiles
set monthly_token_limit = case plan
  when 'pro'        then 2000000
  when 'enterprise' then null
  else 200000          -- free tier
end
where monthly_token_limit is null and plan <> 'enterprise';

-- 5. "Used vs limit" convenience view (now including whatsapp, per the
--    WhatsApp channel migration) -------------------------------------------
create or replace view public.salon_token_usage_current_month as
select
  bp.id                  as salon_id,
  bp.plan                as plan,
  bp.monthly_token_limit as monthly_token_limit,
  coalesce(
    sum(tu.tokens_total) filter (
      where tu.created_at >= date_trunc('month', now())
        and (tu.channel is null or tu.channel in ('sms', 'whatsapp', 'voice', 'web'))
    ),
    0
  )::bigint              as tokens_used_this_month
from public.business_profiles bp
left join public.token_usage tu on tu.salon_id = bp.id
group by bp.id, bp.plan, bp.monthly_token_limit;
