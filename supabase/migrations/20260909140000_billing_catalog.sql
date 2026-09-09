-- Billing catalog and salon billing ledger.
--
-- `costs` tracks what Resevia pays providers. These tables track what Resevia
-- charges salons: recurring packages, add-ons and one-off extras such as credit
-- top-ups. Keep this deliberately compact until invoice/payment automation needs
-- more structure.

create table if not exists public.billing_services (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  code        text not null unique,
  name        text not null,
  description text,

  kind text not null check (kind in ('initial_package', 'addon', 'credit_top_up', 'custom')),
  billing_interval text not null default 'month'
    check (billing_interval in ('once', 'month', 'year')),

  unit_name text not null default 'item',
  unit_price numeric(12, 2) not null default 0,
  currency text not null default 'GBP',
  tax_rate numeric(6, 4) not null default 0,

  -- Included usage, entitlements or top-up value, e.g.
  -- {"sms": 500, "whatsapp": 500, "voice_minutes": 100, "credits": 50}
  included_usage jsonb not null default '{}'::jsonb,
  metadata       jsonb not null default '{}'::jsonb,
  is_active      boolean not null default true,

  constraint billing_services_code_not_blank check (btrim(code) <> ''),
  constraint billing_services_name_not_blank check (btrim(name) <> ''),
  constraint billing_services_unit_price_non_negative check (unit_price >= 0),
  constraint billing_services_tax_rate_non_negative check (tax_rate >= 0)
);

comment on table public.billing_services is
  'Operator-managed catalog of chargeable plans, add-ons and one-off top-ups.';
comment on column public.billing_services.included_usage is
  'Structured entitlements for this service, such as message allowance, voice minutes or credit amount.';

create table if not exists public.salon_billing_services (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  salon_id uuid not null references public.business_profiles(id) on delete cascade,
  billing_service_id uuid not null references public.billing_services(id) on delete restrict,

  status text not null default 'active'
    check (status in ('active', 'paused', 'cancelled')),
  quantity numeric(12, 4) not null default 1,
  unit_price_override numeric(12, 2),
  currency_override text,
  tax_rate_override numeric(6, 4),

  starts_on date not null default current_date,
  ends_on   date,

  external_subscription_id text,
  metadata jsonb not null default '{}'::jsonb,

  constraint salon_billing_services_quantity_positive check (quantity > 0),
  constraint salon_billing_services_override_non_negative check (
    unit_price_override is null or unit_price_override >= 0
  ),
  constraint salon_billing_services_tax_rate_non_negative check (
    tax_rate_override is null or tax_rate_override >= 0
  ),
  constraint salon_billing_services_period_order check (ends_on is null or ends_on >= starts_on)
);

comment on table public.salon_billing_services is
  'Recurring or active services assigned to a salon, such as their package and add-ons.';

create index if not exists salon_billing_services_salon_idx
  on public.salon_billing_services (salon_id, status, starts_on desc);
create index if not exists salon_billing_services_service_idx
  on public.salon_billing_services (billing_service_id);

create table if not exists public.billing_ledger (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  salon_id uuid not null references public.business_profiles(id) on delete cascade,
  billing_service_id uuid references public.billing_services(id) on delete set null,
  salon_billing_service_id uuid references public.salon_billing_services(id) on delete set null,

  entry_type text not null check (
    entry_type in ('charge', 'payment', 'credit_top_up', 'credit_debit', 'adjustment', 'refund')
  ),
  status text not null default 'posted'
    check (status in ('draft', 'open', 'posted', 'paid', 'past_due', 'void', 'failed', 'refunded')),

  description text not null,
  billing_period_start date,
  billing_period_end   date,
  due_on date,

  quantity numeric(12, 4) not null default 1,
  unit_amount numeric(12, 2) not null default 0,
  tax_rate numeric(6, 4) not null default 0,
  subtotal_amount numeric(12, 2) not null default 0,
  tax_amount numeric(12, 2) not null default 0,
  total_amount numeric(12, 2) not null default 0,
  currency text not null default 'GBP',

  -- Positive for purchased/adjusted credits, negative for consumed credits.
  credit_type text check (credit_type in ('usage', 'sms', 'whatsapp', 'voice_minutes', 'custom')),
  credit_delta numeric(12, 4),
  credit_balance_after numeric(12, 4),

  external_invoice_id text,
  external_payment_id text,
  paid_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,

  constraint billing_ledger_description_not_blank check (btrim(description) <> ''),
  constraint billing_ledger_quantity_positive check (quantity > 0),
  constraint billing_ledger_amounts_non_negative check (
    unit_amount >= 0 and tax_rate >= 0 and subtotal_amount >= 0 and tax_amount >= 0 and total_amount >= 0
  ),
  constraint billing_ledger_period_order check (
    billing_period_start is null
    or billing_period_end is null
    or billing_period_end > billing_period_start
  ),
  constraint billing_ledger_credit_fields_match check (
    (entry_type in ('credit_top_up', 'credit_debit', 'adjustment') and credit_delta is not null)
    or (entry_type not in ('credit_top_up', 'credit_debit', 'adjustment') and credit_delta is null)
  )
);

comment on table public.billing_ledger is
  'Unified salon billing history: monthly charges, one-off top-ups, payments, refunds and credit movements.';

create index if not exists billing_ledger_salon_created_idx
  on public.billing_ledger (salon_id, created_at desc);
create index if not exists billing_ledger_salon_period_idx
  on public.billing_ledger (salon_id, billing_period_start desc, billing_period_end desc);
create index if not exists billing_ledger_status_idx
  on public.billing_ledger (status, due_on);
create index if not exists billing_ledger_service_idx
  on public.billing_ledger (billing_service_id);

alter table public.billing_services enable row level security;
alter table public.salon_billing_services enable row level security;
alter table public.billing_ledger enable row level security;

drop policy if exists "Service role access on billing_services" on public.billing_services;
create policy "Service role access on billing_services" on public.billing_services using (true);

drop policy if exists "Service role access on salon_billing_services" on public.salon_billing_services;
create policy "Service role access on salon_billing_services" on public.salon_billing_services using (true);

drop policy if exists "Service role access on billing_ledger" on public.billing_ledger;
create policy "Service role access on billing_ledger" on public.billing_ledger using (true);
