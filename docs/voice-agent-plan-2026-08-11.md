# Voice Agent Plan — 11th August 2026

**Goal:** Let the agent answer inbound calls conversationally, instead of today's reject-and-text-back.
**Current state:** `/api/twilio/voice` always hangs up (`<Reject>`), then sends a WhatsApp-or-SMS follow-up via `sendMissedCallFollowup()`. There is no IVR and no speech handling anywhere.

> Every price and limit in this document is a **planning estimate** from August 2026 and must be verified against current vendor pricing for UK numbers before committing. Voice pricing moves.

---

## 1. The constraint that decides the stack

**Vercel serverless cannot hold a WebSocket.** Both real-time voice approaches — Twilio ConversationRelay and Twilio Media Streams — require a persistent socket endpoint. The Next.js app cannot be that endpoint.

So the choice is: add one always-on service, or pick an approach that avoids sockets entirely.

---

## 2. Options considered

| # | Approach | New infra | Latency/turn | Build effort | Control |
| --- | --- | --- | --- | --- | --- |
| A | `<Gather input="speech">` — turn-based TwiML | None | 2–4s | ~1 day | Full |
| B | ConversationRelay + small WebSocket relay | 1 service (~$5/mo) | 0.6–1.2s | ~1–2 weeks | Full |
| C | Managed platform (ElevenLabs / Retell / Vapi) | None (SaaS) | 0.5–1s | ~3–5 days | Good |
| D | Media Streams + Gemini Live (raw audio) | 1 service + audio pipeline | 0.4–0.8s | ~4+ weeks | Total |

**A** is a prototype only — 2–4 second pauses lose callers. **D** means hand-writing μ-law resampling, VAD and barge-in for a marginal latency gain; revisit only if latency becomes a real complaint.

---

## 3. Cost analysis

Three components, in order of how much they actually matter at current scale:

1. **Build + maintenance** — dominates. B is 1–2 weeks; C is 3–5 days.
2. **Per-minute** — $0.08–0.20/min planning range (telephony + STT + TTS + tokens). TTS is usually the largest slice; premium voices can double the total.
3. **Fixed infra** — $0 for A/C, ~$5/mo for B.

### Break-even on self-hosting

Self-hosting (B) saves roughly **$0.05/min** over a managed platform. If two weeks of build time is worth ~$5,000, that needs **~100,000 call minutes — about 33,000 calls at 3 minutes each** — to pay back.

At 10 salons × 10 calls/day that is roughly a year. At current scale, several years. **Self-hosting to save per-minute cost is a losing trade until much greater volume.**

### Voice vs the existing fallback

| Path | Cost per interaction |
| --- | --- |
| Today's missed-call SMS | ~$0.056 |
| 3-minute voice call | $0.30–0.45 |

Voice is **6–8× more expensive per interaction**. It only pays for itself if it converts materially better than "we texted you back within ten seconds". That is testable from existing data in `sessions` and `bookings` before spending anything — see §8.

---

## 4. Decision

**Managed platform, pointed at our own agent as a custom LLM endpoint.**

The critical design point: **build the endpoint first, choose the platform second.**

Every candidate platform accepts an OpenAI-compatible custom LLM URL. Writing `/api/voice/turn` as that endpoint means:

- **One brain.** Same prompt, same 8 booking tools, same Cal.com logic shared across SMS, WhatsApp and voice. Two agents that drift apart would cost more over a year than any per-minute saving.
- **The platform becomes a config value.** Swapping vendors is an afternoon, not a rewrite.
- **Migration to self-hosting is free.** ConversationRelay (option B) would call the *same* endpoint. Only the transport changes.

This works because the existing agent is already the right shape: `callAI()` ([lib/ai.ts](../lib/ai.ts)) is text-in/text-out, and `executeToolCall()` ([lib/tool-handler.ts](../lib/tool-handler.ts)) is entirely channel-agnostic.

---

## 5. Platform shortlist

Three-way bake-off. Because the custom LLM endpoint is the interface, each takes about an afternoon to test.

| Platform | Strength | Risk to check |
| --- | --- | --- |
| **ElevenLabs Agents** | Best-in-class voice quality; strong turn-taking/barge-in | Most restrictive concurrency at lower tiers; subscription floor can beat per-minute rates at low volume; telephony is newer for them |
| **Retell** | Telephony-first; highest default concurrency (order of ~20 on standard paid) | Voice quality a step below ElevenLabs |
| **Vapi** | Most configurable pipeline; concurrency purchasable per slot | More assembly required |

**ElevenLabs is the one to beat on quality.** Since voice's whole justification is conversion, and a lost £40 booking dwarfs a few pence per minute, premium voice has a genuine revenue argument here — it is not just polish. This cuts against the "use cheap TTS" cost lever in §7; resolve it with an A/B test on real calls, not an argument.

**Product angle:** per-tenant `voice_id` on `business_profiles`, following the existing `whatsapp_template_sid` pattern. Each salon gets its own voice — a sellable upgrade rather than an absorbed cost.

### Concurrency

