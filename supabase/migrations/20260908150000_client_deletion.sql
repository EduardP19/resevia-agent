alter table public.sessions
  drop constraint if exists sessions_client_fk;

alter table public.sessions
  add constraint sessions_client_fk
  foreign key (salon_id, client_id)
  references public.clients(salon_id, id)
  on delete set null (client_id);

alter table public.bookings
  drop constraint if exists bookings_client_fk;

alter table public.bookings
  add constraint bookings_client_fk
  foreign key (salon_id, client_id)
  references public.clients(salon_id, id)
  on delete set null (client_id);

create or replace function public.link_session_client()
returns trigger language plpgsql security definer set search_path = public as $$
declare normalized_new text;
begin
  if new.channel in ('sms', 'whatsapp', 'voice')
     and coalesce(new.metadata->>'source', '') <> 'sophia-sandbox' then
    normalized_new := public.normalize_client_phone(new.client_identifier);

    if tg_op = 'UPDATE'
       and new.client_id is null
       and new.salon_id is not distinct from old.salon_id
       and normalized_new is not distinct from public.normalize_client_phone(old.client_identifier) then
      if normalized_new is not null then
        new.client_identifier := normalized_new;
      end if;
      return new;
    end if;

    new.client_id := public.ensure_client(new.salon_id, new.client_identifier);
    if new.client_id is not null then
      new.client_identifier := normalized_new;
    end if;
  else
    new.client_id := null;
  end if;
  return new;
end;
$$;

create or replace function public.link_booking_client()
returns trigger language plpgsql security definer set search_path = public as $$
declare full_name text; contact_email text; normalized_new text;
begin
  normalized_new := public.normalize_client_phone(new.customer_phone);

  if tg_op = 'UPDATE'
     and new.client_id is null
     and new.salon_id is not distinct from old.salon_id
     and normalized_new is not distinct from public.normalize_client_phone(old.customer_phone) then
    if normalized_new is not null then
      new.customer_phone := normalized_new;
    end if;
    return new;
  end if;

  new.client_id := public.ensure_client(new.salon_id, new.customer_phone);
  if new.client_id is null then return new; end if;
  new.customer_phone := normalized_new;
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

revoke all on function public.link_session_client() from public;
revoke all on function public.link_booking_client() from public;
