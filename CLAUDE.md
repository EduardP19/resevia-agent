# CLAUDE.md — resevia-agent

## Project Purpose

Resevia Agent is the AI core for a multi-tenant SaaS platform that handles SMS/voice-based appointment booking for salons and service businesses. A Gemini-powered agent converses with customers over Twilio SMS/voice, manages bookings via Cal.com, and provides a web dashboard for business owners to monitor conversations and manage their profile.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript 5 — `strict: false` |
| AI/LLM | Google Gemini via `@google/generative-ai` |
| Database | Supabase (PostgreSQL) via `@supabase/supabase-js` |
| SMS/Voice | Twilio |
| Booking | Cal.com REST API |
| Email | Resend API |
| Styling | Tailwind CSS 3 + custom brand theme |
| Validation | Zod |
| Error tracking | Google Cloud Logging |

Dev server runs on **port 3001** (`npm run dev` → `next dev -p 3001`).

Path alias: `@/*` resolves to the project root.

---

## Folder Structure

```
app/
  (dashboard)/          Route group — all routes protected by cookie auth
    dashboard/          Main dashboard pages (home, inbox, sessions, search, history, knowledge, settings)
    layout.tsx          Dashboard shell: sidebars, header, mobile nav, ApprovalProvider
  api/                  API route handlers
    auth/               Login / logout
    dashboard/          Dashboard data endpoints (salon, faqs, inbox, session, approve)
    sms-webhook/        Twilio inbound SMS
    twilio/             Twilio status/voice callbacks
    cron/               Scheduled jobs (cleanup, sms-pricing)
    sophia-sandbox/     Sandbox test environment endpoints
  login/                Unauthenticated login page
  sophia-sandbox/       Sandbox UI

lib/                    Shared server-side modules
supabase/               Supabase CLI project config + migrations (authoritative)
scripts/                Build/utility scripts
skills/                 AI agent skill definitions
docs/                   Internal documentation
middleware.ts           Protects /dashboard/* routes with cookie check
```

---

## Auth

- **Custom cookie-based auth** — not NextAuth, not Supabase Auth.
- Session cookie: `resevia_dashboard_session` (HMAC-SHA256 signed, 8h default or 30d if "remember me").
- All dashboard server components must call `requireDashboardSession()` from `lib/dashboard-auth.ts`.
- Login flow: form POST → `/api/auth/login` → `findDashboardCredential()` → set cookies → redirect.
- Credentials are stored in the `business_profiles` table (`email` + `password` columns) or the `DASHBOARD_TENANT_CREDENTIALS` env var as a fallback.

---

## Database

Supabase (PostgreSQL). All tables are **unprefixed**. The `1_` prefix tables were a temporary experiment and have all been dropped/merged back — do not reference them.

Migrations live in `supabase/migrations/` (managed by Supabase CLI). Never add loose SQL files elsewhere.

### Current tables

| Table | Purpose |
|-------|---------|
| `business_profiles` | Tenant/salon config — name, phone, email, password, agent settings, hours, Twilio creds |
| `sessions` | SMS/voice conversations — status, customer_phone, summary, token tracking |
| `transcripts` | Per-session messages — role (system/assistant/user/draft), content |
| `transcripts-sophia-sandbox` | Sandbox/test UI messages — same as transcripts + `t`, `param` columns |
| `faqs` | FAQ entries — question, answer, category, is_active |
| `workers` | Staff — salon_id, name, role, cal_event_type_id, services[], is_active |
| `bookings` | Cal.com bookings linked to sessions |
| `sms_messages` | SMS cost ledger |
| `pending_notifications` | Deferred owner alert queue — session_id, send_after |
| `system_logs` | Structured server-side logs — level, source, message, metadata |
| `event_logs` | Client event tracking — category, event, tenant_id, session_id, metadata |
| `error_logs` | Server error logs — source, message, stack, context |

Import the shared client: `import { supabase } from '@/lib/supabase'` — never instantiate directly.

---

## Key Library Files

| File | Purpose |
|------|---------|
| `lib/agent.ts` | Gemini system prompt builder + tool/function declarations (8 booking tools) |
| `lib/ai.ts` | Gemini API wrapper — returns `{ reply?, tool_call?, tokens }` |
| `lib/supabase.ts` | All DB query functions (sessions, transcripts, profiles, FAQs, bookings) |
| `lib/dashboard-auth.ts` | Cookie auth — `requireDashboardSession()`, `getDashboardSession()`, `findDashboardCredential()` |
| `lib/deferred-notifications.ts` | 60-second delayed owner alerts via `pending_notifications` table |
| `lib/profile-cache.ts` | 5-min in-memory TTL cache for tenant business profiles |
| `lib/twilio.ts` | Twilio SMS/voice integration |
| `lib/booking_service.ts` | Cal.com booking logic |
| `lib/owner-email-notifications.ts` | Resend email alerts for business owners |
| `lib/error-logger.ts` | Google Cloud Logging error handler |
| `lib/logger.ts` | `safeLog()` — structured server-side logging |
| `lib/client-events.ts` | `trackClientEvent()` — client-side event tracking |

---

## Component Conventions

- **Server components** handle data fetching (async functions, direct Supabase calls via `lib/supabase.ts`).
- **Client components** handle interactivity (`'use client'`, `useState`/`useEffect`).
- Dashboard pages export `revalidate = 0` — no caching.
- Forms use controlled inputs with `useState`, validated with `.trim()` before submit.
- API calls from client components: `fetch('/api/dashboard/...')` with `Content-Type: application/json` — plain `fetch` + `JSON.stringify`, no custom wrapper.
- Client components never call Supabase directly — always go through `/api/dashboard/*` endpoints.

---

## Logging & Analytics

- **Server-side:** `safeLog()` from `lib/logger.ts` — structured JSON with `level`, `category`, `event`, context (`tenant_id`, `session_id`). Never use `console.log`.
- **Client-side:** `trackClientEvent()` from `lib/client-events.ts` — call before/after meaningful user actions.

---

## Styling

Tailwind CSS 3 with a custom brand palette in `tailwind.config.js`:

- **Purple (primary):** `brand-purple` #6D28D9, `brand-purple-mid` #7C3AED, `brand-purple-light` #8B5CF6
- **Gold (accent):** `brand-gold` #C9A96E, `brand-gold-light` #D4B483
- **Dark/bg:** `brand-deep` #271549, `brand-cream` #FBF5E9
- **Gradients:** `bg-brand-gradient`, `bg-brand-gradient-soft`, `bg-sidebar-gradient`
- **Shadows:** `shadow-brand`, `shadow-brand-lg`, `shadow-gold`, `shadow-card`, `shadow-card-hover`
- **Fonts:** `font-sans` (Plus Jakarta Sans), `font-display` (Montserrat)

Use inline `style` prop only for gradients/shadows that can't be expressed as Tailwind classes.

---

## Rules

1. Always call `requireDashboardSession()` in dashboard server components — never skip it.
2. Use `safeLog()` on the server. Never `console.log`.
3. Use `trackClientEvent()` for user-facing actions in client components.
4. New migrations go in `supabase/migrations/` with Supabase CLI timestamp format.
5. Import `supabase` from `lib/supabase.ts` — never instantiate the client elsewhere.
6. Client components fetch `/api/dashboard/*` — never query Supabase directly from the browser.
7. Use `@/` path alias over relative imports.
8. TypeScript `strict` is `false` — keep it that way; don't tighten per-file.
9. For deferred/delayed notifications, use `lib/deferred-notifications.ts` — don't implement ad-hoc timers.
10. Dev server is on port 3001 — don't change it.
