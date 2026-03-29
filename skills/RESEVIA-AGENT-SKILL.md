---
name: resevia-agent
description: "Build, fix, test, and iterate the Resevia AI Receptionist agent — a multi-tenant SMS booking system for beauty salons. Use this skill whenever working on the resevia-agent codebase, including: prompt engineering, tool calling (check_availability, book_appointment, confirm_booking, cancel_booking, reschedule_booking), Cal.com v2 integration, Supabase data layer, Twilio SMS, Gemini AI chat history, booking flow logic, or the test endpoint. Also triggers for QA testing, conversation simulation, debugging agent responses, or extending functionality. Always read the ANNEX before making changes."
---

# SKILL: Resevia Agent — Build, Fix, Ship

## Purpose

This skill governs all development work on the Resevia AI Receptionist agent. It provides the rules, context, testing strategy, and documentation requirements to pick up from the current state, fix what's broken, and ship a production-ready SMS booking agent.

**Read this entire file before writing any code.**

---

## 1. Project State Summary

### What exists and works (verified 2026-03-27)

| Feature | Status | Notes |
|---|---|---|
| SMS webhook (`/api/sms-webhook`) | Built, untested with real Twilio | Works via test endpoint |
| Test endpoint (`/api/test/sms`) | Working | Primary dev/QA tool |
| Gemini AI integration | Working | gemini-2.5-flash, tool calling functional |
| System prompt builder | Working | Dynamic per-salon, includes workers + services + FAQs + booking state |
| `check_availability` tool | Working | Queries Cal.com per-worker, filters DB conflicts |
| `book_appointment` (hold) | Working | DB-only hold, 10-min expiry set but not enforced |
| `confirm_booking` | Working | Creates real Cal.com booking on confirm |
| `book_direct` | Working | One-step hold+confirm shortcut |
| `update_booking_state` | Working | Persists service/date/time/worker across turns |
| `get_booking_requirements` | Working | Fetches Cal.com booking fields per worker |
| Worker routing | Working | Auto-assigns first available worker |
| Double-booking prevention | Working | Unique index on worker_id + start_time |
| Handoff detection | Working | Exact phrase match, marks session `handed_over` |
| Multi-service price/duration | Working | Sums correctly |
| Relative date conversion | Working | Prompt rule enforces YYYY-MM-DD |
| Supabase persistence | Working | Sessions, transcripts, bookings all stored |

### What is broken or missing

| Issue | Severity | Details |
|---|---|---|
| `cancel_booking` tool | **HIGH** | Declared in agent tools but handler exists — needs end-to-end verification. Cal.com DELETE call may not be wired correctly. |
| `reschedule_booking` tool | **HIGH** | Declared in agent tools, handler exists — needs end-to-end verification. Uses Cal.com PATCH endpoint. |
| Hold expiry cron | **MEDIUM** | `expires_at` is set but no job cleans up stale holds. Slots stay blocked forever if customer ghosts. |
| Twilio live webhook | **MEDIUM** | Not tested with real SMS. Twilio number pending approval. |
| Handoff notification | **MEDIUM** | Session flagged in DB but no outbound alert (email/Slack/dashboard) sent to salon owner. |
| Duration formatting | **LOW** | Agent says "150 minutes" instead of "2 hours 30 minutes". Fix in system prompt. |
| Booking flow order | **LOW** | Agent sometimes collects name/email before checking availability. Should check availability first. |
| Voice agent reminder | **PLANNED** | System prompt template exists but no implementation yet. |
| Dashboard | **MEDIUM** | Exists but has a few bugs e.g. the Manual response Approval shows in UI as waiting for approval but it's sent to the test window at the same time. If I try to manually write something it does not work. |

---

## 2. Architecture Rules (never break these)

