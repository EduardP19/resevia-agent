# CLAUDE.md — resevia-agent

## Project Purpose

Resevia Agent is the AI core for a multi-tenant SaaS platform that handles SMS/WhatsApp/voice-based appointment booking for salons and service businesses. A Gemini-powered agent converses with customers over Twilio SMS, WhatsApp, and voice, manages bookings via Cal.com, and provides a web dashboard for business owners to monitor conversations and manage their profile.

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
    dashboard/          Dashboard data endpoints (salon, faqs, inbox, session, approve, initiate)
    sms-webhook/        Twilio inbound SMS
    whatsapp-webhook/   Twilio inbound WhatsApp (shares lib/inbound-handler.ts)
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
| `business_profiles` | Tenant/salon config — name, phone, email, password, agent settings, hours, Twilio creds, `twilio_number` (SMS) + `whatsapp_number` (WhatsApp senders) |
| `sessions` | SMS/WhatsApp/voice conversations — `channel` (sms/whatsapp/webchat/voice, authoritative), `status`, `client_identifier` (the customer's phone), `summary`, token tracking. Auto-expired — see Session Lifecycle below |
| `transcripts` | Per-session messages — role (system/assistant/user/draft), content. Content only; all SMS/Twilio metadata lives in `costs` |
| `transcripts-sophia-sandbox` | Sandbox/test UI messages — same as transcripts + `t`, `param` columns |
| `faqs` | FAQ entries — question, answer, category, is_active |
| `workers` | Staff — salon_id, name, role, cal_event_type_id, services[], is_active |
| `bookings` | Cal.com bookings linked to sessions |
| `costs` | **Every cost, one row per billable event** — AI, SMS, WhatsApp and voice alike. Also the per-message delivery ledger and the Twilio-SID dedupe index (`reference`). See Costs below. Links to content via `transcript_id` |
| `pending_notifications` | Deferred owner alert queue — session_id, send_after |
| `app_logs` | **All** app-side logs — one row per event, discriminated by `type` (see Logging below). Replaced `system_logs` / `event_logs` / `error_logs`, which were dropped in `20260811130000` |


Import the shared client: `import { supabase } from '@/lib/supabase'` — never instantiate directly.

**The shared client sets `cache: 'no-store'`, and that matters.** Next patches global fetch and supabase-js sits on top of it, so without this reads inside route handlers get served from Next's fetch cache — a spend check kept seeing a tenant's old cost limit for minutes after it changed, while a direct call to the same endpoint returned the new value. Don't remove it, and don't create a second client without it.

---

## Channels (SMS / WhatsApp / Voice)

Each session has a `channel` column (`'sms' | 'whatsapp' | 'webchat' | 'voice'`, default `'sms'`) — the **authoritative routing field**. (The legacy `platform` free-text column was dropped in `20260805140000`.)

- **Inbound:** Twilio SMS hits `/api/sms-webhook`; WhatsApp hits `/api/whatsapp-webhook`. Both delegate to `handleInboundMessage(req, channel)` in `lib/inbound-handler.ts` (single shared pipeline). WhatsApp inbound carries a `whatsapp:` prefix on `From`/`To` — the handler strips it. The customer's reply always continues on the channel it arrived on.
- **Outbound replies** (auto reply, approved draft, manual takeover) go through `sendOnChannel(session.channel, …)` — never call `sendSMS` directly in channel-aware paths.
- **Initiation (business-initiated outreach):** owner-triggered from the dashboard via `/api/dashboard/initiate`. WhatsApp initiation **must** use a pre-approved Twilio Content template (`sendWhatsAppTemplate`, `contentSid` from `TWILIO_WHATSAPP_TEMPLATE_SID`) because it's outside the 24h window. SMS initiation is free-form. **If WhatsApp send fails or the tenant has no `whatsapp_number`, it falls back to a free-form SMS** and tags the session `channel='sms'`.
- **Missed-call follow-up:** `/api/twilio/voice` is the canonical inbound voice webhook (always hangs up — no IVR). On a missed call it attempts the same WhatsApp template **first**, falling back to free-form SMS on failure/no WA number, via the shared `sendMissedCallFollowup()` helper in that route file (same fallback pattern as `/api/dashboard/initiate`). The session is tagged with whichever channel actually delivered. There used to be a duplicate `/api/voice` route — it was removed; `/api/twilio/voice` is the only one registered with Twilio.
- **Missed-call SMS fallback text:** `renderMissedCallSms()` in `app/api/twilio/voice/route.ts` renders `{{agent}}`/`{{salon}}` tokens per-tenant (`getAgentName()` / `business_profiles.name`). Override the template via `TWILIO_INBOUND_CALL_SMS_BODY` using the same token syntax.
- **Template variables:** the initiation template has a single named variable `{{agent}}`, always populated server-side from `business_profiles.agent_name` (via `getAgentName()`) — never client-supplied. If a template with more/different variables is added later, extend `contentVariables` in `app/api/dashboard/initiate/route.ts` accordingly.
- **Per-tenant template override:** `business_profiles.whatsapp_template_sid` overrides the global `TWILIO_WHATSAPP_TEMPLATE_SID` env var when set (passed as `contentSid` to `sendWhatsAppTemplate()`); `whatsapp_template_preview` is the per-tenant equivalent of `NEXT_PUBLIC_WHATSAPP_TEMPLATE_PREVIEW`. Both columns are nullable — leave unset to keep using the global env vars. Used by both `/api/twilio/voice` (missed-call follow-up) and `/api/dashboard/initiate`. Booking confirmations use their own template: `business_profiles.whatsapp_booking_confirmation_template_sid` or `TWILIO_WHATSAPP_BOOKING_CONFIRMATION_TEMPLATE_SID`.
- **Per-tenant senders:** `business_profiles.twilio_number` (SMS) and `business_profiles.whatsapp_number` (WhatsApp). Both reuse the same per-tenant `twilio_account_sid` / `twilio_auth_token`. Both are provisioned by Resevia, not by tenants: the dashboard neither shows nor edits them, and `/api/dashboard/salon` rejects `twilio_number` / `whatsapp_number` (along with `name` and `opening_hours`) — set them in the DB. In practice both columns hold the same number.
- **Env:** `TWILIO_WHATSAPP_NUMBER` (fallback sender), `TWILIO_WHATSAPP_TEMPLATE_SID` (initiation template), `NEXT_PUBLIC_WHATSAPP_TEMPLATE_PREVIEW` (owner-facing preview text of that template).
- WhatsApp usage counts toward the monthly plan allowance (same as SMS/voice/web).

---

## Voice channel

`business_profiles.voice_mode` decides what happens to an inbound call. It is a live routing switch owned by the tenant (Settings → Phone Calls), saved on change rather than behind the page's Save button.

| Mode | TwiML | Effect |
|---|---|---|
| `reject` (default) | `<Reject>` | Hang up, then send the missed-call WhatsApp/SMS follow-up in `waitUntil`. The behaviour every tenant had before voice existed. |
| `forward` | `<Dial>` | Ring `voice_forward_number` (E.164). The agent is not involved. |
| `agent` | `<Connect><Stream>` | Hand the live call to the Deepgram voice agent through `/api/voice/bridge`. |

The salon lookup in `/api/twilio/voice` now happens **before** the TwiML, because the mode decides what the TwiML is. That's one indexed read against Twilio's 15s deadline; everything slow still runs after the response.

**A misconfigured mode falls back to `reject`, never to silence** — `forward` with no `voice_forward_number`, or `agent` with no `DEEPGRAM_API_KEY`, downgrades and logs `voice_mode_downgraded`. A dropped call is worse than a declined one, because the reject path at least texts the caller back.

### The bridge

`/api/voice/bridge` is a WebSocket (Vercel Fluid, `experimental_upgradeWebSocket`) sitting between Twilio Media Streams and Deepgram. It exists for two reasons: Twilio's `<Stream>` cannot set the `Authorization` header Deepgram's socket requires, and the call's tenant/session context has to live somewhere.

- Both sides are configured for **mu-law @ 8kHz**, so audio is a byte passthrough — no resampling. Deepgram's own docs sample uses `linear16` @ 48k/24k; that's the raw-WebSocket format and is wrong for telephony.
- Context arrives as `<Parameter>` children of `<Stream>` (`salonId`, `sessionId`, `from`), surfaced in the stream's `start` frame. The session is created by the webhook *before* the TwiML — the bridge has no request to resolve it from.
- Inbound audio is **buffered** until Deepgram acknowledges `SettingsApplied`, so the caller's opening words survive the setup round trip.
- `UserStartedSpeaking` → send Twilio `{event:'clear'}`. Without this the caller talks over audio queued seconds ago.
- `ConversationText` is written to `transcripts`, so calls appear in the inbox next to text threads.

### One agent, three channels

`buildSystemPrompt(salon, workers, faqs, bookingState, { channel: 'voice' })` swaps **only** the medium-specific blocks — "over the phone", no 160-character cap, no markdown, spoken numbers/dates, read the email back. Booking flow, guardrails, FAQs and salon data are identical. The 8 tool schemas are reused verbatim: Gemini's `SchemaType` members are already the lowercase JSON Schema type names, so `deepgramFunctions()` only unwraps the `functionDeclarations` array.

Deepgram owns the LLM loop, so there is **no way to swap the system prompt mid-call**. Where the text pipeline reacts to `update_booking_state` by rebuilding the prompt, `runVoiceToolCall()` persists to `sessions.metadata.booking_state` and spells the locked fields back out in the tool result — that string is the only channel the model has for learning what's settled.

### Cal.com identifies attendees by email or phone

`CAL_ATTENDEE_IDENTIFIER` (`email` default, or `phone`). Cal's v2 API only
requires "at least one contact method", so phone works — and the number already
comes from the live session on every channel, so nothing extra is collected.

With no address on the booking Cal sends the client **nothing**, which is the only
way to stop its cancellation and reschedule emails ([#13947](https://github.com/calcom/cal.com/issues/13947)
was closed as not planned, and `disableStandardEmails` is org-only — this account
has `organizationId: null`).

**Enable in this order**, or bookings break: set each worker's Cal event type to
identify attendees by Phone *first*; only then flip the env var. While an event
type still marks email required, a phone-only booking is rejected with
`responses - {email}error_required_field` — verified against the live instance.
Keep Cal's SMS reminder workflows off, or the client gets Cal's text on top of
`sendBookingConfirmation()`.

Under `phone`, `bookings.client_email` is null (the `NOT NULL` and the
`client@example.com` placeholder were dropped in `20260909152000`).

### No email on voice — the confirmation goes to the caller's number

The voice agent never asks for an email address: reading one back over a phone line is slow and gets it wrong. `get_booking_requirements` hides the `email` field on voice, `book_direct` fills it from the client record when one exists (otherwise Cal.com's placeholder stands), and the written confirmation goes to the number the caller rang from.

`sendBookingConfirmation()` ([lib/booking-confirmation.ts](lib/booking-confirmation.ts)) does that send — WhatsApp first, SMS if WhatsApp doesn't confirm, the same shape as the missed-call follow-up. Two things to know:

- The WhatsApp send is **free-form**, so it only lands inside the 24h customer-service window. A caller who has never messaged the salon on WhatsApp is outside it, which makes the SMS fallback the normal path rather than the exception.
- The outcome is written back to `clients.whatsapp_available` (`null` unknown / `true` confirmed / `false` failed) with `whatsapp_checked_at`. A `false` makes the next confirmation skip WhatsApp entirely. It's only set to `false` when Twilio itself rejected or failed the message — a missing sender or missing credentials is our misconfiguration and must not mark a client unreachable forever.

For voice bookings it completes inside the tool request, with a bounded six-second WhatsApp status poll, so the required SMS fallback cannot be frozen after a serverless response ends. Text-channel bookings still use `waitUntil` after their webhook response. WhatsApp uses the approved `amo_hair_booking_confirmation` Content template (variables: name, appointment, service, confirmation number), then falls back to SMS if WhatsApp is unavailable, rejected, or unconfirmed. The voice tool tells the model which channel actually succeeded; it never claims a confirmation was sent when both channels failed. Ledger rows are written as `message_type = 'booking_confirmation'`.

`/api/voice/turn` is the same tool logic over HTTP, for configuring Deepgram with a server-side function `endpoint` and for exercising the booking tools without placing a call. It is bearer-authed with `VOICE_TURN_SECRET` and returns 503 when that is unset, because it can create real Cal.com bookings.

`sendOnChannel()` has no voice case — a `'voice'` session falls through to SMS. That's deliberate: an owner taking over a finished call can't inject text into it, so texting the caller is the right action.

Per-call cost tracking now exists: `/api/voice/event` records a `costs` row on `call_ended` (see Costs). **Not built yet:** whether Deepgram's managed Gemini path supports multiple sequential tool calls in one turn is untested.

## Key Library Files

| File | Purpose |
|------|---------|
| `lib/agent.ts` | Gemini system prompt builder + tool/function declarations (8 booking tools) |
| `lib/ai.ts` | Gemini API wrapper — returns `{ reply?, tool_call?, tokens }` |
| `lib/supabase.ts` | All DB query functions (sessions, transcripts, profiles, FAQs, bookings) |
| `lib/dashboard-auth.ts` | Cookie auth — `requireDashboardSession()`, `getDashboardSession()`, `findDashboardCredential()` |
| `lib/deferred-notifications.ts` | 60-second delayed owner alerts via `pending_notifications` table |
| `lib/profile-cache.ts` | 5-min in-memory TTL cache for tenant business profiles |
| `lib/twilio.ts` | Twilio SMS + WhatsApp send (`sendSMS`, `sendWhatsAppMessage`, `sendWhatsAppTemplate`, `sendOnChannel`) |
| `lib/inbound-handler.ts` | Shared inbound pipeline for SMS + WhatsApp webhooks (`handleInboundMessage(req, channel)`) |
| `lib/booking_service.ts` | Cal.com booking logic |
| `lib/costs.ts` | **All cost recording and reporting** — `recordMessageCost()`, `recordAiCost()`, `recordVoiceCost()`, `getTenantChannelUsage()`, `getPlatformSpend()`, `resolveUsageDateRange()` |
| `lib/rate-card.ts` | Published list prices per provider + the WhatsApp 24h service-window lookup |
| `lib/cost-guard.ts` | Alert-only spend monitoring — never blocks a send |
| `lib/owner-email-notifications.ts` | Resend email alerts for business owners |
| `lib/voice-agent.ts` | Deepgram Voice Agent Settings payload — mu-law/8kHz telephony audio, voice system prompt, tool schemas |
| `lib/voice-tools.ts` | Runs one voice function call through `executeToolCall()` + persists booking state; shared by the bridge and `/api/voice/turn` |
| `lib/error-logger.ts` | Google Cloud Logging error handler |
| `lib/logger.ts` | Unified logger — `logError`/`logTimeout`/`logInteraction`/`logIntegration`/`logJob`/`logAudit`, plus `withTiming()` and `withRequestContext()` |
| `lib/client-events.ts` | Client-side logging — `trackInteraction()`, `trackClientError()`, `trackAudit()` |

---

## Component Conventions

- **Server components** handle data fetching (async functions, direct Supabase calls via `lib/supabase.ts`).
- **Client components** handle interactivity (`'use client'`, `useState`/`useEffect`).
- Dashboard pages export `revalidate = 0` — no caching.
- Forms use controlled inputs with `useState`, validated with `.trim()` before submit.
- API calls from client components: `fetch('/api/dashboard/...')` with `Content-Type: application/json` — plain `fetch` + `JSON.stringify`, no custom wrapper.
- Client components never call Supabase directly — always go through `/api/dashboard/*` endpoints.

---

## Costs

**Every cost the platform incurs is one row in `costs`.** There is no second cost
table and no second cost view. Record what the provider bills: tokens for Gemini,
money for Twilio, Meta and Deepgram.

`sms_messages`, `token_usage` and `tenant_cost_alerts` were all folded into it in
`20260909130000`, along with `sessions.tokens_used` / `model_used`. Don't
reintroduce a per-provider cost table.

| Column group | Holds |
|---|---|
| `source` / `kind` / `channel` / `direction` | what was paid for (`sms`/`whatsapp`/`voice`/`ai`), why, and on which conversation. `source` is the provider meter; `channel` is the thread — an AI call during a phone call is `source='ai'`, `channel='voice'` |
| `model` / `tokens_in` / `tokens_out` | the token side, for `source='ai'` |
| `amount` / `currency` / `quantity` | the money side. `quantity` is what the amount was billed per: SMS segments, voice seconds, 1 otherwise |
| `estimated` / `estimated_amount` | whether `amount` is still the rate card's guess, and what that guess was |
| `reference` / `status` / `error_code` / `raw_payload` | provider correlation and delivery state. `reference` is unique — it's the Twilio SID, so it doubles as the webhook-retry dedupe index |

### Estimate and billed price are one column over time, not two columns

The old design kept Twilio's `price` beside a `twilio_fee_usd` estimate and warned
never to add them. Now a row is written immediately with the rate-card estimate
(`estimated = true`) and **overwritten in place** when the provider's real figure
arrives, flipping the flag. Everything downstream sums `amount` and is correct at
every moment. `estimated_amount` keeps the original guess so drift stays
measurable — **never sum that one**.

- Twilio returns no price at send time; the billed figure lands via the status
  callback (`/api/twilio/status`) and the `/api/cron/sms-pricing` job, which now
  scans for `estimated = true` rather than a null price.
- `lib/rate-card.ts` computes the estimate from inside `recordMessageCost`, so
  every send/receive path is covered without touching any of them.

### Three invariants in `recordMessageCost` — don't undo these

1. **`source` is inherited from the existing row when the caller doesn't know it.** `costs.source` is `NOT NULL`, and Postgres checks that while forming the insert tuple — *before* it can detect the conflict and turn the upsert into an update. `/api/twilio/status` knows only the SID, so without the inherit every status callback dies with `23502` and prices silently stop updating. Verified against the live DB.
2. **A billed amount is never overwritten by an estimate.** Later callbacks routinely arrive with no `Price` at all; re-running the rate card on those would replace a confirmed figure with a guess, in the wrong currency, still flagged confirmed. Guarded by `existing.estimated === false`.
3. **A SID we've never seen and can't classify is skipped, not inserted.** Logged as `message_cost_unclassified` rather than creating an unattributable row.

Voice has a fourth: `recordVoiceCost` writes `reference = voice:<callSid|sessionId>` and upserts with `ignoreDuplicates`, so a retried `call_ended` can't bill the same call twice. Duration is capped by `MAX_BILLABLE_CALL_SECONDS` (default 7200) because it's derived from the session's age.

### Currency is per row, and this account is billed in GBP

`amount` is stored in the currency the provider actually billed, in `currency`.
**Twilio bills this account in GBP while the rate-card defaults are USD list
prices** — so confirmed rows read GBP and unconfirmed ones USD. Set
`RATE_CARD_CURRENCY` alongside rates in that currency if you want them to match;
never leave the rates in one currency and the label in another. Totals are
summed and compared **per currency**, never added across currencies.

### Rate-card rules

- **SMS** — billed **per segment** (160 GSM-7 chars, 153/segment once concatenated; 70/67 for Unicode). Estimate = segments × the per-segment rate for the direction, plus a processing fee if the message ends up failed/undelivered. Re-rated on **every** write, because the segment count and final status usually arrive on a later status callback. Rates: `SMS_OUTBOUND_SEGMENT_FEE_USD` / `SMS_INBOUND_SEGMENT_FEE_USD` / `SMS_FAILED_MESSAGE_FEE_USD` (defaults 0.056 / 0.0075 / 0.001).
- **WhatsApp** — billed per message. Meta charges on template sends and on anything outside the 24h customer service window; free-form replies inside the window cost only Twilio's platform fee, which applies both directions. Rated **once**, on first write — the window is only meaningful at send time. Rates: `WHATSAPP_META_FEE_USD` / `WHATSAPP_TWILIO_FEE_USD` (defaults 0.022 / 0.005). The window is derived from an inbound WhatsApp row for that number in the last 24h (index `costs_whatsapp_inbound_window_idx`).
- **Voice** — two per-minute meters against the same duration: Deepgram for the agent and Twilio for carriage (`DEEPGRAM_VOICE_USD_PER_MINUTE` / `TWILIO_VOICE_USD_PER_MINUTE`, defaults 0.075 / 0.0085). Recorded by `recordVoiceCost()` from `/api/voice/event` on `call_ended`, using the session's age as the call duration — the bridge is a separate service and that is the only point where duration is knowable.

**Not modelled:** carrier surcharges and MMS.

**Deepgram's usage API** (`/v1/projects/{id}/usage/breakdown`, `/balances`) does
report real spend, but only **per project and in aggregate** — it cannot attribute
a call to a tenant, so it can't price a row at hangup. Our key currently lacks the
`usage:read` / `billing:read` scopes anyway. If those are granted, voice becomes
reconcilable the way SMS is.

### Reporting: tenants see usage, operators see spend

- `getTenantChannelUsage(salonId, range)` — what a salon used (messages, calls, minutes), **deliberately without money**. A tenant is billed on their plan, not our provider rates; showing per-segment cost would expose the platform's margin.
- `getPlatformSpend(range)` — money, across every tenant, behind `isDashboardAdminEmail()`.
- `resolveUsageDateRange({preset, from, to})` — shared range resolver. Presets: `last_30_days` (default), `last_month`, `last_3_months`, `last_6_months`, `all`, `custom`. Ends are exclusive internally so the final day counts in full.

Internal `channel` values `test` / `sandbox` are recorded but excluded from every
total and from the alerts.

**Known limit:** both readers page up to 10k / 100k rows client-side rather than
aggregating in SQL. Fine at current volume (~89 rows/month), but the `all` preset
will silently truncate eventually — move to an aggregate RPC before it does.

### Spend monitoring (alert only — nothing is ever blocked)

Messaging is the meter: **$0.056** per SMS segment against **$0.00188** per Gemini
call, so it's ~30× the AI cost. Tokens are still recorded, as an **observability**
signal — the prompt/completion ratio is ~157:1 because the system prompt and full
history are re-sent every call, so a prompt-loop regression shows up there first.

- **Cap:** `business_profiles.monthly_cost_limit_usd`, falling back to `TENANT_MONTHLY_COST_LIMIT_USD` (default 50). Thresholds: `COST_ALERT_THRESHOLDS` (default `80,100`).
- **`evaluate_tenant_cost_alert()`** does the whole decision in one atomic RPC: sums `costs.amount` per currency, takes the worst, resolves the limit, picks the highest crossed threshold, and claims the alert with a **conditional UPDATE on `business_profiles.cost_alert_month` / `cost_alert_threshold_pct`**. That claim replaced the `tenant_cost_alerts` table: it's atomic, resets each month on its own, and only ratchets upward within one. Exactly one concurrent caller wins.
- Hooked into `recordMessageCost` and `recordVoiceCost` (not awaited). It **never blocks a send** — `checkTenantSpend` swallows all its own errors.
- Rows still on the rate card make the total run **~1.64×** Twilio's billed price on this account, so alerts fire early — set limits knowing that.
- Alerts go to `OPERATOR_ALERT_EMAIL` (the operator, not the salon owner) and are recorded in `app_logs` as `category: 'billing'`, `event: 'tenant_cost_threshold_crossed'`.

## Three different things are called "session"

Keep these apart — they have different lifetimes, owners, and columns.

| Concept | What it is | Lifetime | Where |
|---|---|---|---|
| **Conversation session** | A customer's SMS/WhatsApp/voice thread | Closes after **5 min** idle | `public.sessions`; `app_logs.session_id` (FK) |
| **Dashboard auth session** | The owner's login cookie | **8h**, or **30d** with "remember me" | `resevia_dashboard_session` cookie; not a table |
| **User sitting** | One continuous burst of dashboard use, for grouping interaction logs | Rolls over after **30 min** idle or tab close | `app_logs.user_session_id` |

`app_logs.session_id` is a foreign key to `public.sessions`, so it can **only** hold a conversation id — never a dashboard sitting. Use `user_session_id` for that, and `user_id` (the owner's email) for who.

`user_id` and `tenant_id` are both derived server-side from the signed cookie in `/api/log-error`, never read from the request body — a browser can't claim another identity. `user_session_id` is client-minted in `sessionStorage` ([lib/client-events.ts](lib/client-events.ts)) and isn't security-sensitive; it only has to be consistent.

Replay one sitting in order:

```sql
select created_at, event, type, path
  from public.app_logs
 where user_session_id = 'sit_...'
 order by created_at;
```

---

## Session Lifecycle

Sessions close themselves — there is no manual reset step and no daily batch.

`public.expire_inactive_sessions_and_holds()` runs **every minute** via a **pg_cron** job (`expire-inactive-sessions-every-minute`), scheduled inside Postgres in `20260513152000`. It:

- marks `active` / `review` sessions `completed` after **5 minutes** of inactivity — this is the per-conversation reset;
- marks `needs_approval` sessions `expired` after **7 days**, so an unapproved draft can't sit forever;
- expires `held` bookings past `expires_at`;
- skips anything with `metadata.source = 'sophia-sandbox'`.

Both windows are tunable without a code change:

```sql
alter database postgres set app.session_inactivity_minutes = '5';
alter database postgres set app.approval_stale_days = '7';
```

**`/api/cron/cleanup` calls the same RPC but has no schedule behind it** (there's no `vercel.json`). pg_cron is the live path; the route is a manual trigger. Don't assume instrumenting the route covers session expiry — the RPC writes its own `app_logs` rows (`sessions_expired` per tenant, `session_expiry_run` summary), logging when it does work plus an hourly heartbeat so it stays verifiable without adding ~43k empty rows a month.

---

## Logging & Analytics

Every app-side log is one row in **`app_logs`**, classified by `type` — the axis logs are queried on. `category` (`sms`/`ai`/`tool`/`session`/`dashboard`/`auth`/`billing`/`observer`/`system`) is the subsystem sub-axis.

| `type` | Use for | Helper |
|--------|---------|--------|
| `error` | Exceptions and failures | `logError(category, event, error, ctx)` |
| `timeout` | External call past its threshold (`LOG_SLOW_CALL_MS`, default 5000ms) | `logTimeout()` — usually emitted by `withTiming()` |
| `interaction` | Clicks, submits, page views and their results | `logInteraction()` / `trackInteraction()` |
| `integration` | Outbound calls to Gemini / Cal.com / Twilio, with `duration_ms` | `withTiming()` |
| `job` | Cron start/finish + rows processed | `logJob()` |
| `audit` | Login/logout, settings changes, mode overrides, draft approvals | `logAudit()` / `trackAudit()` |

- **Server-side:** import the typed helpers from `lib/logger.ts`. `safeLog()` still exists for calls that don't fit a helper, but `type` is required on it. Never use `console.log`.
- **Client-side:** `trackInteraction()` / `trackClientError()` / `trackAudit()` from `lib/client-events.ts`. These POST to `/api/log-error`, which writes exactly one row.
- **Timing external calls:** wrap them in `withTiming()`. It emits one log covering success, failure and slow-but-successful, always with `duration_ms`, and rethrows. Cal.com is instrumented globally via an axios interceptor in `lib/booking_service.ts` — individual Cal calls need no wrapping.
- **Correlation:** `withRequestContext()` (already applied in both inbound webhooks) attaches a `request_id` to every log in that request, so one conversation turn can be pulled back as an ordered trace.
- **PII:** the logger masks anything matching `+<7-15 digits>` down to the last four, in all string values including `path`. Don't defeat it by pre-formatting numbers differently.

**Log the event and its timing, never the state.** Delivery status, price and token spend all belong in `costs`, message content in `transcripts`, bookings in `bookings`. Duplicating those into logs is what produced the previous three-table mess.

> `public.logs` is the **marketing site's** analytics table (resevia.co.uk), written by a separate codebase. Nothing in this repo may read or write it.

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
2. Use the typed helpers from `lib/logger.ts` on the server (`logError`, `logIntegration`, `logJob`, `logAudit`, `withTiming`). Never `console.log`.
3. Use `trackInteraction()` / `trackClientError()` from `lib/client-events.ts` for user-facing actions in client components.
4. New migrations go in `supabase/migrations/` with Supabase CLI timestamp format.
5. Import `supabase` from `lib/supabase.ts` — never instantiate the client elsewhere.
6. Client components fetch `/api/dashboard/*` — never query Supabase directly from the browser.
7. Use `@/` path alias over relative imports.
8. TypeScript `strict` is `false` — keep it that way; don't tighten per-file.
9. For deferred/delayed notifications, use `lib/deferred-notifications.ts` — don't implement ad-hoc timers.
10. Dev server is on port 3001 — don't change it.
