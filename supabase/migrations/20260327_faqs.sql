-- FAQ entries per salon
create table if not exists faqs (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references business_profiles(id) on delete cascade,
  category text not null,
  question text not null,
  answer text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists faqs_salon_id_idx on faqs(salon_id);

-- RLS: service role bypasses; anon reads own salon rows only
alter table faqs enable row level security;

create policy "faqs_select" on faqs
  for select using (true);

create policy "faqs_all_service_role" on faqs
  for all using (auth.role() = 'service_role');