All three support simultaneous calls; none is single-session. Limits are plan-dependent and revised often — verify current figures directly.

**Sizing for current scale:** 10 salons × 10 calls/day ≈ 100 calls over ~9 business hours ≈ 11 calls/hour. At 3 minutes each that is 33 call-minutes/hour = **0.55 concurrent on average**, peaking maybe 5–8 with a 5× lunchtime burst. That fits inside the default tier of any of them. Concurrency is not the binding constraint at this scale.

**What binds first: the Gemini rate limit.** Ten concurrent calls each taking a turn every ~5s is ~120 requests/minute against `gemini-2.5-flash` — on top of existing SMS and WhatsApp traffic sharing the same key. That ceiling arrives well before any platform's concurrency cap, and it degrades *every* channel at once. Check the current tier's RPM/TPM before launch. Cal.com rate limits are second, since every in-call availability check hits their API.

---

## 6. Implementation steps

**Step 1 — `/api/voice/turn` (half a day).** OpenAI-compatible endpoint wrapping `callAI()` + `executeToolCall()`. The real asset; everything else is swappable around it.

**Step 2 — platform bake-off (1 day).** Test ElevenLabs, Retell and Vapi against the endpoint. Verify UK per-minute rates and concurrency caps as part of this.

**Step 3 — schema.**
- Add `'voice'` to the `sessions.channel` check constraint (currently `('sms','whatsapp','webchat')` — see [migration 20260624120000](../supabase/migrations/20260624120000_whatsapp_channel.sql)).
- New `calls` table: call SID, session, duration, recording URL, per-minute cost. `sms_messages` is message-shaped and will not fit.
- `token_usage.channel` already accepts `'voice'` and it is already in `CUSTOMER_CHANNELS`, so AI spend attribution works with no change.

**Step 4 — voice prompt profile.** The prompt currently says *"Keep messages under 160 characters"* ([lib/agent.ts](../lib/agent.ts)) — meaningless when spoken. Voice needs: no markdown or lists, times spoken naturally ("half past two", not "14:30"), phone numbers and dates read back digit by digit for confirmation, and short turns so callers can interrupt. Give `buildSystemPrompt()` a `channel` argument and branch the style block only — keep booking rules shared.

**Step 5 — latency handling.** A Cal.com availability lookup takes 1–3s, and silence on a phone call reads as a dropped line. Emit filler speech ("let me check that for you…") *before* the tool runs. This is the single biggest quality difference between a voice agent that feels real and one that does not.

**Step 6 — ship narrow.** Per-tenant flag on `business_profiles`; in-hours only; 4-minute hard cap; existing reject-and-text as fallback.

**Step 7 — cost tracking.** Per-call rate card on the `calls` table, feeding a third block in `spend.rateCard` alongside SMS and WhatsApp.

---

## 7. Cost control levers

- **Answer in-hours only.** Outside opening hours keep today's reject-and-text — 1/8th the cost, and arguably better UX at 11pm.
- **Hard-cap call duration** (~4 min), then hand off to SMS. Runaway calls are where voice budgets die.
- **TTS voice tier** — the biggest single line. See the A/B note in §5 before defaulting to cheap.
- **Short replies** — on voice this is a direct cost lever, not just style.
- **Per-tenant toggle** — voice as a paid upgrade.

---

## 8. Open questions before committing

1. **Does voice actually convert better than the SMS follow-up?** Measurable now from `sessions` + `bookings`. If the text-back books nearly as well, voice should be a premium tier rather than the default. Does not change the build order — step 1 is worth doing either way — it changes who it gets enabled for.
2. **Current UK per-minute rates and concurrency caps** for all three platforms.
3. **Gemini tier RPM/TPM headroom** against combined SMS + WhatsApp + voice load.
4. **GDPR / data residency** — call audio contains customer PII. Where do recordings and transcripts live, and for how long? Ask all three.

---

## 9. Known gotchas

- **Session collision.** `getOrCreateConversation(salonId, phone)` keys on salon + phone, so a caller who also texts lands on the same session — but `channel` is the authoritative routing field, so tagging it `'voice'` would break their SMS replies. Decide early: separate session per channel (simple, fragments history) or one session with per-message channel (better UX, more refactoring).
- **UK disclosure.** `en-GB`, London timezone, UK callers. The agent should announce it is automated at pickup, and recording needs a notice. Cheaper to build into the greeting than to retrofit.
- **Failover is not optional.** Platform outage, concurrency cap, rate limit — all one branch back to `sendMissedCallFollowup()`. Callers hearing dead air is worse than not answering.
- **twilio-node is on ^5.3.0**, which may predate the ConversationRelay TwiML helper. Only relevant if/when moving to option B.

---

## 10. Revisit self-hosting when

Volume passes roughly 30,000 calls, or a platform's pricing shifts unfavourably. At that point step 1 has already done the hard work: swap in a ConversationRelay relay service (Node + `ws` on Fly.io, ~$5/mo, under 200 lines) pointed at the same `/api/voice/turn`. The agent does not change.
