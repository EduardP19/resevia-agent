-- Make the spend check atomic and race-free.
--
-- The first cut did three round trips from Node — read spend, read the limit,
-- query app_logs to see whether we'd already alerted — then wrote the alert via
-- the fire-and-forget logger. Two defects fell out of that:
--
--   1. Dedup race. The alert row is written asynchronously, so consecutive
--      checks all read "not yet alerted" and each wrote a duplicate. Verified:
--      three calls in a row produced three identical alerts. The SMS pricing
--      cron processes a batch of 50 in a tight loop, every one of which calls
--      upsertSmsMessage, so this would have fired ~50 duplicate alerts.
--   2. Stale reads. The limit was fetched with a supabase GET, which Next can
--      serve from its fetch cache — the checker kept seeing an old limit after
--      the column had been updated. RPCs are POSTs and are never cached.
--
-- Doing the whole decision in one function fixes both, and cuts three round
-- trips on the message write path down to one.

create table if not exists public.tenant_cost_alerts (
  salon_id      uuid not null references public.business_profiles(id) on delete cascade,
  month_start   date not null,
  threshold_pct integer not null,
  created_at    timestamptz not null default now(),
  spend_usd     numeric(10, 4),
  limit_usd     numeric(10, 4),
  primary key (salon_id, month_start, threshold_pct)
);

comment on table public.tenant_cost_alerts is
  'One row per tenant per month per threshold. The primary key IS the dedupe — insert with on conflict do nothing and only alert when a row was actually created.';

alter table public.tenant_cost_alerts enable row level security;

drop policy if exists "Service role access on tenant_cost_alerts" on public.tenant_cost_alerts;
create policy "Service role access on tenant_cost_alerts"
  on public.tenant_cost_alerts
  using (true);

/**
 * Evaluates one tenant's month-to-date message spend and claims the alert.
 *
 * Returns should_alert = true at most ONCE per (tenant, month, threshold): the
 * insert either creates the row and claims the alert, or hits the primary key
 * and reports that someone else already has it. Never blocks anything; the
 * caller only decides whether to send an email.
 */
create or replace function public.evaluate_tenant_cost_alert(
  p_salon_id      uuid,
  p_default_limit numeric,
  p_thresholds    integer[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_month_start date := date_trunc('month', now() at time zone 'utc')::date;
  v_spend       numeric;
  v_limit       numeric;
  v_name        text;
  v_pct         numeric;
  v_threshold   integer;
  v_claimed     boolean := false;
begin
  select coalesce(sum(coalesce(twilio_fee_usd, 0) + coalesce(meta_fee_usd, 0)), 0)
    into v_spend
    from public.sms_messages
   where salon_id = p_salon_id
     and created_at >= v_month_start;

  select coalesce(nullif(monthly_cost_limit_usd, 0), p_default_limit), name
    into v_limit, v_name
    from public.business_profiles
   where id = p_salon_id;

  if v_limit is null or v_limit <= 0 then
    return jsonb_build_object('should_alert', false, 'reason', 'no_limit_configured');
  end if;

  v_pct := (v_spend / v_limit) * 100;

  -- Highest crossed threshold only: jumping straight past 80 to 100 should
  -- raise one alert, not two.
  select max(t) into v_threshold
    from unnest(p_thresholds) as t
   where v_pct >= t;

  if v_threshold is null then
    return jsonb_build_object(
      'should_alert', false, 'reason', 'under_threshold',
      'spend_usd', v_spend, 'limit_usd', v_limit, 'pct_used', round(v_pct, 2)
    );
  end if;

  insert into public.tenant_cost_alerts (salon_id, month_start, threshold_pct, spend_usd, limit_usd)
  values (p_salon_id, v_month_start, v_threshold, v_spend, v_limit)
  on conflict (salon_id, month_start, threshold_pct) do nothing;

  v_claimed := found;

  return jsonb_build_object(
    'should_alert',  v_claimed,
    'reason',        case when v_claimed then 'threshold_crossed' else 'already_alerted' end,
    'threshold_pct', v_threshold,
    'spend_usd',     round(v_spend, 4),
    'limit_usd',     v_limit,
    'pct_used',      round(v_pct, 2),
    'salon_name',    v_name,
    'month_start',   v_month_start
  );
end;
$$;

grant execute on function public.evaluate_tenant_cost_alert(uuid, numeric, integer[])
  to authenticated, service_role;
