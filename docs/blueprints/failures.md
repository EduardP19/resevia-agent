# Failures & Fixes

A record of every significant bug, what caused it, and how it was fixed. Read this before debugging a new issue — it may already be here.

---

## [2026-03-27] "I'm having trouble processing that" after any tool call

**Symptom:** Agent replied with the fallback string on any message that triggered a tool call (availability check, booking). Single-message conversations worked fine.

**Root cause:** `callAI` in `lib/ai.ts` built the Gemini chat history from **all** messages and then also called `sendMessage(lastMessage.content)`. The last message was sent twice. After a tool call, the second `callAI` invocation constructed a history ending on the prior user message, then `sendMessage` sent the tool result as another user-turn — giving Gemini two consecutive `user` role messages with no `model` turn in between. Gemini 2.5-flash returned an empty response in this state, hitting the `reply || fallback` guard.

**Fix:** Changed history construction to `messages.slice(0, -1)` so the last message is only sent once via `sendMessage`. System/tool result messages are prefixed with `[Tool Result]` for clarity.

**File:** `lib/ai.ts` — commit `53b887b`

**Lesson:** Always verify that Gemini chat history alternates user/model. Consecutive same-role turns produce silent failures, not exceptions.

---

## [2026-03-27] Agent passed "next Monday" as a literal string to check_availability

**Symptom:** Availability checks silently returned empty results when the customer used relative dates ("next Monday", "tomorrow", "this Saturday").

**Root cause:** Cal.com `/slots/available` received `startTime: "next MondayT00:00:00Z"` — an invalid ISO string. The axios call either threw (caught silently) or returned no slots. The agent then told the customer nothing was available, even if it was.

**Fix:** Added an explicit rule to the system prompt: *"Always convert relative dates to YYYY-MM-DD before calling any tool. Never pass a relative date string to a tool."* Gemini reliably follows this when stated as a hard rule.

**File:** `lib/prompt.ts` — commit `93e0fc6`

**Lesson:** Gemini will take shortcuts with date formats unless explicitly told not to. State the rule, state the format, state the consequence.

---

## [2026-03-27] Agent refused to name staff members / said "I can't share that information"

**Symptom:** Customer asked "Who does laser hair removal?" or "Is Vicky working there?" — agent deflected instead of answering.

**Root cause:** Workers were not included in the system prompt. The agent had no knowledge of staff and defaulted to a cautious refusal.

**Fix:** `buildSystemPrompt` now accepts a `workers` array. Both webhook routes query the `workers` table and pass the result. Workers are injected as: `- Name: service1, service2, ...`

**File:** `lib/prompt.ts`, `app/api/sms-webhook/route.ts`, `app/api/test/sms/route.ts` — commit `93e0fc6`

**Lesson:** The agent can only answer questions about data it has been given. If something should be answerable, it must be in the system prompt.

---

## [2026-03-27] Eduard's Cal.com event type 404

**Symptom:** API calls to create/check bookings for Eduard returned 404.

**Root cause:** The event type URL `cal.eu/eduard.resevia/service-booking` did not exist. The slug in Cal.com was `eduard-s-calendar`, not `service-booking`.

**Fix:** Updated Eduard's `cal_event_type_id` in the `workers` table to ID `237850` (from `cal.eu/eduard.resevia/eduard-s-calendar`).

**Lesson:** Always verify Cal.com event type slugs via the API (`GET /event-types`) before inserting IDs into the DB. Do not assume the URL matches the configured slug.

---

## [2026-03-27] Service durations calculated from price instead of actual values

**Symptom:** Services were inserted with incorrect durations (calculated as `price / (30/60)` assuming £30/hr rate).

**Root cause:** The actual durations were visible in the salon's service screenshot (in parentheses) but were not used. A calculation was applied instead.

**Fix:** Re-inserted all services using the exact durations from the screenshot.

**Lesson:** Always use source data directly. Don't derive values that are already given.

---

## Pattern: Silent failures from Cal.com errors

Cal.com API errors in `booking_service.ts` are caught at the worker level and return `[]` (for availability) or `{ success: false }` (for bookings). This means the agent never crashes but also never knows *why* a slot wasn't found. When debugging availability issues:
1. Check worker's `cal_event_type_id` is correct
2. Check Cal.com calendar has working hours configured for that date
3. Check the date format being passed is valid ISO 8601
4. Temporarily add `console.log` to the catch block to see the raw Cal.com error

---

## Pattern: Gemini returns empty response (no crash, no reply)

When `response.text()` returns an empty string:
- Check that chat history strictly alternates user/model turns
- Check that the last message sent via `sendMessage` has non-empty content
- Check that Gemini didn't return only a "thinking" part with no text part
- Gemini 2.5-flash thinking models can produce thinking-only responses when confused by conversation state
