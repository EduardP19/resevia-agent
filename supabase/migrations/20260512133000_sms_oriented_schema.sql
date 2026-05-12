-- Shift the new prefixed tenant schema from WhatsApp-oriented naming to SMS-oriented naming.

alter table public."1_business_profiles"
  rename column whatsapp_number to sms_number;

alter table public."1_sessions"
  alter column channel set default 'sms';

alter table public."1_sessions"
  drop constraint if exists one_sessions_channel_check;

alter table public."1_sessions"
  add constraint one_sessions_channel_check
  check (channel in ('sms', 'webchat'));

alter table public."1_system_logs"
  drop constraint if exists one_system_logs_source_check;

alter table public."1_system_logs"
  add constraint one_system_logs_source_check
  check (source in ('edge_function', 'sms_webhook', 'ai_call', 'auth', 'billing', 'cron'));

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
        'sms_number', business.sms_number,
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