1. **Multi-tenancy by row** — One Supabase project. Salons are rows in `business_profiles`. Every query filters by `salon_id`. Never create per-salon databases.
2. **DB-only holds** — Cal.com has no hold API. Holds are local DB records. Cal.com is only called on confirm.
3. **Gemini history via generateContent** — `ai.ts` uses `generateContent` with a manually built `contents` array (including proper `functionCall`/`functionResponse` pairs). This bypasses the SDK's `validateChatHistory` check. Do NOT revert to `startChat + sendMessage` — the current approach is more robust for tool calling flows.
4. **Tool results as text** — After a tool call, save result as `system` role in DB. Pass to Gemini as `[Tool Result] ...` in a user-turn message. No formal `functionResponse` needed.
5. **Cal.com EU endpoint** — Base URL is `https://api.cal.eu/v2`, NOT `api.cal.com`. Header: `cal-api-version: 2024-08-13`.
6. **Service data from DB only** — Never hardcode services/prices. Always pull from `business_profiles.services` at runtime.
7. **Workers in the prompt** — If workers are not injected into the system prompt, the agent refuses to answer staff questions or invents names.
8. **Return 200 to Twilio always** — Even on errors. Otherwise Twilio retries and customers get duplicate messages.
9. **Max 5 tool calls per turn** — The while loop caps at 5 to prevent infinite loops.
10. **Shared tool handler** — Tool dispatch logic lives in `lib/tool-handler.ts`. Both `/api/sms-webhook/route.ts` and `/api/test/sms/route.ts` import `executeToolCall()` from this shared module. Any tool change only needs to be made in one place.

---

## 3. File Map

```
resevia-agent/
├── app/
│   └── api/
│       ├── sms-webhook/route.ts    ← Production Twilio webhook
│       └── test/sms/route.ts       ← Dev/QA test endpoint (no Twilio send)
├── lib/
│   ├── agent.ts                    ← System prompt builder + tool declarations
│   ├── ai.ts                       ← Gemini chat wrapper (callAI)
│   ├── booking_service.ts          ← All Cal.com + booking logic
│   ├── supabase.ts                 ← DB helpers (sessions, transcripts, profiles)
│   ├── twilio.ts                   ← SMS send helper
│   └── handoff.ts                  ← Handoff phrase detection
├── docs/
│   ├── blueprints/
│   │   ├── architecture.md         ← Data model, flows, multi-tenancy
│   │   ├── agent.md                ← Prompt rules, tool design, what works/doesn't
│   │   ├── integrations.md         ← Cal.com, Twilio, Supabase, Gemini patterns
│   │   └── failures.md             ← Bug log with root causes and fixes
│   └── qa-report-YYYY-MM-DD.md    ← QA run results
├── skills/
│   ├── phase-1-infrastructure.md
│   ├── phase-2-core-agent.md
│   ├── phase-3-booking-flow.md
│   ├── phase-6-dashboard.md
│   ├── cal-com-api-reference.md
│   └── voice-agent-reminder-call.md
└── CHANGELOG.md
```

---

## 4. Development Workflow

### Before writing any code

1. Read this SKILL file
2. Read `docs/blueprints/failures.md` — the bug you're about to create might already be documented
3. Read `docs/blueprints/agent.md` — check what works and what doesn't before changing prompt or tools
4. Check the ANNEX at the bottom of this file for the latest session notes

### Making changes

1. **Identify the scope** — Is this a prompt change, a tool change, a route change, or a DB change?
2. **Check both routes** — If touching tool handling, update BOTH `sms-webhook/route.ts` AND `test/sms/route.ts`
3. **Test via the test endpoint first** — `POST /api/test/sms` with `{ "from": "+447700000001", "message": "..." }`
4. **Run the conversation test suite** (Section 5) before considering it done
5. **Log everything** (Section 7)

### After making changes

1. Update the ANNEX with what changed, why, and what was learned
2. If a bug was fixed, add it to `docs/blueprints/failures.md`
3. If a prompt rule was changed, update `docs/blueprints/agent.md`
4. If an integration quirk was discovered, update `docs/blueprints/integrations.md`
5. Run the full QA suite and save results as `docs/qa-report-YYYY-MM-DD.md`

---

## 5. Testing Strategy

### 5.1 — Conversation Test Suite

These are multi-turn conversation scripts. Run each one end-to-end against `/api/test/sms`. Each scenario uses a unique phone number to get a fresh session.

**How to run:** Send messages sequentially, waiting for each response before sending the next. Record every request and response. Compare against expected behaviour.

---

#### TEST 01 — Happy Path Booking

**Goal:** Full booking flow from enquiry to confirmation.

