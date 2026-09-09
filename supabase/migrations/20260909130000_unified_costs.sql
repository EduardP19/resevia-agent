-- One table for every cost the platform incurs.
--
-- Replaces three stores that each tracked a slice of spend and had to be joined,
-- reconciled and kept from double-counting each other:
--
--   sms_messages        SMS/WhatsApp ledger — Twilio's billed price AND a
--                       parallel rate-card estimate in separate columns, which
--                       the docs had to warn "never add together"
--   token_usage         Gemini tokens, priced only in TypeScript at read time
--   tenant_cost_alerts  a whole table whose only job was alert dedupe
--
-- `costs` holds one row per billable event. Record what the provider actually
-- tells you: tokens for Gemini, money for Twilio/Meta/Deepgram. Where both are
-- knowable the money column is authoritative and the tokens ride along as the
-- observability signal they always were.
--
-- Estimate and billed price are no longer two columns to be kept apart — they
-- are one column over time. A row is written immediately with the rate-card
-- estimate (estimated = true); when Twilio's real price arrives on a status
-- callback it REPLACES that value and flips the flag. `estimated_amount` keeps
-- the original estimate for calibration only and is never summed for billing.
--
-- Voice was previously invisible to spend tracking entirely. It is a first-class
-- source here.

create table if not exists public.costs (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  salon_id      uuid references public.business_profiles(id) on delete set null,
  session_id    uuid references public.sessions(id) on delete set null,
  transcript_id uuid references public.transcripts(id) on delete set null,

  -- What we are paying for.
  source    text not null check (source in ('sms', 'whatsapp', 'voice', 'ai')),
  -- How it arose: auto_reply, whatsapp_template, initiation, missed_call_followup,
  -- booking_confirmation, inbound_message, observer, ...
  kind      text,
  direction text check (direction in ('inbound', 'outbound')),
  -- The conversation channel this cost was incurred on. Distinct from `source`:
  -- an AI call made during a voice call is source='ai', channel='voice'.
  channel   text,

  -- The token side. Populated for source='ai'; zero elsewhere.
  model      text,
  tokens_in  integer not null default 0,
  tokens_out integer not null default 0,

  -- The money side. `quantity` is whatever the amount was billed per:
  -- SMS segments, voice seconds, 1 for a WhatsApp message or an AI call.
  quantity         numeric,
  amount           numeric(12, 6),
  currency         text not null default 'USD',
  -- false once the provider's own billed figure has replaced the estimate.
  estimated        boolean not null default true,
  -- The rate-card figure, retained after `amount` is upgraded to the billed
  -- price so estimate-vs-actual drift stays measurable. NEVER sum this.
  estimated_amount numeric(12, 6),

  -- Provider correlation and delivery state. Same grain as the cost itself —
  -- one message is one row is one charge — so it lives here rather than in a
  -- second table joined on the SID.
  reference      text unique,
  from_number    text,
  to_number      text,
  status         text,
  error_code     text,
  error_message  text,
  service_window text check (service_window in ('open', 'closed')),
  raw_payload    jsonb not null default '{}'::jsonb,
  metadata       jsonb,

  priced_at             timestamptz,
  last_price_lookup_at  timestamptz,
  price_lookup_attempts integer not null default 0,

  constraint costs_tokens_non_negative check (tokens_in >= 0 and tokens_out >= 0)
);

comment on table public.costs is
  'One row per billable event across every provider. Record tokens where the provider bills tokens, money where it bills money. `amount` is authoritative and progresses from rate-card estimate to billed price in place.';

-- Month-to-date spend per tenant, and the alert aggregate.
create index if not exists costs_salon_created_idx on public.costs (salon_id, created_at desc);
create index if not exists costs_session_idx       on public.costs (session_id);
create index if not exists costs_transcript_idx    on public.costs (transcript_id);
create index if not exists costs_source_idx        on public.costs (source);

-- The SMS pricing reconciliation cron scans for messages still on an estimate.
create index if not exists costs_awaiting_price_idx
  on public.costs (created_at)
  where estimated and source in ('sms', 'whatsapp');

-- WhatsApp 24h service-window lookup.
create index if not exists costs_whatsapp_inbound_window_idx
  on public.costs (from_number, created_at desc)
  where source = 'whatsapp' and direction = 'inbound';

