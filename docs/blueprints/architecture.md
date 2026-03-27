# Architecture Blueprint

## Overview

Resevia is a multi-tenant AI receptionist platform. Each salon is a row in a shared database. The agent handles SMS conversations, checks availability, holds and confirms bookings.

```
Customer SMS → Twilio → /api/sms-webhook → AI (Gemini) → Tool calls → Cal.com / Supabase
```

---

## Multi-Tenancy

**Rule:** One Supabase project, salons as rows in `business_profiles`. All other tables (`workers`, `bookings`, `sessions`, `transcripts`) use `salon_id` as a foreign key.

**Routing:** Incoming Twilio webhooks are matched to a salon via `twilio_number` on `business_profiles`. If no match, falls back to first salon (MVP fallback — remove before scaling).

**Never:** Give each salon its own database or Supabase project. All isolation is handled at the query level via `salon_id`.

---

## Data Model

### `business_profiles`
Core salon config. Fields that the agent reads at runtime:
- `name` — injected into system prompt
- `services` — JSONB array of `{ name, category, duration_minutes, price }`
- `opening_hours`, `location` — injected into system prompt
- `twilio_number` — used for routing

### `workers`
One row per staff member.
- `salon_id` — foreign key
- `name` — shown to customers and injected into system prompt
- `cal_event_type_id` — the Cal.com event type ID for this worker's calendar
- `services` — JSONB array of service name strings they can perform
- `is_active` — soft delete flag

### `bookings`
- `status`: `held` → `confirmed` → `cancelled`
- `cal_booking_uid` — hold phase uses a local `hold_xxx_xxx` UID; replaced with real Cal.com UID on confirm
- `cal_booking_id` — Cal.com integer ID, set on confirm
- `worker_id` — assigned at hold time, not changed on confirm
- `expires_at` — 10 minutes from hold creation (not yet enforced by cron)

### `sessions`
- `status`: `active` → `completed` (on booking confirm) or `handed_over` (on handoff phrase)
- One session per customer visit. A new session is created when the customer contacts again after a `completed` session.

### `transcripts`
- Every message (user, assistant, system/tool) stored here
- `role`: `user` | `assistant` | `system` (system = tool results)

---

## Booking Flow

```
1. Customer asks to book
2. Agent calls check_availability (date + service + optional worker)
   → booking_service queries workers table → Cal.com slots per worker in parallel
   → filters out DB-held/confirmed slots → returns "HH:mm (WorkerName)" strings
3. Customer picks a slot
4. Agent collects name + email
5. Agent calls book_appointment
   → DB-only hold (no Cal.com call at this stage)
   → assigns first worker with no conflict at that start_time
   → generates hold_xxx UID, sets expires_at = +10 min
6. Agent tells customer slot is held for 10 minutes, asks to confirm
7. Customer confirms
8. Agent calls confirm_booking(holdUid)
   → looks up hold + worker → calls Cal.com POST /bookings
   → updates DB: status=confirmed, cal_booking_uid=real UID
   → calls completeSession() → session marked completed
```

**Why DB-only holds:** Cal.com does not have a reliable hold/tentative booking API. Creating a real Cal.com booking at hold time and then deleting it if the customer ghosts creates orphaned calendar entries. The DB hold is local and cheap to expire.

---

## Cancel / Reschedule Flow

**Cancel:** `cancel_booking` tool → `cancelBooking(customerPhone, salonId, serviceName?)`
- Finds next upcoming `confirmed` booking for this customer
- Calls Cal.com `DELETE /bookings/{uid}`
- Updates DB status to `cancelled`

**Reschedule:** `reschedule_booking` tool → `rescheduleBooking(customerPhone, salonId, newDate, newTime, serviceName?)`
- Finds next upcoming confirmed booking
- Calls Cal.com `PATCH /bookings/{uid}/reschedule` with new start time
- Updates DB `start_time` and `end_time`
- Does NOT cancel + rebook — uses Cal.com native reschedule endpoint

---

## Session Lifecycle

- `getOrCreateConversation` reuses an `active` session — so returning customers continue the same thread.
- Session is auto-completed (`completeSession`) when a booking is confirmed. Next contact starts a fresh session.
- Handoff sets session to `handed_over`. Does not auto-complete.

---

## Worker Assignment Logic

When holding a slot, workers are iterated in DB query order. The first worker with no conflict (`held` or `confirmed`) at that exact `start_time` is assigned. This is first-come-first-served, not load-balanced. If round-robin is needed later, sort workers by booking count.

---

## Double-Booking Prevention

Partial unique index on `bookings`:
```sql
CREATE UNIQUE INDEX unique_worker_active_slot
ON bookings(worker_id, start_time)
WHERE status IN ('held', 'confirmed');
```
If two requests race to hold the same worker+slot, the second insert fails. The route catches this and returns "That slot was just taken."

---

## Known Gaps (as of 2026-03-27)

- **Hold expiry cron** — `expires_at` set but no job cleans up stale holds. Implement a Supabase scheduled function or Vercel cron at `/api/cron/expire-holds`.
- **Twilio webhook** — Pending number approval. Not tested end-to-end.
- **Load balancing workers** — Currently first-available. No fairness mechanism.
- **Multi-service booking** — Agent can quote combined price/duration but `book_appointment` only holds one service at a time.
