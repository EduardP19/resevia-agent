# Voice bridge

Audio-only WebSocket relay between Twilio Media Streams and the Deepgram Voice
Agent API. Deployed to Railway; everything else in this repo stays on Vercel.

## Why it isn't a Vercel route

It was one, briefly. Vercel Functions can serve WebSockets, but only with a
WebSockets entitlement on top of Fluid compute, and this account doesn't have
it. The failure mode is unhelpful: the build succeeds, the deploy dies at
`Deploying outputs...` with no error, and the previous deployment stays live.

Twilio can't dial Deepgram directly either — Deepgram's socket needs an
`Authorization` header and `<Stream>` can't set one — so something has to sit in
the middle.

## What it does and doesn't know

Deliberately dumb: no database, no Cal.com, no booking logic, no tenant data.

1. Twilio connects and sends a `start` frame carrying `salonId`, `sessionId` and
   `from` as `<Parameter>` values.
2. The bridge fetches `GET /api/voice/config` from the Next app, which returns
   the entire Deepgram `Settings` payload — system prompt, services, FAQs, tool
   schemas.
3. Those tool schemas carry a server-side `endpoint` pointing at
   `/api/voice/turn`, so **Deepgram calls the booking tools itself**. The bridge
   never sees a booking.
4. Audio is copied both ways. Both sides are mu-law @ 8kHz, so it's a byte
   passthrough — no resampling.
5. Spoken turns are POSTed to `/api/voice/event` to land in `transcripts`, and a
   hangup closes the session there.

Adding business logic here is the mistake to avoid: it would need credentials
this service deliberately doesn't hold, and it would split the agent's behaviour
across two deploys.

## Railway setup

Set **Root Directory** to `bridge` so Railway builds only this folder — it has
its own `package.json` with `ws` as the single dependency, and installs in
seconds without pulling in Next, Supabase or Twilio.

Environment variables:

| Variable | Value |
|---|---|
| `APP_BASE_URL` | `https://app.resevia.co.uk` |
| `VOICE_TURN_SECRET` | Same value as in Vercel — this is what authenticates the bridge to the app |
| `DEEPGRAM_API_KEY` | Same value as in Vercel |

Railway sets `PORT` itself. The service refuses to start if any of the three are
missing, rather than failing later mid-call.

Then generate a public domain in Railway and set `VOICE_BRIDGE_URL` in **Vercel**
to it (either `https://` or `wss://` — the webhook converts the scheme). Without
it, `voice_mode='agent'` downgrades to `reject` instead of handing callers to a
dead socket.

## Verifying

- `GET https://<railway-domain>/` returns `resevia-voice-bridge ok`.
- Logs are one JSON object per line; a call is a `call_started` →
  `agent_ready` → `call_ended` sequence, greppable by `callSid`.
- No `agent_ready` means Deepgram rejected the Settings — the reason is on the
  `agent_error` line.
