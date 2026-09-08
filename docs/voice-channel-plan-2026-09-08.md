# Voice Channel Plan — 8th September 2026

**Updates** [voice-agent-plan-2026-08-11.md](voice-agent-plan-2026-08-11.md). That document's decision — *managed platform, pointed at our own agent via a custom LLM endpoint* — **still stands**. This one adds the dashboard on/off control that was implied but never specified, corrects one constraint that has since changed, and refreshes prices against September 2026 vendor pages.

Read the August doc for the reasoning. Read this one for what to build first and what changed.

> Prices below were checked on 8th September 2026 against vendor pricing pages, in USD, for **UK** numbers. Voice pricing moves; re-check before committing spend.

---

## 1. What changed since 11th August

**Vercel can now hold a WebSocket.** Native WebSocket support entered public beta on Vercel Functions on 22nd June 2026. §1 of the August doc treats "Vercel serverless cannot hold a WebSocket" as the constraint that decides the stack.

### Why it was a constraint

A serverless function is request-in → response-out → instance frozen; there is no long-lived process to hold the far end of a socket, and Next.js still does not expose the HTTP `upgrade` event in route handlers. Twilio's real-time voice products invert the direction — **Twilio dials out to our `wss://` endpoint** and streams frames for the duration of the call — which is the opposite shape to serverless.

The August doc prices the workaround as "1 service (~$5/mo)". That undersells it: the real cost was a **second deploy target** — another env var set, another log destination, another thing to keep in sync with `business_profiles` — outside the Vercel + Supabase setup everything else lives in. That, not the $5, is what made options B and D week-scale rather than day-scale.

### What it now costs

WebSockets bill as ordinary Fluid compute (they require Fluid, the default for projects created on or after 23rd April 2025). Active CPU is billed **only while code actually executes** — waiting on audio frames, Gemini or Cal.com does not count — while provisioned memory bills for the whole connection lifetime.

London (`lhr1`) rates: **$0.177/CPU-hour**, **$0.0146/GB-hour**, **$0.60/M invocations**, plus Fast Data/Origin Transfer. A 3-minute call at the default 2 GB:

| | |
| --- | --- |
| Memory: 2 GB × 0.05 hr × $0.0146 | $0.00146 |
| Active CPU (~5s executing) | $0.00025 |
| **Per call** | **≈ $0.0017** |

That is **under 1%** of the ~$0.24 the same call costs on a managed platform. Fluid's optimized concurrency puts multiple sockets on one instance, so concurrent calls share that memory rather than multiplying it. Hobby includes 360 GB-hours/month — hundreds of hours of open connection.

**Compute cost is therefore not a reason to avoid the socket path.** The remaining reasons for caution are:

- Public beta, and it requires the WebSockets permission enabled on the account.
- **Duration caps.** Hobby: 300s, hard, no extension — a 5-minute call gets cut mid-sentence, so a graceful "let me text you the rest" handoff would be mandatory. Pro: 300s default, 800s generally available, 1800s in beta. Salon booking calls fit comfortably on Pro.
- In-memory state does not survive reconnects — irrelevant here, since one call is one socket on one instance.

**None of this changes the decision.** The deciding factor in August was build effort (1–2 weeks vs 3–5 days), not infrastructure, and that gap is unchanged. What it means is that when self-hosting is revisited (§10 of the August doc), it is a materially smaller job than costed there.

Nothing else in the August analysis has been invalidated. The `sessions.channel` constraint still excludes `'voice'`, `/api/voice/turn` still does not exist, `lib/agent.ts:136` still tells the agent to keep messages under 160 characters, and `twilio-node` is still on ^5.3.0.

---

## 2. The dashboard toggle — build this first

Independent of every provider question, and useful on its own.

