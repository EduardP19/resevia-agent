# Resevia Agent

> An AI receptionist for independent beauty salons — built as a learning project exploring conversational AI, booking automation, and multi-tenant SaaS architecture.

**Status: Under active development. This is a working prototype, not a production-ready product.**

---

## What is this?

Resevia Agent is the AI backend powering **Sophia** — a conversational booking assistant that handles appointment scheduling via SMS for beauty salons. Customers text a salon's number as they normally would; Sophia handles the back-and-forth, checks availability via Cal.com, and books the appointment — no app download, no login required.

The system is designed as a multi-tenant platform: one deployed agent serves multiple salons, with each salon's services, staff, FAQs, and preferences loaded dynamically at runtime.

This repo is the full stack: AI agent logic, Twilio SMS integration, Cal.com booking, Supabase database, and the operator dashboard — all in one Next.js 14 App Router project.

---

## Internal Links

| Link                                                               | Purpose                                                  |
| ------------------------------------------------------------------ | -------------------------------------------------------- |
| [app.resevia.co.uk/dashboard](https://app.resevia.co.uk/dashboard) | Operator console — inbox, conversation history, settings |
| [app.resevia.co.uk/test](https://app.resevia.co.uk/test)           | Simulated SMS test environment (mimics Twilio)           |

---

## Tech Stack

| Layer              | Technology              |
| ------------------ | ----------------------- |
| Framework          | Next.js 14 (App Router) |
| Language           | TypeScript              |
| Database           | Supabase (Postgres)     |
| AI Model           | Google Gemini 2.5 Flash |
| Calendar / Booking | Cal.com API v2          |
| SMS                | Twilio                  |
| Styling            | Tailwind CSS            |

---

## Sophia Sandbox

The **Sophia Sandbox** is the centrepiece of this repo for development and demonstration purposes. It's a dual-screen simulator that runs the full AI conversation loop without touching real SMS or production customer data.

```
┌────────────────────────┐     ┌────────────────────────────┐
│    Customer Screen     │     │       Salon Screen          │
│                        │     │                             │
│  Types a message as a  │────▶│  Sophia generates a draft   │
│  test customer         │     │  response for review        │
│                        │◀────│                             │
│  Receives final reply  │     │  Operator approves / edits  │
│                        │     │  before it's "sent"         │
└────────────────────────┘     └────────────────────────────┘
```

**Two modes:**

- **Manual Approval** — Sophia drafts a reply; the operator reviews and approves before it goes to the customer. Mirrors how a cautious salon owner might want to run things initially.
- **Autonomous** — Sophia replies automatically. No human in the loop.

The sandbox uses the same AI system prompt, the same tool-calling loop, and the same booking logic as the real SMS webhook — making it a reliable way to test without a live Twilio number. Conversations are isolated to a separate `transcripts-sophia-sandbox` table and expire after 3 minutes of inactivity.

---

## How Sophia Works

Each incoming SMS triggers the following sequence:

```
Twilio inbound SMS
  ↓
Identify salon by phone number
  ↓
Load/create customer session
  ↓
Build dynamic system prompt (services, staff, FAQs, booking state)
  ↓
Call Gemini 2.5 Flash with full conversation history
  ↓
Tool call loop (up to 5 iterations):
  - check_availability
  - book_appointment / book_direct
  - confirm_booking
  - cancel_booking / reschedule_booking
  - update_booking_state (to avoid re-asking questions)
  ↓
Manual mode → save draft, notify operator
Autonomous mode → send reply via Twilio
  ↓
Detect handoff phrases → escalate to human if needed
```

---

## Dashboard

The operator console at `/dashboard` gives salon staff visibility into:

- **Inbox** — All active conversations, with unread indicators
- **Sessions** — Full conversation replay per customer
- **Knowledge** — FAQ editor (feeds Sophia's system prompt)
- **Settings** — Salon profile, services, staff, approval mode toggle

---

## Project Structure

```
/app
  /sophia-sandbox          → Dual-screen test UI
  /(dashboard)             → Operator console
  /api
    /sophia-sandbox        → Test session endpoints (message, poll, approve, expire)
    /sms-webhook           → Twilio inbound SMS handler
    /twilio/voice          → Twilio inbound voice handler (auto-SMS to caller)
    /dashboard             → Console data endpoints

/lib
  /agent.ts                → System prompt builder + tool schema
  /ai.ts                   → Gemini wrapper + tool call loop
  /sophia-sandbox.ts       → Sandbox orchestration
  /booking_service.ts      → Cal.com integration (availability, hold, confirm, cancel)
  /tool-handler.ts         → Tool call dispatcher
  /supabase.ts             → Database helpers
  /twilio.ts               → SMS sending
  /handoff.ts              → Human escalation detection

/sql                       → Migration files
/skills                    → Development notes and phase plans
```

---

## Evolution

This project was built in phases, each one adding a meaningful layer:

| Phase | What was built                                                        |
| ----- | --------------------------------------------------------------------- |
| 1     | Infrastructure — Supabase schema, Next.js skeleton, environment setup |
| 2     | Core agent — Gemini integration, system prompt, basic SMS loop        |
| 3     | Booking flow — Cal.com availability checking, hold + confirm pattern  |
| 4     | Multi-tenant routing — per-salon config loaded at runtime             |
| 5     | Sophia Sandbox — dual-screen test UI, polling, manual approval mode   |
| 6     | Dashboard — operator inbox, session replay, FAQ editor, settings      |

The next logical steps would include voice reminders, analytics, a proper onboarding flow for new salons, and production hardening — but those are stretch goals, not current scope.

---

## Current Limitations

This is a prototype. These are known gaps that would need addressing before anything close to production use:

- **Hold expiry** — 10-minute booking holds are not automatically cleaned up if a customer drops off mid-flow. A cron job to release stale holds is missing.
- **Cancel / reschedule** — Sophia can attempt these via tool calls, but they haven't been fully tested end-to-end with a live Cal.com account.
- **Twilio live testing** — The sandbox works well; real SMS with a live Twilio number has had no testing.
- **Handoff notifications** — When Sophia flags a session for human handoff, no external alert (email, Slack, etc.) is sent yet — the session is marked in the database but nothing pings the operator.
- **Auth** — The dashboard has basic session-based auth but no proper onboarding or multi-user role management.
- **Booking flow ordering** — Sophia occasionally asks for a customer's name before confirming availability. A prompt engineering improvement.

---

## Getting Started

To try Sophia without SMS: visit `http://app.resevia.co.uk/sophia-sandbox`.

---

## A Note on Scope

This project was built as a **learning exercise and technical demonstration** — exploring what's possible when you combine an LLM with real booking infrastructure and a multi-tenant data model. The goal was never to race to production, but to build something that actually works end-to-end and is worth showing.

Sophia can hold a real conversation, check real availability, and book real appointments. The gaps listed above are honest, not hidden — and most of them are well-understood problems with clear solutions.
