-- Merge 1_business_profiles into business_profiles.
-- email: dashboard login email and owner notification address
-- password: dashboard login password (plain or sha256: prefixed)

alter table public.business_profiles
  add column if not exists email    text,
  add column if not exists password text;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = '1_business_profiles'
  ) then
    update public.business_profiles bp
    set
      email    = src.email,
      password = src.password
    from public."1_business_profiles" src
    where bp.id = src.id;

    drop table public."1_business_profiles" cascade;
  end if;
end $$;