The rejection is not a Twilio setting. [app/api/twilio/voice/route.ts:96-100](../app/api/twilio/voice/route.ts#L96-L100) unconditionally returns `<Reject>`, then fires the WhatsApp/SMS follow-up in the background via `waitUntil`. So the control is a column the webhook reads before it builds TwiML — **no Twilio console or API change, and no per-minute cost to flip it.**

A three-state mode costs the same to build as a boolean and is materially more useful:

| `voice_mode` | TwiML | Behaviour |
| --- | --- | --- |
| `reject` (default) | `<Reject>` | Exactly today: hang up, then WhatsApp-or-SMS follow-up |
| `forward` | `<Dial>` the salon's real number | Ring the salon; follow-up only if unanswered |
| `agent` | `<Connect>` to the voice provider | The AI answers |

`forward` earns its place on its own — it is a sellable feature that needs no AI, and it exercises the whole flag → TwiML path before any provider exists.

### Changes

1. **Migration** — `business_profiles.voice_mode text not null default 'reject'` with a check constraint, plus `voice_forward_number text`. Separately extend `sessions_channel_check` ([20260624120000_whatsapp_channel.sql:33-34](../supabase/migrations/20260624120000_whatsapp_channel.sql#L33-L34)) to admit `'voice'`.
2. **[app/api/twilio/voice/route.ts](../app/api/twilio/voice/route.ts)** — move the salon lookup ahead of the TwiML response and branch on `voice_mode`. Today the lookup happens *after* `<Reject>` is returned, inside `processMissedCall`. One indexed query on the critical path (~40ms) is well inside Twilio's webhook tolerance, but consider a number-keyed cache alongside [lib/profile-cache.ts](../lib/profile-cache.ts) if it ever shows up in timings. `processMissedCall` stays exactly as-is for the `reject` branch.
3. **[app/api/dashboard/salon/route.ts:17-26](../app/api/dashboard/salon/route.ts#L17-L26)** — add `voice_mode` and `voice_forward_number` to `allowedProfileFields`. Audit logging and cache invalidation are already in that handler.
4. **Settings UI** — a `VoiceModeToggle` following the pill + description pattern of [ApprovalToggle.tsx](<../app/(dashboard)/ApprovalToggle.tsx>).

Later, cheaply: gate on opening hours — "the AI answers only when we're closed" — which is also the §7 cost lever from the August doc. Same flag, one extra condition.

---

## 3. Are Vapi/Retell actually faster than ConversationRelay?

Short answer: **no, not on any measurement that compares like with like.** The differences are in turn-taking polish and bundled tooling, not raw speed.

| Source | Figure | What it is |
| --- | --- | --- |
| Twilio, internal | ConversationRelay p50 **491ms**, p95 713ms | Vendor self-reported, unstated path segment |
| Tested Media, Mar 2026 | Vapi **1,558ms** median TTFAB, Retell **1,740ms** | 500 production calls per platform, measured externally from call audio |
| Vapi, competitive page | ConversationRelay "~1000ms, feels sluggish" | Vendor marketing about a competitor |

These are not comparable as printed. Self-reported platform figures run roughly **490ms below** the same call measured externally from its audio, so Twilio's 491ms is plausibly ~1s on the same basis as the Tested Media numbers — i.e. all three land in the same **~1.0–1.7s** band, with ConversationRelay arguably at the better end.

**Treat "X is faster" claims from any of these vendors as marketing.** The only number that matters is the one measured on our own stack with our own Gemini calls in the path, which is what the bake-off in §6 of the August doc is for.

### Where Vapi/Retell genuinely are better

- **Endpointing out of the box** — distinguishing "paused mid-sentence" from "finished speaking", and stopping cleanly when interrupted. Both ship tuned defaults and expose knobs. ConversationRelay gives Twilio's defaults and fewer of them. This is a real quality gap, and it is more audible than 200ms of latency.
- **Batteries included** — call recording, transcripts, analytics, voicemail detection, warm transfer, test suites. Each is days of work on the DIY path.
- **Time to first demo** — an afternoon, versus roughly a week.

### Where they are worse, for this codebase specifically

- **2–4× the per-minute cost** (§4).
- **A second provisioning surface.** Every salon needs an assistant and number configured in the platform, alongside [scripts/provision-phone.mjs](../scripts/provision-phone.mjs) and `business_profiles`. At 60 tenants that is a real operational cost, and it is the one nobody prices in.
- **A latency tax on the "one brain" design.** Routing the LLM through our own `/api/voice/turn` adds a network hop the platform's colocated model does not have — plausibly 100–300ms on every turn. This is the price of not maintaining two prompts, and it is the single most important thing to measure in the bake-off. If it proves worse than ~300ms, the ConversationRelay path gets more attractive, because there the hop exists either way.

---

## 4. Refreshed pricing (September 2026, UK, USD)

Baseline, already paid: UK local number **$3.50/mo**, inbound **$0.0100/min**.

| Path | Provider cost/min | All-in with telephony | 2-min call |
| --- | --- | --- | --- |
| Media Streams + Gemini Live | $0.0044 stream + ~$0.023 Gemini | **~$0.037** | ~$0.075 |
| ConversationRelay + our Gemini agent | $0.070 | **~$0.080** | ~$0.16 |
| Deepgram Voice Agent | $0.075 | **~$0.085** | ~$0.17 |
| `<Gather input="speech">` | ~$0.02 per turn | ~$0.14 for a 6-turn call | ~$0.14 |
| ElevenLabs Agents | $0.08–0.10 + LLM | **~$0.10–0.12** | ~$0.24 |
| Vapi / Retell / Bland | $0.05–0.09 advertised | **$0.10–0.30 measured** | $0.20–0.60 |

Advertised platform rates exclude LLM tokens, premium voice and telephony pass-through; measured all-in commonly runs 3–6× the sticker price. Budget against the measured column.

Gemini Live maths, for the record: audio input tokenises at 32 tok/s ($3/1M) and output at 25 tok/s ($12/1M), so a call-minute at roughly 40% caller / 40% agent / 20% silence is ~$0.019.

### Cost to evaluate

| Vendor | Free allowance | Realistic spend to test properly |
| --- | --- | --- |
| Deepgram | **$200 credits** (~44 hrs agent time) | $0 — by far the most generous |
| Twilio | $15.15 credit + 75 voice minutes, 30-day trial | ~$5 for 50 live test calls |
| Gemini Live API | Free tier, rate-limited | ~$0 in development |
| ElevenLabs | 10k credits ≈ ~15 min agent time/mo | $6/mo Starter |
| Vapi / Retell / Bland | ~$10 trial credit typical — **verify at signup** | $0–10 |
| OpenAI Realtime mini | none | ~$0.02–0.05/min ($10/1M audio in, $20/1M out) |

**Evaluating all of them costs £20–30.** The build time is the expensive part, exactly as §3 of the August doc argued.

### One correction to the August cost framing

The August doc compares a 3-minute call at $0.30–0.45 against "today's missed-call SMS at ~$0.056" and concludes voice is 6–8× more expensive per interaction. That understates the SMS side: $0.056 is **one outbound segment**, not the conversation. A booking negotiated over SMS is typically 6–10 messages, so ~$0.34–0.56 at the current rate card.

Against a realistic **2-minute** call — salon booking calls are short — the honest comparison is:

| Path | Cost per completed interaction |
| --- | --- |
| SMS conversation to booking (6–10 msgs) | $0.34–0.56 |
| 2-min ConversationRelay call | ~$0.16 |
| 2-min managed platform call | $0.20–0.60 |

Voice is **not** structurally more expensive than the SMS flow it replaces. It is roughly at par, and cheaper on the Twilio-native path. This weakens the "voice must convert better to justify itself" framing — though open question §8.1 (does voice actually convert better?) remains worth answering, since it decides who gets it enabled, not whether to build it.

---

## 5. Build order

1. **Toggle + `forward`** (§2) — half a day, no new vendors, no per-minute cost, shippable on its own.
2. **`/api/voice/turn`** — the OpenAI-compatible endpoint wrapping `callAI()` and `executeToolCall()`. Unchanged from the August plan; still the real asset, and provider-agnostic.
3. **Bake-off** — Deepgram first, because $200 of credits makes it free to learn on. Then ElevenLabs (quality benchmark) and Retell/Vapi. Measure the custom-LLM hop (§3) on each.
4. **Voice prompt profile, filler speech, schema, cost tracking** — steps 4–7 of the August doc, unchanged.

Everything after step 1 is gated on the bake-off. Step 1 is not, and is worth doing regardless of which provider wins.

---

## 6. Still open

Carried forward from §8 of the August doc, all still unanswered: voice-vs-SMS conversion from `sessions` + `bookings`; current UK rates and concurrency caps per platform; Gemini tier RPM/TPM headroom against combined SMS + WhatsApp + voice load; GDPR and call-audio residency.

Added here:

5. **How much does the custom-LLM hop cost in latency?** Decides whether "one brain" survives contact with a real call.
6. **Which plan is this project on, and is Fluid compute enabled?** Decides whether the WebSocket duration cap is 300s (Hobby, hard) or 800s (Pro) — i.e. whether a mid-call handoff to SMS is mandatory or merely prudent. Only relevant if the ConversationRelay path is revisited, but it costs nothing to check now.

---

## Decision & build log — 8th September 2026

**Orchestrator: Deepgram Voice Agent API.** Chosen over Vapi/Retell/ElevenLabs and raw ConversationRelay on price and on the fact that its `agent.think.prompt` / `agent.think.functions` fields are provider-agnostic — the existing system prompt and all 8 tool schemas port across with no rewrite, and `gemini-2.5-flash` is on its managed-LLM list, so there is one brain across SMS, WhatsApp, and voice.

### Shipped

| Piece | Where |
|---|---|
| `voice_mode` (`reject`/`forward`/`agent`) + `voice_forward_number`; `'voice'` added to `sessions_channel_check` | `supabase/migrations/20260908120000_voice_channel.sql` (applied) |
| Mode branching, `<Dial>` / `<Connect><Stream>` TwiML, downgrade-to-reject guards | `app/api/twilio/voice/route.ts` |
| Twilio Media Streams ↔ Deepgram bridge | `app/api/voice/bridge/route.ts` |
| Function-call webhook (HTTP form of the booking tools) | `app/api/voice/turn/route.ts` |
| Settings payload + tool schema reuse | `lib/voice-agent.ts` |
| Shared tool runner + booking-state persistence | `lib/voice-tools.ts` |
| Voice register in the system prompt (`{ channel: 'voice' }`) | `lib/agent.ts` |
| Settings → Phone Calls control | `app/(dashboard)/dashboard/settings/VoiceModeToggle.tsx` |

Rationale for each design choice lives in CLAUDE.md § Voice channel.

### Not done

- **Per-call cost tracking.** There is no `voice_calls` table, so voice spend is invisible to `getTenantApiSpend()` and to the threshold alerts. Voice is materially more expensive per interaction than SMS, so this should land before any tenant is switched to `agent` mode in production.
- **Deepgram audio format is unverified against a live call.** The bridge is configured mu-law @ 8kHz on both sides on the strength of the docs; the first real call is the test.
- **Multiple sequential tool calls in one turn** (`check_availability` → `book_appointment` before speaking) on Deepgram's managed Gemini path is undocumented. Judged non-blocking — speaking between tool calls is natural on a phone — but worth confirming.
- **Vercel Fluid must be enabled** on the project for `experimental_upgradeWebSocket` to work. Without it `agent` mode connects to nothing.
