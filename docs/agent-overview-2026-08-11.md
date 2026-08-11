# Agent Overview — 11th August 2026

**Subject:** Database schema review — which tables earn their place, which don't
**Method:** Static analysis of `app/` and `lib/` call sites plus `supabase/migrations/`, against the live table list in the Supabase dashboard.

---

## Summary

The Supabase project holds **19 tables + 1 view**. The code touches **14** of them.

| Group | Count | Verdict |
| --- | --- | --- |
| Load-bearing | 11 | Keep — each maps to a distinct domain object |
| Write-only logging | 3 | Consolidate or drop — nothing reads them |
| Orphans (no code, no migration) | 5 + 1 view | Investigate ownership, then remove |

The core schema is **not overcomplicated**. Eleven tables is normal for a multi-tenant SaaS handling conversations, bookings, staff scheduling and per-message cost tracking. The overwhelm comes from the other eight, which are invisible from this repo and undocumented.

---

## 1. Load-bearing — keep

Each has live read **and** write paths in the codebase.

| Table | Purpose | Call sites |
| --- | --- | --- |
| `sessions` | SMS/WhatsApp/voice conversations | 45 |
| `business_profiles` | Tenant config, credentials, senders | 18 |
| `transcripts` | Per-session message content | 15 |
| `bookings` | Cal.com bookings linked to sessions | 10 |
| `sms_messages` | Delivery status + cost ledger | 7 |
| `faqs` | Tenant knowledge base | 6 |
| `pending_notifications` | Deferred owner alerts (full CRUD) | 5 |
| `workers` | Staff, services, Cal event types | 4 |
| `observer_flags` | QA flags surfaced on dashboard home | 3 |
| `token_usage` | AI spend per interaction | 2 (write + read) |
| `transcripts-sophia-sandbox` | Sandbox messages | via `TEST_UI_TRANSCRIPTS_TABLE` |

**Caveat on "works":** every one of these has a wired-up code path — nothing is orphaned. That is not the same as end-to-end verified behaviour.

**One structural smell:** `transcripts-sophia-sandbox` duplicates the shape of `transcripts`. A `source` column on `transcripts` would do the same job with one table instead of two, and would remove the parallel `formatTranscriptTableError` / missing-column handling in `lib/supabase.ts`.

---

## 2. Write-only logging — 3 tables

`system_logs`, `error_logs`, `event_logs` are `.insert()` only:

- `lib/error-logger.ts` → `system_logs`, `error_logs`
- `lib/logger.ts` → `event_logs`

Nothing in the app ever reads them back. There is no log viewer in the dashboard. Errors already go to **Google Cloud Logging**, so this is duplicated storage with no consumer.

**Options:**
1. Collapse all three into one `logs` table with a `kind` column (`system` / `error` / `event`).
2. Drop them entirely and rely on Cloud Logging.
3. Keep as-is, but add a retention/cleanup job — they grow unbounded today.

---

## 3. Orphans — no code reference, no migration in this repo

| Table | Notes |
| --- | --- |
| `logs` | Looks like the ancestor of the three log tables above — superseded |
| `blog_posts` | Smells like a marketing site |
| `waitlist` | Smells like a marketing site |
| `message_templates` | Planned feature, never built |
| `scheduled_messages` | Planned feature, never built |

None has a `create table` statement in `supabase/migrations/` — they were created by hand in the Supabase UI, which is why they're invisible to this codebase.

> **Do not drop anything before confirming ownership.** If a separate marketing site shares this Supabase project, `blog_posts` and `waitlist` are legitimately in use and simply not visible from this repo.

---

## 4. Security note

`salon_token_usage_current_month` is a **view**, flagged **UNRESTRICTED** (no RLS) and exposed over PostgREST. Nothing in the app reads it.

An unused, unprotected view over per-tenant usage data is worth either restricting or dropping. Note this view has a history of schema drift — see the migration-history notes for `20260623120000_token_usage_and_plan_limits.sql`.

---

## 5. Documentation drift

The table list in `CLAUDE.md` is stale. It omits `observer_flags`, `token_usage`, and all five orphans. Part of why the schema feels overwhelming is that nothing on paper says which tables matter.

---

## Recommended sequence — 19 tables → ~12

1. **Confirm ownership** of `blog_posts` and `waitlist` (marketing site?). Check row counts and last-write timestamps on all five orphans to see whether anything is still writing to them.
2. **Drop the unowned orphans** — `logs`, `message_templates`, `scheduled_messages` at minimum.
3. **Restrict or drop** `salon_token_usage_current_month`.
4. **Consolidate the three log tables** into one, or drop them in favour of Cloud Logging. Add retention either way.
5. **Optionally** fold `transcripts-sophia-sandbox` into `transcripts` behind a `source` flag.
6. **Refresh `CLAUDE.md`** to match whatever survives.

Steps 2–5 each need a migration in `supabase/migrations/`, not a manual change in the Supabase UI — manual edits are how the five orphans became invisible in the first place.

---

## Related

- [Voice Agent Plan — 11th August 2026](./voice-agent-plan-2026-08-11.md) — adding inbound voice: stack choice, cost analysis, implementation steps.

## Other open items from this session

Unrelated to the schema, but pending decisions:

- **Fee backfill.** `sms_messages.meta_fee_usd` / `twilio_fee_usd` are populated going forward only; existing rows are null. SMS can be backfilled with pure SQL from `num_segments`; WhatsApp needs the service-window derivation. This would change previously reported spend for past months.
- **Pricing cron schedule unverified.** `/api/cron/sms-pricing` exists but there is no `vercel.json` in the repo, so the schedule lives outside the code. If it isn't firing, any message whose status callback arrived without a `Price` stays unpriced forever and under-reports spend.
- **Rate-card currency.** Defaults are USD list prices (`$0.056` / `$0.0075` per SMS segment, `$0.022` / `$0.005` WhatsApp). If the Twilio account bills in GBP or has volume discounts, override the env vars.
