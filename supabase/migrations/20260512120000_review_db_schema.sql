-- New Resevia multi-tenant schema.
-- Existing unprefixed tables are intentionally untouched.

create table if not exists public."1_business_profiles" (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid generated always as (id) stored,
  created_at timestamptz not null default now(),
  name text not null,
  phone text not null,
  email text not null,
  address text not null,
  whatsapp_number text not null,
  agent_name text not null,
  agent_tone text not null default 'friendly',
  response_mode text not null default 'auto',
  business_hours jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  plan text not null default 'free',
  stripe_customer_id text,
  stripe_subscription_id text,
  constraint one_business_profiles_tenant_id_key unique (tenant_id),
  constraint one_business_profiles_tenant_id_id_key unique (tenant_id, id),
  constraint one_business_profiles_agent_tone_check
    check (agent_tone in ('friendly', 'formal', 'neutral')),
  constraint one_business_profiles_response_mode_check
    check (response_mode in ('auto', 'manual')),
  constraint one_business_profiles_plan_check
    check (plan in ('free', 'pro', 'enterprise')),
  constraint one_business_profiles_business_hours_object_check
    check (jsonb_typeof(business_hours) = 'object')
);

create table if not exists public."1_workers" (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public."1_business_profiles"(id) on delete cascade,
  created_at timestamptz not null default now(),
  name text not null,
  role text not null,
  phone text not null,
  email text not null,
  avatar_url text,
  is_active boolean not null default true,
  constraint one_workers_tenant_id_id_key unique (tenant_id, id)
);

create table if not exists public."1_services" (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public."1_business_profiles"(id) on delete cascade,
  created_at timestamptz not null default now(),
  name text not null,
  description text not null,
  duration_mins integer not null,
  price numeric not null,
  is_active boolean not null default true,
  constraint one_services_tenant_id_id_key unique (tenant_id, id),
  constraint one_services_duration_mins_positive_check check (duration_mins > 0),
  constraint one_services_price_non_negative_check check (price >= 0)
);

create table if not exists public."1_worker_services" (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public."1_business_profiles"(id) on delete cascade,
  worker_id uuid not null,
  service_id uuid not null,
  custom_price numeric,
  custom_duration_mins integer,
  constraint one_worker_services_worker_fk
    foreign key (tenant_id, worker_id)
    references public."1_workers"(tenant_id, id)
    on delete cascade,
  constraint one_worker_services_service_fk
    foreign key (tenant_id, service_id)
    references public."1_services"(tenant_id, id)
    on delete cascade,
  constraint one_worker_services_unique_worker_service unique (worker_id, service_id),
  constraint one_worker_services_custom_price_non_negative_check
    check (custom_price is null or custom_price >= 0),
  constraint one_worker_services_custom_duration_mins_positive_check
    check (custom_duration_mins is null or custom_duration_mins > 0)
);

create table if not exists public."1_faqs" (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public."1_business_profiles"(id) on delete cascade,
  created_at timestamptz not null default now(),
  question text not null,
  answer text not null,
  category text,
  is_active boolean not null default true,
  constraint one_faqs_tenant_id_id_key unique (tenant_id, id)
);

create table if not exists public."1_sessions" (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public."1_business_profiles"(id) on delete cascade,
  created_at timestamptz not null default now(),
  customer_phone text not null,
  status text not null default 'active',
  channel text not null default 'whatsapp',
  initiated_by text not null default 'customer',
  response_mode_override text,
  last_activity_at timestamptz not null default now(),
  warning_sent_at timestamptz,
  auto_close_at timestamptz,
  tokens_used integer not null default 0,
  tokens_input integer not null default 0,
  tokens_output integer not null default 0,
  model_used text,
  metadata jsonb,
  constraint one_sessions_tenant_id_id_key unique (tenant_id, id),
  constraint one_sessions_status_check
    check (status in ('active', 'needs_approval', 'escalated', 'closed')),
  constraint one_sessions_channel_check
    check (channel in ('whatsapp', 'sms', 'webchat')),
  constraint one_sessions_initiated_by_check
    check (initiated_by in ('customer', 'owner')),
  constraint one_sessions_response_mode_override_check
    check (response_mode_override is null or response_mode_override in ('auto', 'manual')),
  constraint one_sessions_tokens_used_non_negative_check check (tokens_used >= 0),
  constraint one_sessions_tokens_input_non_negative_check check (tokens_input >= 0),
  constraint one_sessions_tokens_output_non_negative_check check (tokens_output >= 0),
  constraint one_sessions_metadata_object_check
    check (metadata is null or jsonb_typeof(metadata) = 'object')
);

