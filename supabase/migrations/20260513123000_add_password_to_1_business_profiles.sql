-- Add tenant dashboard password storage.
-- Store a password hash here, not a plaintext password.

alter table public."1_business_profiles"
  add column if not exists password text;

comment on column public."1_business_profiles".password
  is 'Hashed dashboard password for the tenant; never store plaintext.';
