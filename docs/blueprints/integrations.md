# Integrations Blueprint

## Cal.com

**API version:** v2 (`https://api.cal.eu/v2`)
**Auth:** Bearer token via `CAL_COM_API_KEY` env var
**Required header:** `cal-api-version: 2024-08-13`

### Per-worker event types
Each worker has their own Cal.com event type. The `cal_event_type_id` is stored on the `workers` table row. When confirming a booking, the worker's event type is used — not a shared one.

**Workers (Amo Hair Salon):**
| Worker | Cal.com URL | Event Type ID |
|---|---|---|
| Sophia | `cal.eu/eduard.resevia/sophia-s-calendar` | 238264 |
| Eduard | `cal.eu/eduard.resevia/eduard-s-calendar` | 237850 |
| Vicky | `cal.eu/eduard.resevia/vicky-s-calendar` | 238265 |

### Endpoints used

| Action | Method | Endpoint |
|---|---|---|
| Check availability | GET | `/slots/available?startTime=...&endTime=...&eventTypeId=...` |
| Create booking (confirm) | POST | `/bookings` |
| Cancel booking | DELETE | `/bookings/{uid}` |
| Reschedule booking | PATCH | `/bookings/{uid}/reschedule` |

### Availability response format
The slots response can come back in two shapes — always use `extractSlotTimes()` in `booking_service.ts` to normalise:
- Array: `[{ time: "..." }, ...]`
- Date-keyed object: `{ "2026-03-27": [{ time: "..." }, ...] }`

### Known quirks
- **No hold/tentative API** — Cal.com v2 has no way to tentatively reserve a slot. This is why we use DB-only holds and only call Cal.com on confirm.
- **`service-booking` event type did not exist** — When setting up Eduard's calendar, the URL `cal.eu/eduard.resevia/service-booking` returned 404 from the API. The correct slug was `eduard-s-calendar`.
- **EU subdomain** — The API base is `api.cal.eu`, not `api.cal.com`. Using the `.com` endpoint returns auth errors.
- **Cancellation body** — `DELETE /bookings/{uid}` accepts an optional body `{ cancellationReason: "..." }` — pass this for audit trail.

---

## Supabase

**Client:** `@supabase/supabase-js` via `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
**Pattern:** Service role key used server-side only (Next.js API routes). Never expose to client.

### Key functions (`lib/supabase.ts`)

| Function | Purpose |
|---|---|
| `getSalonBySmsNumber(smsNumber)` | Route incoming SMS to correct salon by Twilio number |
| `getOrCreateConversation(salonId, phone)` | Load or start a session |
| `getTranscriptHistory(sessionId)` | Load messages for AI context |
| `saveMessage(sessionId, role, content)` | Persist each message |
| `completeSession(salonId, phone)` | Mark session completed on booking confirm |
| `getSessionTranscript(sessionId)` | Dashboard: all messages in one session |
| `getClientSessions(salonId, phone)` | Dashboard: all sessions for a customer |
| `getSalonSessions(salonId, limit)` | Dashboard: inbox/overview for a salon |

### Schema rules
- All tables have `salon_id` — always filter by it, never query cross-salon.
- `bookings.status` is the source of truth: `held` → `confirmed` → `cancelled`.
- `sessions.status`: `active` → `completed` or `handed_over`.
- Unique index on `bookings(worker_id, start_time) WHERE status IN ('held','confirmed')` prevents double-booking.

### Migrations
Migrations live in `supabase/migrations/`. Always apply via MCP (`mcp__supabase__apply_migration`) or Supabase CLI — never make schema changes directly in the dashboard without adding a migration file.

---

## Twilio

**Status:** Pending number approval (as of 2026-03-27). SMS routing untested end-to-end.

**Webhook endpoint:** `POST /api/sms-webhook`
**Payload:** Form data — `Body` (message text), `From` (customer number), `To` (salon's Twilio number)
**Response:** Must return `<Response></Response>` with `Content-Type: text/xml` — even on error — otherwise Twilio retries.

**Routing:** `To` number is matched against `business_profiles.twilio_number`. One Twilio number per salon.

**Sending replies:** `lib/twilio.ts` wraps `client.messages.create()`. Test endpoint (`/api/test/sms`) returns JSON and skips the Twilio send step.

---

## Gemini (Google AI)

**Package:** `@google/generative-ai`
**Model:** `gemini-2.5-flash` (configurable via `AI_MODEL_NAME` env var)
**Auth:** `AI_MODEL_API_KEY` env var

### Chat history pattern
```typescript
// CORRECT — slice to exclude last message, send it via sendMessage
const chat = model.startChat({
  history: messages.slice(0, -1).filter(m => m.role !== 'system').map(...)
});
const result = await chat.sendMessage(lastMessage.content);

// WRONG — duplicates the last message
const chat = model.startChat({ history: messages.map(...) });
const result = await chat.sendMessage(lastMessage.content);
```

### Tool result injection
After a tool call, the result is saved as a `system` role message in the DB and passed back to Gemini as a plain text user-turn message prefixed with `[Tool Result]`. Formal `functionResponse` parts are not required — this works reliably with 2.5-flash.

### Role mapping
Gemini uses `user` / `model`. Our DB uses `user` / `assistant` / `system`.
- `assistant` → `model`
- `user` → `user`
- `system` → filtered out of history (sent as last message via `sendMessage` instead)

### Known quirks
- **Thinking models** — 2.5-flash is a thinking model. If the response has only a thinking part and no text part, `response.text()` returns empty string, triggering the fallback reply. This typically happens when the conversation history is malformed (e.g. two consecutive user turns).
- **Consecutive user turns** — Gemini 2.5-flash will silently return an invalid/empty response if the chat history has two `user` role turns in a row with no `model` turn in between.
