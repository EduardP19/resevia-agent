-- Add WhatsApp as a first-class outbound-initiated channel alongside SMS.
--
-- WhatsApp reuses the existing per-tenant Twilio credentials
-- (twilio_account_sid / twilio_auth_token) but sends from a dedicated
-- WhatsApp sender number. Sessions gain an authoritative `channel` column so
-- every subsequent agent reply (auto / approval / escalation) routes back to
-- the channel the customer is actually conversing on.

-- 1. Per-tenant WhatsApp sender number (mirrors twilio_number) ----------------
alter table public.business_profiles
  add column if not exists whatsapp_number text;

-- 2. Authoritative per-session channel ---------------------------------------
--    `platform` has historically been a free-text stamp written on insert
--    ('sms' / 'web') but never read for routing. `channel` is the field the
--    inbound/approve/initiate paths use to decide how to send.
alter table public.sessions
  add column if not exists channel text not null default 'sms';

-- Backfill from the legacy `platform` stamp where it maps cleanly.
update public.sessions
  set channel = case
    when platform = 'whatsapp' then 'whatsapp'
    when platform = 'web' then 'webchat'
    else 'sms'
  end
  where channel is null or channel = 'sms';

alter table public.sessions
  drop constraint if exists sessions_channel_check;

alter table public.sessions
  add constraint sessions_channel_check
    check (channel in ('sms', 'whatsapp', 'webchat'));

-- 3. Make the legacy `platform` check permissive ------------------------------
--    The original constraint allowed only ('voice','web','whatsapp') yet the
--    app inserts platform='sms'. Production works, so the check was already
--    dropped out-of-band; re-create it here in an inclusive form so a fresh
--    `supabase db reset` matches production.
alter table public.sessions
  drop constraint if exists sessions_platform_check;

alter table public.sessions
  add constraint sessions_platform_check
    check (platform in ('voice', 'web', 'whatsapp', 'sms', 'webchat'));

-- 4. Count WhatsApp usage toward the monthly plan allowance -------------------
--    Guarded: only recreate the view when the token-usage/plan schema actually
--    exists. Some environments have the token_usage migration recorded in
--    history but not applied (schema drift); skipping here lets the WhatsApp
--    feature land regardless, and the view picks up WhatsApp once plan columns
--    are reconciled separately.
do $$
begin
  if exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'business_profiles' and column_name = 'plan'
      )
     and to_regclass('public.token_usage') is not null
  then
    execute $view$
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
    $view$;
  else
    raise notice 'Skipping salon_token_usage_current_month view: business_profiles.plan / token_usage not present (schema drift).';
  end if;
end $$;

-- 5. Channel tag on the message ledger (sms_messages doubles as the WA ledger).
alter table public.sms_messages
  add column if not exists channel text not null default 'sms';

create index if not exists sessions_channel_idx on public.sessions(channel);
