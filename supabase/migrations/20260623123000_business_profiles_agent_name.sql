alter table public.business_profiles
  add column if not exists agent_name text;

comment on column public.business_profiles.agent_name
  is 'Tenant-customisable display name for the booking assistant. The app falls back to Sophia when blank.';