create table if not exists public."1_messages" (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null,
  tenant_id uuid not null references public."1_business_profiles"(id) on delete cascade,
  created_at timestamptz not null default now(),
  role text not null,
  content text not null,
  is_draft boolean not null default false,
  approved_at timestamptz,
  approved_by uuid,
  constraint one_messages_session_fk
    foreign key (tenant_id, session_id)
    references public."1_sessions"(tenant_id, id)
    on delete cascade,
  constraint one_messages_role_check
    check (role in ('user', 'assistant', 'system', 'draft'))
);

create table if not exists public."1_bookings" (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public."1_business_profiles"(id) on delete cascade,
  session_id uuid not null,
  created_at timestamptz not null default now(),
  customer_phone text not null,
  customer_name text not null,
  worker_id uuid not null,
  service_id uuid not null,
  booking_date date not null,
  booking_time time not null,
  status text not null default 'pending',
  cal_booking_id text,
  cal_booking_url text,
  notes text,
  constraint one_bookings_session_fk
    foreign key (tenant_id, session_id)
    references public."1_sessions"(tenant_id, id)
    on delete cascade,
  constraint one_bookings_worker_fk
    foreign key (tenant_id, worker_id)
    references public."1_workers"(tenant_id, id),
  constraint one_bookings_service_fk
    foreign key (tenant_id, service_id)
    references public."1_services"(tenant_id, id),
  constraint one_bookings_status_check
    check (status in ('pending', 'confirmed', 'cancelled'))
);

create table if not exists public."1_logs" (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public."1_business_profiles"(id) on delete cascade,
  created_at timestamptz not null default now(),
  event_type text not null,
  session_id uuid,
  customer_phone text,
  worker_id uuid,
  service_id uuid,
  is_read boolean not null default false,
  metadata jsonb,
  constraint one_logs_session_fk
    foreign key (tenant_id, session_id)
    references public."1_sessions"(tenant_id, id),
  constraint one_logs_worker_fk
    foreign key (tenant_id, worker_id)
    references public."1_workers"(tenant_id, id),
  constraint one_logs_service_fk
    foreign key (tenant_id, service_id)
    references public."1_services"(tenant_id, id),
  constraint one_logs_event_type_check
    check (event_type in (
      'booking_made',
      'booking_cancelled',
      'escalation',
      'faq_answered',
      'handoff',
      'session_closed'
    )),
  constraint one_logs_metadata_object_check
    check (metadata is null or jsonb_typeof(metadata) = 'object')
);

create table if not exists public."1_system_logs" (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  tenant_id uuid references public."1_business_profiles"(id) on delete set null,
  level text not null,
  source text not null,
  message text not null,
  session_id uuid,
  metadata jsonb,
  constraint one_system_logs_level_check
    check (level in ('info', 'warning', 'error', 'critical')),
  constraint one_system_logs_source_check
    check (source in ('edge_function', 'whatsapp_webhook', 'ai_call', 'auth', 'billing', 'cron')),
  constraint one_system_logs_metadata_object_check
    check (metadata is null or jsonb_typeof(metadata) = 'object')
);

