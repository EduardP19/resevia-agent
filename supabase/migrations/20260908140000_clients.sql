create or replace function public.normalize_client_phone(raw text)
returns text language plpgsql immutable set search_path = public as $$
declare phone text;
begin
  phone := regexp_replace(regexp_replace(trim(raw), '^whatsapp:', '', 'i'), '[[:space:]().-]', '', 'g');
  if phone like '00%' then phone := '+' || substr(phone, 3); end if;
  if phone ~ '^0[1-9][0-9]{9}$' then phone := '+44' || substr(phone, 2); end if;
  if phone ~ '^\+[1-9][0-9]{7,14}$' then return phone; end if;
  return null;
end;
$$;

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.business_profiles(id) on delete cascade,
  first_name text,
  last_name text,
  email text,
  phone text not null,
  booking_history jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (salon_id, phone),
  unique (salon_id, id),
  check (public.normalize_client_phone(phone) is not null and phone = public.normalize_client_phone(phone)),
  check (jsonb_typeof(booking_history) = 'array'),
  check (jsonb_typeof(metadata) = 'object')
);
alter table public.clients enable row level security;
revoke all on public.clients from anon, authenticated;
grant all on public.clients to service_role;

alter table public.sessions add column client_id uuid;
alter table public.sessions add constraint sessions_client_fk
  foreign key (salon_id, client_id) references public.clients(salon_id, id);
alter table public.bookings add column client_id uuid;
alter table public.bookings add constraint bookings_client_fk
  foreign key (salon_id, client_id) references public.clients(salon_id, id);
create index sessions_client_idx on public.sessions(client_id, created_at desc);
create index bookings_client_idx on public.bookings(client_id, start_time desc);

create or replace function public.ensure_client(tenant uuid, raw_phone text)
returns uuid language plpgsql security definer set search_path = public as $$
declare normalized text := public.normalize_client_phone(raw_phone); result uuid;
begin
  if tenant is null or normalized is null then return null; end if;
  insert into public.clients(salon_id, phone) values (tenant, normalized)
    on conflict (salon_id, phone) do nothing;
  select id into result from public.clients where salon_id = tenant and phone = normalized;
  return result;
end;
$$;

create or replace function public.link_session_client()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.channel in ('sms', 'whatsapp', 'voice')
     and coalesce(new.metadata->>'source', '') <> 'sophia-sandbox' then
    new.client_id := public.ensure_client(new.salon_id, new.client_identifier);
    if new.client_id is not null then
      new.client_identifier := public.normalize_client_phone(new.client_identifier);
    end if;
  else
    new.client_id := null;
  end if;
  return new;
end;
$$;
create trigger link_session_client before insert or update of salon_id, client_identifier, channel
  on public.sessions for each row execute function public.link_session_client();

create or replace function public.link_booking_client()
returns trigger language plpgsql security definer set search_path = public as $$
declare full_name text; contact_email text;
begin
  new.client_id := public.ensure_client(new.salon_id, new.customer_phone);
  if new.client_id is null then return new; end if;
  new.customer_phone := public.normalize_client_phone(new.customer_phone);
  full_name := nullif(regexp_replace(trim(new.client_name), '[[:space:]]+', ' ', 'g'), '');
  if lower(full_name) in ('client', 'customer', 'unknown') then full_name := null; end if;
  contact_email := nullif(lower(trim(new.client_email)), '');
  if contact_email = 'client@example.com' then contact_email := null; end if;

  -- Fill missing contact details; later status changes must not overwrite owner edits.
  update public.clients set
    first_name = coalesce(first_name, split_part(full_name, ' ', 1)),
    last_name = coalesce(last_name, nullif(substr(full_name, length(split_part(full_name, ' ', 1)) + 2), '')),
    email = coalesce(email, contact_email),
    updated_at = now()
  where id = new.client_id;
  return new;
end;
$$;
create trigger link_booking_client before insert or update on public.bookings
  for each row execute function public.link_booking_client();

create or replace function public.sync_client_booking_history()
returns trigger language plpgsql security definer set search_path = public as $$
declare entry jsonb; staff_name text;
begin
  if tg_op <> 'INSERT' then
    if tg_op = 'DELETE' or old.client_id is distinct from new.client_id then
      update public.clients c set booking_history = coalesce(
        (select jsonb_agg(item) from jsonb_array_elements(c.booking_history) item
         where item->>'booking_id' <> old.id::text), '[]'::jsonb), updated_at = now()
        where c.id = old.client_id;
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if new.client_id is null then return new; end if;
  select name into staff_name from public.workers where id = new.worker_id and salon_id = new.salon_id;
  entry := jsonb_build_object(
    'booking_id', new.id, 'service', new.service_name,
    'start_time', new.start_time, 'end_time', new.end_time,
    'timezone', 'Europe/London', 'duration_minutes', new.duration_minutes,
    'worker_id', new.worker_id, 'worker_name', staff_name,
    'status', new.status, 'cal_booking_uid', new.cal_booking_uid,
    'created_at', new.created_at, 'details', coalesce(new.responses, '{}'::jsonb)
  );
  -- Update the locked client row directly so concurrent bookings cannot lose an entry.
  update public.clients c set booking_history = coalesce(
    (select jsonb_agg(item) from jsonb_array_elements(c.booking_history) item
     where item->>'booking_id' <> new.id::text), '[]'::jsonb) || jsonb_build_array(entry),
    updated_at = now() where c.id = new.client_id;
  return new;
end;
$$;
create trigger sync_client_booking_history after insert or update or delete on public.bookings
  for each row execute function public.sync_client_booking_history();

-- Backfill real contacts and all existing bookings through the same triggers.
update public.sessions set client_identifier = client_identifier
  where channel in ('sms', 'whatsapp', 'voice') and coalesce(metadata->>'source', '') <> 'sophia-sandbox';
do $$
declare booking record;
begin
  for booking in select id from public.bookings order by created_at desc, id loop
    update public.bookings set customer_phone = customer_phone where id = booking.id;
  end loop;
end;
$$;

revoke all on function public.ensure_client(uuid, text) from public;
revoke all on function public.link_session_client() from public;
revoke all on function public.link_booking_client() from public;
revoke all on function public.sync_client_booking_history() from public;
grant execute on function public.ensure_client(uuid, text) to service_role;

create unique index sessions_voice_call_sid_idx on public.sessions(salon_id, (metadata->>'voice_call_sid'))
  where channel = 'voice' and metadata->>'voice_call_sid' is not null;
