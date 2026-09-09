-- Allow a booking with no email address.
--
-- Cal.com identifies an attendee by *either* an email or a phone number, and we
-- are moving to the phone: it comes from the live session on every channel, so
-- there is nothing to ask a client for, and with no address on the booking Cal
-- sends the client no mail at all — including the cancellation and reschedule
-- notices it offers no way to disable.
--
-- `client_email` was NOT NULL, which is what forced the `client@example.com`
-- placeholder on every voice booking. A booking genuinely without an email
-- should say so rather than carry a reserved domain that silently blackholes.
--
-- The clients sync triggers already normalise a blank address
-- (`nullif(lower(trim(new.client_email)), '')`), so null needs no further
-- handling downstream.
alter table public.bookings
  alter column client_email drop not null;

comment on column public.bookings.client_email is
  'Attendee email, when one was collected. Null when Cal.com identifies the attendee by phone number instead — see CAL_ATTENDEE_IDENTIFIER.';