create table if not exists public."1_billing" (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public."1_business_profiles"(id) on delete cascade,
  created_at timestamptz not null default now(),
  plan text not null,
  status text not null default 'active',
  conversations_used integer not null default 0,
  conversations_limit integer not null,
  tokens_used_total integer not null default 0,
  current_period_start timestamptz not null,
  current_period_end timestamptz not null,
  stripe_customer_id text,
  stripe_subscription_id text,
  constraint one_billing_tenant_id_id_key unique (tenant_id, id),
  constraint one_billing_plan_check check (plan in ('free', 'pro', 'enterprise')),
  constraint one_billing_status_check check (status in ('active', 'cancelled', 'past_due')),
  constraint one_billing_conversations_used_non_negative_check check (conversations_used >= 0),
  constraint one_billing_conversations_limit_non_negative_check check (conversations_limit >= 0),
  constraint one_billing_tokens_used_total_non_negative_check check (tokens_used_total >= 0),
  constraint one_billing_period_order_check check (current_period_end > current_period_start)
);

create index if not exists one_business_profiles_tenant_id_idx on public."1_business_profiles"(tenant_id);
create index if not exists one_business_profiles_created_at_idx on public."1_business_profiles"(created_at);

create index if not exists one_workers_tenant_id_idx on public."1_workers"(tenant_id);
create index if not exists one_workers_created_at_idx on public."1_workers"(created_at);

create index if not exists one_services_tenant_id_idx on public."1_services"(tenant_id);
create index if not exists one_services_created_at_idx on public."1_services"(created_at);

create index if not exists one_worker_services_tenant_id_idx on public."1_worker_services"(tenant_id);
create index if not exists one_worker_services_worker_id_idx on public."1_worker_services"(worker_id);
create index if not exists one_worker_services_service_id_idx on public."1_worker_services"(service_id);

create index if not exists one_faqs_tenant_id_idx on public."1_faqs"(tenant_id);
create index if not exists one_faqs_created_at_idx on public."1_faqs"(created_at);

create index if not exists one_sessions_tenant_id_idx on public."1_sessions"(tenant_id);
create index if not exists one_sessions_customer_phone_idx on public."1_sessions"(customer_phone);
create index if not exists one_sessions_last_activity_at_idx on public."1_sessions"(last_activity_at);
create index if not exists one_sessions_created_at_idx on public."1_sessions"(created_at);

create index if not exists one_messages_tenant_id_idx on public."1_messages"(tenant_id);
create index if not exists one_messages_session_id_idx on public."1_messages"(session_id);
create index if not exists one_messages_created_at_idx on public."1_messages"(created_at);

create index if not exists one_bookings_tenant_id_idx on public."1_bookings"(tenant_id);
create index if not exists one_bookings_session_id_idx on public."1_bookings"(session_id);
create index if not exists one_bookings_customer_phone_idx on public."1_bookings"(customer_phone);
create index if not exists one_bookings_booking_date_idx on public."1_bookings"(booking_date);
create index if not exists one_bookings_created_at_idx on public."1_bookings"(created_at);

create index if not exists one_logs_tenant_id_idx on public."1_logs"(tenant_id);
create index if not exists one_logs_session_id_idx on public."1_logs"(session_id);
create index if not exists one_logs_customer_phone_idx on public."1_logs"(customer_phone);
create index if not exists one_logs_created_at_idx on public."1_logs"(created_at);

create index if not exists one_system_logs_tenant_id_idx on public."1_system_logs"(tenant_id);
create index if not exists one_system_logs_session_id_idx on public."1_system_logs"(session_id);
create index if not exists one_system_logs_created_at_idx on public."1_system_logs"(created_at);

create index if not exists one_billing_tenant_id_idx on public."1_billing"(tenant_id);
create index if not exists one_billing_created_at_idx on public."1_billing"(created_at);

