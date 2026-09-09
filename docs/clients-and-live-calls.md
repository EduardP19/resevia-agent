# Clients and Live Calls

The client directory is at `/dashboard/clients`. Each salon owns its own client
records, identified by `(salon_id, phone)`. Incoming SMS, WhatsApp and voice use
the same normalised phone number. UK national numbers, international `00`
numbers and WhatsApp prefixes are normalised; withheld and invalid numbers do
not create shared placeholder clients.

Profiles contain first name, last name, email, phone, notes in `metadata`, and
`booking_history` JSON. Existing sessions and bookings are backfilled by the
migration. Booking triggers keep each history entry current on confirmation,
rescheduling, cancellation, expiry and deletion. Each entry includes its service,
start/end timestamps, timezone, staff, status, duration and booking responses.
The history covers bookings stored by Resevia, not external calendar bookings
that have never been imported. Unknown contact fields remain null.

Both agents receive saved contact details plus upcoming and recent bookings.
The shared `update_client_profile` tool saves explicitly supplied contact details
even without a completed booking. Confirming a caller's identity/contact details
remains part of the conversation. Dashboard users can add clients, edit contact
details, and append timestamped notes; removing a note requires confirmation.
Deleting a client profile manually detaches it from existing bookings and
conversations while preserving those records and their transcripts. Routine
booking or session edits do not recreate the deleted profile; a fresh incoming
message, call or booking for the same phone can create a new profile.

Phone calls have separate sessions, identified by Twilio CallSid, so a concurrent
SMS cannot switch a call's routing. The dashboard polls phone transcripts every
two seconds and exposes no composer, approval, mode or completion controls.
The corresponding dashboard mutation endpoints also reject voice sessions.
The bridge serialises events, retries them with stable IDs, and sends a heartbeat
every 30 seconds to prevent idle expiry during a quiet call. Hangup completes the
session and schedules its topic summary. Forwarded calls have no agent transcript.

## Rollout

1. Apply `20260908130000_transcript_channel.sql`,
   `20260908140000_clients.sql` and `20260908150000_client_deletion.sql` to
   Supabase in migration order. The client migration backfills real contact
   records and booking history. It requires the existing workers, bookings and
   voice migrations.
2. Deploy the Next.js app and the `bridge/` service. Both deployments are needed
   for ordered transcript retries and heartbeats. Existing bridge secrets remain
   unchanged.
3. Verify one known client's SMS/WhatsApp conversation and one agent-answered call.
   Confirm the name, profile history, live transcript and hangup state.

## Verification

- `npm run test:clients` runs an isolated PostgreSQL migration test, phone-matching
  and context checks, read-only component checks, access-control checks, and a
  simulated Twilio/Deepgram bridge test. The bridge test needs localhost sockets.
- `npm run build` checks the production compilation and types.
- With `npm run dev` on port 3001, `node tests/dashboard-browser.mjs` checks the
  actual client components using synthetic data. It temporarily installs a
  preview page and removes it afterward. Browser API requests are intercepted;
  no real customer records or messages are changed. It uses Chrome on macOS,
  Playwright Chromium elsewhere, or `PLAYWRIGHT_CHROMIUM_EXECUTABLE` when set.

The browser checks cover the directory, profile save, mobile overflow, live
transcript polling, deduplication and hangup. They do not validate a real carrier
call or Deepgram speech accuracy.
