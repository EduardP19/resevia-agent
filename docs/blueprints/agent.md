# Agent Behaviour Blueprint

## Stack

- **Model:** Gemini 2.5 Flash (`gemini-2.5-flash`) via `@google/generative-ai`
- **Tool calling:** Gemini native function declarations
- **Configurable:** `AI_MODEL_NAME` env var — defaults to `gemini-2.5-flash`

---

## System Prompt Rules (what works)

### Inject at runtime, not hardcoded
The system prompt is built in `lib/agent.ts` using live DB data:
- Salon name, hours, location
- Full services list with price and duration
- Workers list with their specialisms
- Today's date (en-GB format) and current time (Europe/London)

This means the agent always has accurate, up-to-date info without redeployment.

### Workers must be in the prompt
If workers are not listed in the system prompt, the agent will say it "can't share staff information" or make up answers. The workers section must include name + services they offer.

Format that works:
```
Team members and their specialisms:
- Sophia: Ladies Cut & Finish, Ladies Wash & Blow Dry, ...
- Eduard: Ladies Cut & Finish, Full Head Highlights, Root Colour, ...
- Vicky: Laser Hair Removal - Face, Laser Hair Removal - Body, Patch Test
```

### Date conversion must be explicit in the rules
The agent will pass relative date strings ("next Monday", "tomorrow") directly to tools unless the system prompt explicitly forbids it. Rule that works:

> **Dates**: Always convert relative dates (e.g. "next Monday", "tomorrow") to YYYY-MM-DD before calling any tool. Never pass a relative date string to a tool.

### Handoff phrase must be exact
The handoff detection (`lib/handoff.ts`) checks for a specific string. The system prompt must instruct the agent to use it verbatim:

> If you cannot help or the customer is unhappy, say exactly: "Let me get the team to help you with this"

### Hold policy must be stated clearly
Without explicit hold instructions, the agent either skips the hold step or doesn't tell the customer about the 10-minute window. What works:

> **Reservation Flow**: When a customer wants to book, always use 'book_appointment' first to HOLD the slot. Tell them the slot is held for 10 minutes and ask for confirmation.
> **Confirmation Flow**: If they confirm, use 'confirm_booking' with the UID provided by the hold tool.

### SMS tone enforcement
Gemini defaults to markdown-heavy, verbose replies. The prompt must include:

> Keep replies short and friendly — this is SMS, not email

---

## Tool Design Rules (what works)

### Keep tools simple — route complexity in code
The AI tools take high-level inputs (`serviceName`, `workerName`). All worker lookup, conflict checking, and Cal.com calls happen in `booking_service.ts`. The agent never iterates workers or handles Cal.com responses directly.

### Optional fields prevent over-asking
`workerName` is optional on `check_availability` and `book_appointment`. If the customer doesn't specify a worker, the agent doesn't ask — it just passes `undefined` and the backend picks the first available.

### Tool names must match intent
The `book_appointment` tool actually creates a DB hold (not a real booking). The name is intentionally kept simple so the agent calls it at the right moment. Using "hold_slot" caused the agent to skip it or call it at wrong times in testing.

---

## Tool Calling Flow (what works)

The `callAI` function is called twice when a tool is used:
1. First call → agent decides to call a tool → route executes it → saves result as `system` message
2. Second call → agent sees tool result in history → composes reply to customer

**Critical:** History passed to Gemini must be `messages.slice(0, -1)` — not all messages. The last message is sent via `sendMessage()`. Including it in both history AND `sendMessage` causes duplicate messages and breaks the tool result flow (see `failures.md`).

**Tool results** are sent to Gemini as plain user-turn text prefixed with `[Tool Result]`. Gemini processes this correctly without needing formal `functionResponse` parts.

---

## What Doesn't Work

| Approach | Problem |
|---|---|
| Gemini `startChat({ history: allMessages })` + `sendMessage(lastMsg)` | Last message is duplicated. After tool calls, two consecutive user turns crash Gemini's response. |
| Hardcoded services in system prompt | Goes stale. Agent quotes wrong prices after DB updates. |
| Telling agent to manage worker routing | Agent loops through workers, makes multiple tool calls, or picks wrong worker. |
| Passing relative dates to tools | Cal.com and DB queries fail silently — date format invalid. Agent gets empty results and loops. |
| Cal.com holds at hold-time | No reliable hold API. Orphaned bookings on ghost. DB-only hold is cleaner. |
| Not listing workers in prompt | Agent refuses to answer staff questions or invents staff members. |
| Minutes as raw numbers (e.g. "150 minutes") | Unnatural for SMS. Should say "2 hours 30 minutes". **Fixed** — Rule #2 in Critical Formatting Rules. |

---

## Pending Prompt Improvements (2026-03-27)

- ~~**Check availability before collecting name/email**~~ — **FIXED 2026-03-29**. Booking flow now explicitly prohibits collecting personal data before slot confirmation.
- ~~**Duration formatting**~~ — **FIXED 2026-03-29**. Rule #2 in Critical Formatting Rules: "Say '2 hours 30 minutes', never '150 minutes'".
- **Handoff notification** — Agent says the phrase but no outbound alert is sent to the team. Decision pending: Slack, email, or dashboard flag.