| Turn | Sender | Message |
|---|---|---|
| 1 | Customer | Hi, I'd like to book a wash and blow dry |
| 2 | Agent | _(should ask for date/time)_ |
| 3 | Customer | Next Wednesday at 2pm |
| 4 | Agent | _(should check availability, report slot or alternatives)_ |
| 5 | Customer | Yes, that works |
| 6 | Agent | _(should ask for name and email)_ |
| 7 | Customer | Sarah Jones, sarah@test.com |
| 8 | Agent | _(should book and confirm with price/duration/date/time)_ |

**Pass criteria:**
- Agent converts "Next Wednesday" to YYYY-MM-DD
- Agent calls `check_availability` before asking for personal info
- Agent calls `book_direct` or `book_appointment` + `confirm_booking`
- Confirmation message includes service name, date, time, price
- Duration shown as "1 hour" not "60 minutes"
- Booking record exists in Supabase with status `confirmed`
- Cal.com event created

---

#### TEST 02 — Specific Worker Request

**Goal:** Customer asks for a specific stylist.

| Turn | Sender | Message |
|---|---|---|
| 1 | Customer | Can I book Eduard for a cut and finish? |
| 2 | Agent | _(should ask for date/time)_ |
| 3 | Customer | Friday at 11am |
| 4 | Agent | _(should check availability for Eduard only)_ |

**Pass criteria:**
- `check_availability` called with `workerName: "Eduard"`
- Only Eduard's slots returned (not Sophia or Vicky)
- If Eduard unavailable, agent offers Eduard's next available — not another worker

---

#### TEST 03 — Multi-Service Booking

**Goal:** Customer wants multiple services, agent sums correctly.

| Turn | Sender | Message |
|---|---|---|
| 1 | Customer | I want full head highlights and a wash and blow dry |
| 2 | Agent | _(should quote combined price and duration)_ |

**Pass criteria:**
- Total price = sum of both services
- Total duration = sum of both durations
- Duration formatted as hours/minutes, not raw minutes
- Agent asks for date/time after quoting

---

#### TEST 04 — Service Not Offered

**Goal:** Customer asks for something the salon doesn't do.

| Turn | Sender | Message |
|---|---|---|
| 1 | Customer | Do you do men's haircuts? |
| 2 | Agent | _(should politely decline, mention what is offered)_ |

**Pass criteria:**
- No hallucinated service
- No booking attempt
- Mentions actual services the salon does offer

---

#### TEST 05 — Cancellation

**Goal:** Customer cancels an existing booking.

**Setup:** Create a confirmed booking for `+447700000005` first.

| Turn | Sender | Message |
|---|---|---|
| 1 | Customer | I need to cancel my appointment |
| 2 | Agent | _(should call cancel_booking and confirm cancellation)_ |

**Pass criteria:**
- `cancel_booking` tool called
- Cal.com booking deleted (or DELETE call attempted)
- Supabase booking status updated to `cancelled`
- Agent confirms what was cancelled (service name, date/time)

---

#### TEST 06 — Reschedule

**Goal:** Customer reschedules an existing booking.

**Setup:** Create a confirmed booking for `+447700000006` first.

| Turn | Sender | Message |
|---|---|---|
| 1 | Customer | Can I move my appointment to Thursday at 3pm? |
| 2 | Agent | _(should check availability for new slot, then reschedule)_ |

**Pass criteria:**
- Agent checks availability for new date/time
- `reschedule_booking` tool called with correct `newDate` and `newTime`
- Cal.com booking updated (PATCH call)
- Supabase booking times updated
- Agent confirms new date/time

---

#### TEST 07 — Unhappy Customer / Handoff

**Goal:** Customer escalates, agent triggers handoff.

| Turn | Sender | Message |
|---|---|---|
| 1 | Customer | I've been waiting 30 minutes and no one is here. This is ridiculous. |
| 2 | Agent | _(should apologise and trigger handoff phrase)_ |

**Pass criteria:**
- Agent response contains the exact handoff phrase
- Session status updated to `handed_over` in Supabase

---

#### TEST 08 — Staff Enquiry

**Goal:** Customer asks about staff.

| Turn | Sender | Message |
|---|---|---|
| 1 | Customer | Who does laser hair removal? |
| 2 | Agent | _(should name the correct worker)_ |
| 3 | Customer | Is she available tomorrow? |
| 4 | Agent | _(should ask for preferred time, then check availability for that worker)_ |