alter table public."1_business_profiles" enable row level security;
alter table public."1_workers" enable row level security;
alter table public."1_services" enable row level security;
alter table public."1_worker_services" enable row level security;
alter table public."1_faqs" enable row level security;
alter table public."1_sessions" enable row level security;
alter table public."1_messages" enable row level security;
alter table public."1_bookings" enable row level security;
alter table public."1_logs" enable row level security;
alter table public."1_system_logs" enable row level security;
alter table public."1_billing" enable row level security;

create policy one_business_profiles_tenant_access
  on public."1_business_profiles"
  for all
  to authenticated
  using (tenant_id = auth.uid())
  with check (tenant_id = auth.uid());

create policy one_workers_tenant_access
  on public."1_workers"
  for all
  to authenticated
  using (tenant_id = auth.uid())
  with check (tenant_id = auth.uid());

create policy one_services_tenant_access
  on public."1_services"
  for all
  to authenticated
  using (tenant_id = auth.uid())
  with check (tenant_id = auth.uid());

create policy one_worker_services_tenant_access
  on public."1_worker_services"
  for all
  to authenticated
  using (tenant_id = auth.uid())
  with check (tenant_id = auth.uid());

create policy one_faqs_tenant_access
  on public."1_faqs"
  for all
  to authenticated
  using (tenant_id = auth.uid())
  with check (tenant_id = auth.uid());

create policy one_sessions_tenant_access
  on public."1_sessions"
  for all
  to authenticated
  using (tenant_id = auth.uid())
  with check (tenant_id = auth.uid());

create policy one_messages_tenant_access
  on public."1_messages"
  for all
  to authenticated
  using (tenant_id = auth.uid())
  with check (tenant_id = auth.uid());

create policy one_bookings_tenant_access
  on public."1_bookings"
  for all
  to authenticated
  using (tenant_id = auth.uid())
  with check (tenant_id = auth.uid());

create policy one_logs_tenant_access
  on public."1_logs"
  for all
  to authenticated
  using (tenant_id = auth.uid())
  with check (tenant_id = auth.uid());

create policy one_billing_tenant_access
  on public."1_billing"
  for all
  to authenticated
  using (tenant_id = auth.uid())
  with check (tenant_id = auth.uid());

create policy one_system_logs_service_role_access
  on public."1_system_logs"
  for all
  to service_role
  using (true)
  with check (true);

create or replace function public.get_tenant_context(tenant_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'business',
    (
      select jsonb_build_object(
        'name', business.name,
        'whatsapp_number', business.whatsapp_number,
        'agent_name', business.agent_name,
        'agent_tone', business.agent_tone,
        'response_mode', business.response_mode,
        'business_hours', business.business_hours
      )
      from public."1_business_profiles" as business
      where business.id = $1
    ),
    'workers',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', worker.id,
            'name', worker.name,
            'role', worker.role,
            'services', coalesce(worker_services.services, '[]'::jsonb)
          )
          order by worker.name
        )
        from public."1_workers" as worker
        left join lateral (
          select jsonb_agg(
            jsonb_build_object(
              'name', service.name,
              'price', coalesce(worker_service.custom_price, service.price),
              'duration_mins', coalesce(worker_service.custom_duration_mins, service.duration_mins)
            )
            order by service.name
          ) as services
          from public."1_worker_services" as worker_service
          join public."1_services" as service
            on service.id = worker_service.service_id
           and service.tenant_id = worker_service.tenant_id
          where worker_service.worker_id = worker.id
            and worker_service.tenant_id = $1
            and service.is_active = true
        ) as worker_services on true
        where worker.tenant_id = $1
          and worker.is_active = true
      ),
      '[]'::jsonb
    ),
    'faqs',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'question', faq.question,
            'answer', faq.answer,
            'category', faq.category
          )
          order by faq.created_at
        )
        from public."1_faqs" as faq
        where faq.tenant_id = $1
          and faq.is_active = true
      ),
      '[]'::jsonb
    )
  );
$$;

revoke all on function public.get_tenant_context(uuid) from public;
grant execute on function public.get_tenant_context(uuid) to authenticated, service_role;
