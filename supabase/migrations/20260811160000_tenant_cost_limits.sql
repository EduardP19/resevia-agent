-- Per-tenant message cost tracking, replacing the token-limit idea.
--
-- Messaging is ~30x the AI cost per interaction (measured: $0.056 per SMS
-- segment against $0.00188 per Gemini call), so message spend is the meter that
-- matters. Token usage is still recorded in token_usage as an observability
-- signal — the prompt/completion ratio is ~157:1, so a prompt-loop regression
-- would show up there first — but it is no longer a billing control.
--
-- Enforcement reads the RATE-CARD estimate (twilio_fee_usd + meta_fee_usd),
-- never Twilio's reported `price`. The reported price arrives on a later status
-- callback, only 81% of messages currently have one, and the reconciliation
-- cron that backfills the rest has no schedule behind it. A cap on that column
-- would be trivially overshot.

-- 1. Per-tenant cap. Null means "use the TENANT_MONTHLY_COST_LIMIT_USD default".
alter table public.business_profiles
  add column if not exists monthly_cost_limit_usd numeric(10, 4);

comment on column public.business_profiles.monthly_cost_limit_usd is
  'Monthly message-spend cap in USD, measured against the rate-card estimate. Null falls back to the TENANT_MONTHLY_COST_LIMIT_USD env default. Alert-only — nothing is blocked.';

-- 2. Unused view over per-tenant usage, exposed via PostgREST with no RLS.
--    Nothing reads it, and it leaks cross-tenant usage data if the anon key
--    ever escapes. Superseded by tenant_month_cost_usd() below.
--    Dropped BEFORE the column it selects, or the drop below fails on the
--    dependency and takes the whole migration with it.
drop view if exists public.salon_token_usage_current_month;

-- 3. The dead token-limit control. Never referenced by a single line of code.
alter table public.business_profiles
  drop column if exists monthly_token_limit;

-- 4. Month-to-date spend for one tenant, as a single indexed aggregate.
--    getTenantApiSpend() pulls up to 10k rows from two tables to build the
--    Settings card; that is far too heavy to run on every message write.
create or replace function public.tenant_month_cost_usd(p_salon_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    sum(coalesce(twilio_fee_usd, 0) + coalesce(meta_fee_usd, 0)),
    0
  )::numeric
    from public.sms_messages
   where salon_id = p_salon_id
     and created_at >= date_trunc('month', now() at time zone 'utc');
$$;

grant execute on function public.tenant_month_cost_usd(uuid) to authenticated, service_role;

-- Supports the aggregate above; the existing indexes are single-column.
create index if not exists sms_messages_salon_created_idx
  on public.sms_messages (salon_id, created_at desc);