**Pass criteria:**
- Agent names the correct worker (Vicky for laser)
- Does not refuse to share staff info
- Availability check filters to the named worker

---

#### TEST 09 — No Availability

**Goal:** Requested slot is not available.

| Turn | Sender | Message |
|---|---|---|
| 1 | Customer | I want a blow dry at 8am on Sunday |
| 2 | Agent | _(should check availability, report nothing available, offer alternatives)_ |

**Pass criteria:**
- Agent doesn't invent availability
- Offers alternative days or times
- Doesn't collect personal info for a nonexistent slot

---

#### TEST 10 — Conversation Recovery

**Goal:** Customer sends confusing or off-topic messages mid-flow.

| Turn | Sender | Message |
|---|---|---|
| 1 | Customer | I want to book a cut |
| 2 | Agent | _(asks for date/time)_ |
| 3 | Customer | Actually what's the weather like there? |
| 4 | Agent | _(should redirect gracefully back to booking, not crash)_ |
| 5 | Customer | Sorry, next Monday at 10am |
| 6 | Agent | _(should continue booking flow with the service already identified)_ |

**Pass criteria:**
- Agent doesn't lose the service from earlier turns
- `update_booking_state` preserves context
- No "I'm having trouble processing that" fallback
- Flow resumes cleanly

---

#### TEST 11 — FAQ Handling

**Goal:** Customer asks a question covered by salon FAQs.

| Turn | Sender | Message |
|---|---|---|
| 1 | Customer | Do you have parking? |
| 2 | Agent | _(should answer using FAQ data if available)_ |

**Pass criteria:**
- Answer matches FAQ content in Supabase
- No placeholder text like "[LINK]" shown raw to customer
- Natural tone, not robotic

---

#### TEST 12 — Returning Customer (Session Lifecycle)

**Goal:** Customer who previously completed a booking contacts again.

**Setup:** Complete TEST 01 first with `+447700000012`.

| Turn | Sender | Message |
|---|---|---|
| 1 | Customer | Hi, I want to book another appointment |
| 2 | Agent | _(should start fresh session, not reference old booking context)_ |

**Pass criteria:**
- New session created (old one stays `completed`)
- Clean booking state (no stale service/date/time from previous session)
- Agent treats it as a new conversation

---

### 5.2 — Automated Checks (run after each QA round)

These are quick DB queries to verify data integrity after running the test suite.

```sql
-- Check for orphaned holds (older than 15 minutes)
SELECT id, service_name, start_time, expires_at, status
FROM bookings
WHERE status = 'held' AND expires_at < NOW();

-- Check for sessions stuck in 'active' after booking confirmed
SELECT s.id, s.status, b.status as booking_status
FROM sessions s
JOIN bookings b ON b.salon_id = s.salon_id AND b.customer_phone = s.customer_phone
WHERE s.status = 'active' AND b.status = 'confirmed';

-- Check for bookings without Cal.com UIDs
SELECT id, status, cal_booking_uid
FROM bookings
WHERE status = 'confirmed' AND (cal_booking_uid IS NULL OR cal_booking_uid LIKE 'hold_%');

-- Check for duplicate worker slots
SELECT worker_id, start_time, COUNT(*)
FROM bookings
WHERE status IN ('held', 'confirmed')
GROUP BY worker_id, start_time
HAVING COUNT(*) > 1;
```

### 5.3 — Edge Case Regression Tests

Run these whenever changing the system prompt or tool declarations:

| Test | What it catches |
|---|---|
| Send empty message `""` | Agent should respond gracefully, not crash |
| Send very long message (500+ chars) | Agent should not truncate or loop |
| Send message with emoji `"I want to book 💇‍♀️"` | Agent should parse intent, not break |
| Send number-only message `"10"` | Agent should ask for context, not assume date/time |
| Send same message twice rapidly | Should not create duplicate sessions or bookings |

---

## 6. Fixing Priority Order

When picking up this project, fix issues in this order:

### Round 1 — Make existing features bulletproof
1. Fix booking flow order: check availability → confirm slot → THEN collect name/email
2. Fix duration formatting: "2 hours 30 minutes" not "150 minutes"
3. Verify `cancel_booking` works end-to-end (tool call → Cal.com DELETE → DB update → agent response)
4. Verify `reschedule_booking` works end-to-end (tool call → Cal.com PATCH → DB update → agent response)
5. Run full test suite (Section 5), fix any failures