alter table public.costs enable row level security;

drop policy if exists "Service role access on costs" on public.costs;
create policy "Service role access on costs" on public.costs using (true);

-- 1. Migrate the SMS/WhatsApp ledger ------------------------------------------
--
-- amount takes Twilio's billed price where one arrived, and the rate-card
-- estimate where it didn't — which is exactly the estimated flag.
do $$
begin
  if to_regclass('public.sms_messages') is not null then
    insert into public.costs (
      id, created_at, updated_at, salon_id, session_id, transcript_id,
      source, kind, direction, channel,
      quantity, amount, currency, estimated, estimated_amount,
      reference, from_number, to_number, status, error_code, error_message,
      service_window, raw_payload,
      priced_at, last_price_lookup_at, price_lookup_attempts
    )
    select
      m.id, m.created_at, m.updated_at, m.salon_id, m.session_id, m.transcript_id,
      coalesce(nullif(m.channel, ''), 'sms'),
      m.message_type,
      m.direction,
      coalesce(nullif(m.channel, ''), 'sms'),
      m.num_segments,
      coalesce(m.price, coalesce(m.twilio_fee_usd, 0) + coalesce(m.meta_fee_usd, 0)),
      coalesce(upper(nullif(m.price_unit, '')), 'USD'),
      m.price is null,
      coalesce(m.twilio_fee_usd, 0) + coalesce(m.meta_fee_usd, 0),
      m.twilio_message_sid,
      m.from_number, m.to_number, m.status, m.error_code, m.error_message,
      m.service_window, m.raw_payload,
      m.priced_at, m.last_price_lookup_at, m.price_lookup_attempts
    from public.sms_messages m
    on conflict (reference) do nothing;
  end if;
end $$;

-- 2. Migrate the AI token ledger ----------------------------------------------
--
-- token_usage never stored a cost — pricing lived in TypeScript and was applied
-- at read time. Backfilling it here is what lets one column hold every cost.
-- Rates mirror getAiModelRate() in lib/costs.ts (USD per million tokens).
do $$
begin
  if to_regclass('public.token_usage') is not null then
    insert into public.costs (
      id, created_at, salon_id, session_id,
      source, kind, channel, model, tokens_in, tokens_out,
      quantity, amount, currency, estimated, metadata
    )
    select
      t.id, t.created_at, t.salon_id, t.session_id,
      'ai',
      coalesce(t.interaction, 'inbound_message'),
      t.channel,
      t.model,
      coalesce(t.tokens_prompt, 0),
      coalesce(t.tokens_completion, 0),
      1,
      case
        when lower(coalesce(t.model, 'gemini-2.5-flash')) like '%gemini-3.5-flash%'
          then coalesce(t.tokens_prompt, 0) / 1000000.0 * 1.5
             + coalesce(t.tokens_completion, 0) / 1000000.0 * 9
        when lower(coalesce(t.model, 'gemini-2.5-flash')) like '%gemini-2.5-flash-lite%'
          then coalesce(t.tokens_prompt, 0) / 1000000.0 * 0.1
             + coalesce(t.tokens_completion, 0) / 1000000.0 * 0.4
        when lower(coalesce(t.model, 'gemini-2.5-flash')) like '%gemini-2.5-flash%'
          then coalesce(t.tokens_prompt, 0) / 1000000.0 * 0.3
             + coalesce(t.tokens_completion, 0) / 1000000.0 * 2.5
        else null
      end,
      'USD',
      true,
      case
        when t.tool_calls > 0 then jsonb_build_object('tool_calls', t.tool_calls) || coalesce(t.metadata, '{}'::jsonb)
        else t.metadata
      end
    from public.token_usage t
    on conflict (id) do nothing;
  end if;
end $$;

-- 3. Alert dedupe moves onto the tenant ---------------------------------------
--
-- tenant_cost_alerts existed solely so an alert fires once per (tenant, month,
-- threshold). Two columns on the tenant do that with no table: the claim is a
-- conditional UPDATE, which is atomic, resets itself each month, and only ever
-- ratchets upward within one.
alter table public.business_profiles
  add column if not exists cost_alert_month         date,
  add column if not exists cost_alert_threshold_pct integer;