### Round 2 — Close infrastructure gaps
6. Implement hold expiry cron (`/api/cron/expire-holds` or Supabase scheduled function)
7. Implement handoff notification (decide channel: email, Slack, or webhook)
8. Refactor tool handling into shared function (eliminate route.ts duplication)
9. Test with real Twilio SMS end-to-end

### Round 3 — Polish and extend
10. Add SMS character limit handling (split long messages properly)
11. Add rate limiting on test endpoint
12. Add error monitoring/alerting
13. Begin voice agent implementation (template exists in `skills/voice-agent-reminder-call.md`)
14. Begin dashboard (Phase 6 spec exists in `skills/phase-6-dashboard.md`)

---

## 7. Documentation Requirements (MANDATORY)

**Every session that touches this codebase must update the ANNEX.**

This is non-negotiable. The ANNEX is the project's institutional memory. When this agent gets rebuilt for a second salon, or when a new developer picks up the codebase, the ANNEX is how they learn what works, what doesn't, and why decisions were made.

### What to log in the ANNEX

For every change, bug fix, or discovery:

```
### [DATE] — [Short title]

**What changed:** [1-2 sentence description]
**Why:** [What triggered this — bug report, QA failure, feature request]
**Files touched:** [List of files modified]
**Outcome:** [Pass/Fail/Partial — what's the result]
**Lesson learned:** [What would you tell the next developer]
**Commit:** [hash if available]
```

### What to log in the QA Report

After each test suite run:

```
# QA Report — [Date]

## Environment
- Endpoint: [test or production]
- Model: [gemini-2.5-flash or other]
- Tests run: [which test numbers]

## Results

| Test | Result | Notes |
|---|---|---|
| TEST 01 | PASS/FAIL | [brief note] |
| ... | ... | ... |

## Bugs Found
[List any new bugs with reproduction steps]

## Regressions
[List any previously-passing tests that now fail]
```

---

## 8. Integration Quick Reference

### Cal.com v2

| Action | Method | Endpoint | Notes |
|---|---|---|---|
| Check slots | GET | `/slots/available?startTime=...&endTime=...&eventTypeId=...` | Response shape varies — use `extractSlotTimes()` |
| Create booking | POST | `/bookings` | Must include `attendee.timeZone` and `attendee.language` inside attendee object |
| Cancel | DELETE | `/bookings/{uid}` | Optional `{ cancellationReason }` body |
| Reschedule | PATCH | `/bookings/{uid}/reschedule` | Pass new `start` time |

**DST rule:** If user says "14:00" during BST (UTC+1), send `13:00:00Z` to Cal.com.

**Workers:**
| Worker | Event Type ID |
|---|---|
| Eduard | 237850 |
| Sophia | 238264 |
| Vicky | 238265 |

**Hold event type:** 238175 (no client emails sent)

### Gemini

- Model: `gemini-2.5-flash` (configurable via `AI_MODEL_NAME`)
- History: `messages.slice(0, -1)` → `startChat({ history })` → `sendMessage(lastMessage)`
- Role mapping: `assistant` → `model`, `system` → filtered out
- Empty response = malformed history (check for consecutive same-role turns)

### Supabase

- Always filter by `salon_id`
- Service role key for all server-side calls
- `bookings.status`: `held` → `confirmed` → `cancelled`
- `sessions.status`: `active` → `completed` → `handed_over`

---

## 9. Known Patterns & Anti-Patterns

### Patterns that work
- Injecting live DB data into system prompt (services, workers, hours)
- Explicit prompt rules for date formatting ("Always convert to YYYY-MM-DD")
- DB-only holds → Cal.com only on confirm
- Optional tool fields (workerName) to prevent over-asking
- `update_booking_state` for context persistence across turns
- Tool loop with max 5 iterations
- `[Tool Result]` prefix for Gemini to understand tool responses

### Anti-patterns (never do these)
- Hardcode services or prices anywhere
- Let agent manage worker routing (always do it in backend code)
- Pass relative dates to tools
- Use `functionResponse` parts with Gemini (plain text works better)
- Include last message in both `history` and `sendMessage`
- Create Cal.com bookings at hold time
- Query across salons without `salon_id` filter
- Assume Cal.com URL slugs match configured slugs (verify via API)
- Derive values (like duration) when source data is available

---

## ANNEX — Session Log

> This section is appended to after every development session. Never delete entries. Newest at the top.

---

### [2026-03-29] — SKILL Audit & Refactor

**What changed:** Full codebase audit against RESEVIA-AGENT-SKILL.md. Identified 8 gaps (G1–G8). Extracted shared tool handler (`lib/tool-handler.ts`) to eliminate route duplication. Hardened system prompt with duration formatting rule ("2 hours 30 minutes" not "150 minutes") and strict booking flow order (no personal data before availability check). Added hold expiry cleanup to the cron job. Updated all blueprint docs to reflect current state.

**Why:** SKILL audit revealed structural gaps between documented rules and actual codebase. Route duplication was the highest-risk item (any tool change required editing two files).

**Files touched:** `lib/tool-handler.ts` (NEW), `app/api/test/sms/route.ts`, `app/api/sms-webhook/route.ts`, `lib/agent.ts`, `app/api/cron/cleanup/route.ts`, `docs/blueprints/agent.md`, `skills/RESEVIA-AGENT-SKILL.md`

**Outcome:** All 8 gaps resolved. Tool handling is now single-source. Prompt enforces correct booking flow order. Hold expiry integrated into existing cleanup cron.

**Lessons learned:**
1. `ai.ts` uses `generateContent` (not `startChat`), which is actually more reliable for tool calling — blueprint docs were outdated
2. The approval mode "bug" in the test harness is actually correct behaviour — the test UI needs to see drafts immediately
3. Hold expiry was the silent infrastructure gap — slots were being blocked forever if customers ghosted mid-flow

**Branch:** `skill-audit-refactor`

---

### [2026-03-27] — QA Round 1 Complete

**What changed:** Fixed 4 critical bugs: tool call duplicate history, relative date passing, missing workers in prompt, wrong Cal.com event type ID for Eduard. Added `update_booking_state` tool for context persistence. Wired `cancel_booking` and `reschedule_booking` tool declarations and route handlers.

**Why:** First full QA run against test endpoint revealed agent failures across booking flow, staff queries, and date handling.

**Files touched:** `lib/ai.ts`, `lib/prompt.ts`, `lib/agent.ts`, `lib/booking_service.ts`, `app/api/sms-webhook/route.ts`, `app/api/test/sms/route.ts`

**Outcome:** 6/6 QA scenarios passed after fixes.

**Lessons learned:**
1. Gemini will take shortcuts with date formats unless explicitly told not to
2. The agent can only answer questions about data injected into the system prompt
3. Always verify Cal.com event type IDs via API before inserting into DB
4. Chat history must strictly alternate user/model turns — violations cause silent empty responses
5. Tool results work fine as plain `[Tool Result]` text — no need for formal function response format

**Commits:** `93e0fc6`, `53b887b`

---

### [2026-03-27] — Cancel and Reschedule handlers wired

**What changed:** Added `cancel_booking` and `reschedule_booking` case handlers in both route files. Tool declarations already existed in `agent.ts`. Backend functions `cancelBooking()` and `rescheduleBooking()` added to `booking_service.ts`.

**Why:** System prompt told agent it could cancel/reschedule but no tool implementation existed. Agent would attempt the call and fail silently.

**Files touched:** `app/api/sms-webhook/route.ts`, `app/api/test/sms/route.ts`, `lib/booking_service.ts`

**Outcome:** Partial — tool handlers wired but not verified end-to-end with a real booking cancellation/reschedule. Needs TEST 05 and TEST 06 from the test suite.

**Lesson learned:** Never declare a tool in the system prompt without implementing the handler. The agent trusts the prompt and will call non-existent tools, causing silent failures.

---

### [2026-03-26] — Phase 2 core agent operational

**What changed:** Full SMS agent loop working: inbound message → Supabase lookup → system prompt build → Gemini AI call → tool execution → response → DB save.

**Why:** Phase 2 milestone — core agent must work before booking flow.

**Files touched:** All `lib/` files, both route files.

**Outcome:** Pass — basic conversation flow works, tool calling works, persistence works.

**Lesson learned:** Model-agnostic wrapper design paid off — switching from Gemini 1.5 to 2.5 Flash required only changing the env var.

---

_End of ANNEX. Add new entries above this line._