comment on column public.business_profiles.cost_alert_threshold_pct is
  'Highest spend threshold already alerted on for cost_alert_month. Claimed atomically by evaluate_tenant_cost_alert(); replaces the tenant_cost_alerts table.';

-- Carry the current month's claims across so the migration itself cannot
-- re-alert on a threshold an operator was already emailed about.
do $$
begin
  if to_regclass('public.tenant_cost_alerts') is not null then
    update public.business_profiles bp
       set cost_alert_month         = a.month_start,
           cost_alert_threshold_pct = a.max_pct
      from (
        select salon_id, month_start, max(threshold_pct) as max_pct
          from public.tenant_cost_alerts
         where month_start = date_trunc('month', now() at time zone 'utc')::date
         group by salon_id, month_start
      ) a
     where bp.id = a.salon_id;
  end if;
end $$;

-- 4. The spend evaluation, now over one table ---------------------------------
drop function if exists public.evaluate_tenant_cost_alert(uuid, numeric, integer[]);

/**
 * Evaluates one tenant's month-to-date spend and claims the alert.
 *
 * Sums per currency and takes the worst offender rather than adding currencies
 * together: the cap is applied to each currency independently, which on a
 * single-currency account is simply the total.
 *
 * Returns should_alert = true at most once per (tenant, month, threshold). The
 * conditional UPDATE is the claim — concurrent callers race on the same row and
 * exactly one wins. Never blocks anything.
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
  v_currency    text;
  v_limit       numeric;
  v_name        text;
  v_pct         numeric;
  v_threshold   integer;
  v_claimed     boolean := false;
begin
  select coalesce(nullif(monthly_cost_limit_usd, 0), p_default_limit), name
    into v_limit, v_name
    from public.business_profiles
   where id = p_salon_id;

  if v_limit is null or v_limit <= 0 then
    return jsonb_build_object('should_alert', false, 'reason', 'no_limit_configured');
  end if;

  -- Internal traffic is recorded but never counted against a tenant's cap.
  select coalesce(sum(amount), 0), currency
    into v_spend, v_currency
    from public.costs
   where salon_id = p_salon_id
     and created_at >= v_month_start
     and (channel is null or channel not in ('test', 'sandbox'))
   group by currency
   order by 1 desc
   limit 1;

  v_spend := coalesce(v_spend, 0);
  v_pct   := (v_spend / v_limit) * 100;

  -- Highest crossed threshold only: jumping straight past 80 to 100 should
  -- raise one alert, not two.
  select max(t) into v_threshold
    from unnest(p_thresholds) as t
   where v_pct >= t;

  if v_threshold is null then
    return jsonb_build_object(
      'should_alert', false, 'reason', 'under_threshold',
      'spend', v_spend, 'currency', coalesce(v_currency, 'USD'),
      'limit', v_limit, 'pct_used', round(v_pct, 2)
    );
  end if;

  update public.business_profiles
     set cost_alert_month         = v_month_start,
         cost_alert_threshold_pct = v_threshold
   where id = p_salon_id
     and (cost_alert_month is distinct from v_month_start
          or coalesce(cost_alert_threshold_pct, 0) < v_threshold);

  v_claimed := found;

  return jsonb_build_object(
    'should_alert',  v_claimed,
    'reason',        case when v_claimed then 'threshold_crossed' else 'already_alerted' end,
    'threshold_pct', v_threshold,
    'spend',         round(v_spend, 6),
    'currency',      coalesce(v_currency, 'USD'),
    'limit',         v_limit,
    'pct_used',      round(v_pct, 2),
    'salon_name',    v_name,
    'month_start',   v_month_start
  );
end;
$$;

grant execute on function public.evaluate_tenant_cost_alert(uuid, numeric, integer[])
  to authenticated, service_role;

-- 5. Tear down everything the single table replaces ---------------------------
drop function if exists public.tenant_month_cost_usd(uuid);
drop function if exists public.record_token_usage(uuid, uuid, text, text, text, integer, integer, integer, integer, jsonb);

drop table if exists public.tenant_cost_alerts;
drop table if exists public.token_usage;
drop table if exists public.sms_messages;

-- The per-session token rollup was a cache of token_usage and nothing read it.
alter table public.sessions
  drop column if exists tokens_used,
  drop column if exists model_used;
