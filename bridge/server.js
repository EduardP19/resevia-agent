import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';

/**
 * Twilio Media Streams <-> Deepgram Voice Agent audio bridge.
 *
 * This process is deliberately dumb. It holds no database connection, no
 * Cal.com client and no booking logic: it asks the Next app for the call's
 * Deepgram Settings, opens the Deepgram socket, and copies audio between the
 * two. Deepgram calls the booking tools itself over HTTPS (the Settings carry a
 * server-side `endpoint` on every function), and the spoken conversation is
 * posted back to the app to be stored.
 *
 * It exists as a separate service only because Vercel Functions cannot hold a
 * WebSocket without an entitlement this account does not have. Everything
 * tenant-specific still lives in the Next app.
 *
 *   Twilio  --mulaw/8k base64 JSON-->  bridge  --mulaw/8k binary-->  Deepgram
 *
 * Both sides speak mu-law at 8kHz, so audio is copied through untouched.
 */

const APP_BASE_URL = requireEnv('APP_BASE_URL').replace(/\/$/, '');
const VOICE_TURN_SECRET = requireEnv('VOICE_TURN_SECRET');
const DEEPGRAM_API_KEY = requireEnv('DEEPGRAM_API_KEY');
const DEEPGRAM_AGENT_URL = process.env.DEEPGRAM_AGENT_URL || 'wss://agent.deepgram.com/v1/agent/converse';
const PORT = Number(process.env.PORT) || 8080;

// Deepgram closes a socket that goes quiet. Twilio streams continuously, so
// this only matters while a tool call is in flight — cheap insurance.
const KEEPALIVE_MS = 8000;

// Cal.com availability is the slowest thing in a turn. A caller will tolerate a
// few seconds of "one moment"; they will not tolerate the 46 seconds the first
// live call produced. Past this we give the agent something to say instead.
const TOOL_TIMEOUT_MS = Number(process.env.TOOL_TIMEOUT_MS) || 12000;

// How long the line may stay quiet after a tool result before we make the agent
// say something. Gemini sometimes answers a tool call with no words at all,
// which on a phone is indistinguishable from a dropped call — "are you still
// there?" is what it sounded like on the first live calls.
const SILENCE_WATCHDOG_MS = Number(process.env.SILENCE_WATCHDOG_MS) || 4000;

// Deliberately non-committal: this is filler for a gap, and it must not imply
// an outcome the agent hasn't actually got yet.
const HOLDING_LINES = [
  'Bear with me one moment.',
  "Just checking that for you now.",
  'One second, still looking.',
];

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`[bridge] missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

function log(event, fields = {}) {
  // Structured single-line logs: Railway's viewer is plain text, and this keeps
  // a call greppable by callSid.
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...fields }));
}

const server = http.createServer((req, res) => {
  // Railway health check, and a quick way to tell the service is alive.
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('resevia-voice-bridge ok\n');
});

const wss = new WebSocketServer({ server });

wss.on('connection', (twilioWs) => {
  let streamSid = null;
  let callSid = null;
  let deepgram = null;
  let keepalive = null;
  let heartbeat = null;
  let eventQueue = Promise.resolve();
  let lastEventTime = 0;
  let closed = false;
  let deepgramReady = false;
  let ctx = {};

  // Twilio starts streaming the moment the call connects, but nothing can be
  // forwarded until Deepgram has accepted its Settings. Buffering instead of
  // dropping means the caller's opening words — often the whole point of the
  // call — survive the setup round trip.
  const pending = [];
  let silenceTimer = null;
  let holdingLineIndex = 0;

  /**
   * Starts the clock on a quiet line. `behavior: 'default'` means Deepgram
   * refuses the injection outright if either party is mid-turn, so this can only
   * ever land in real silence — it cannot talk over the caller, or over the
   * agent's own reply arriving a moment late.
   */
  function armSilenceWatchdog() {
    clearSilenceWatchdog();
    silenceTimer = setTimeout(() => {
      if (closed || deepgram?.readyState !== WebSocket.OPEN) return;
      const message = HOLDING_LINES[holdingLineIndex++ % HOLDING_LINES.length];
      deepgram.send(JSON.stringify({ type: 'InjectAgentMessage', message, behavior: 'default' }));
      log('silence_filled', { callSid, message });
      // Re-arm: a badly stalled tool should get a second nudge rather than one
      // line followed by open-ended silence.
      armSilenceWatchdog();
    }, SILENCE_WATCHDOG_MS);
    // Never hold the process open on this alone.
    silenceTimer.unref?.();
  }

  function clearSilenceWatchdog() {
    if (silenceTimer) clearTimeout(silenceTimer);
    silenceTimer = null;
  }

  function teardown(reason) {
    if (closed) return;
    closed = true;
    if (keepalive) clearInterval(keepalive);
    if (heartbeat) clearInterval(heartbeat);
    try { deepgram?.close(); } catch {}
    try { twilioWs.close(); } catch {}
    log('call_ended', { callSid, reason });
    if (ctx.sessionId) {
      postEvent({ sessionId: ctx.sessionId, tenantId: ctx.salonId, event: 'call_ended', reason });
    }
  }

  function postEvent(body) {
    lastEventTime = Math.max(Date.now(), lastEventTime + 1);
    const payload = JSON.stringify({ ...body, eventId: randomUUID(), occurredAt: new Date(lastEventTime).toISOString() });
    // Preserve spoken order and flush the final transcript before recording hangup.
    // A stable event ID makes retries safe when the response, but not the write, is lost.
    eventQueue = eventQueue.then(async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const response = await fetch(`${APP_BASE_URL}/api/voice/event`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', authorization: `Bearer ${VOICE_TURN_SECRET}` },
            body: payload,
            signal: AbortSignal.timeout(5000),
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return;
        } catch (error) {
          if (attempt === 2) log('event_post_failed', { callSid, event: body.event, error: String(error) });
          else await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
        }
      }
    });
    return eventQueue;
  }

  function sendToTwilio(audio) {
    if (!streamSid || twilioWs.readyState !== WebSocket.OPEN) return;
    twilioWs.send(
      JSON.stringify({ event: 'media', streamSid, media: { payload: audio.toString('base64') } })
    );
  }

  async function connectDeepgram(params) {
    ctx = { salonId: params.salonId, sessionId: params.sessionId, from: params.from };

    const configUrl = new URL(`${APP_BASE_URL}/api/voice/config`);
    configUrl.searchParams.set('salonId', params.salonId);
    configUrl.searchParams.set('sessionId', params.sessionId);
    configUrl.searchParams.set('from', params.from);

    const res = await fetch(configUrl, {
      headers: { authorization: `Bearer ${VOICE_TURN_SECRET}` },
    });
    if (!res.ok) {
      log('config_fetch_failed', { callSid, status: res.status, body: await res.text() });
      return teardown('config_fetch_failed');
    }
    const settings = await res.json();
    if (closed) return;

    deepgram = new WebSocket(DEEPGRAM_AGENT_URL, {
      headers: { Authorization: `Token ${DEEPGRAM_API_KEY}` },
    });

    deepgram.on('open', () => {
      deepgram.send(JSON.stringify(settings));
      keepalive = setInterval(() => {
        if (deepgram?.readyState === WebSocket.OPEN) {
          deepgram.send(JSON.stringify({ type: 'KeepAlive' }));
        }
      }, KEEPALIVE_MS);
    });

    deepgram.on('message', (data, isBinary) => {
      if (isBinary) return sendToTwilio(data);
      handleDeepgramEvent(data.toString());
    });

    deepgram.on('error', (error) => {
      log('deepgram_error', { callSid, error: String(error) });
      teardown('deepgram_error');
    });

    deepgram.on('close', () => teardown('deepgram_closed'));
  }

  /**
   * Executes a batch of tool calls by proxying them to the Next app, then
   * returns one FunctionCallResponse per function. Never throws: a tool that
   * fails must produce something the agent can say, not dead air.
   */
  async function runFunctions(message) {
    const functions = Array.isArray(message.functions) ? message.functions : [];

    await Promise.all(
      functions.map(async (fn) => {
        const startedAt = Date.now();
        let content;
        try {
          const url = new URL(`${APP_BASE_URL}/api/voice/turn`);
          url.searchParams.set('salonId', ctx.salonId);
          url.searchParams.set('sessionId', ctx.sessionId);
          url.searchParams.set('from', ctx.from);

          const res = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              authorization: `Bearer ${VOICE_TURN_SECRET}`,
            },
            body: JSON.stringify({ functions: [fn] }),
            signal: AbortSignal.timeout(TOOL_TIMEOUT_MS),
          });

          if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
          const body = await res.json();
          content = body.content ?? body.responses?.[0]?.content ?? '';
        } catch (error) {
          log('tool_failed', { callSid, tool: fn.name, ms: Date.now() - startedAt, error: String(error) });
          // Phrased as an instruction because it is read by the model, not the
          // caller — without it the agent invents a plausible answer instead.
          content =
            "Failed: the booking system did not respond. Tell the caller you can't check that right now and that the team will follow up. Do not guess whether the slot is free.";
        }

        log('tool_done', { callSid, tool: fn.name, ms: Date.now() - startedAt });

        if (deepgram?.readyState === WebSocket.OPEN) {
          deepgram.send(
            JSON.stringify({ type: 'FunctionCallResponse', id: fn.id, name: fn.name, content })
          );
          armSilenceWatchdog();
        }
      })
    );
  }

  function handleDeepgramEvent(raw) {
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }

    switch (message.type) {
      case 'SettingsApplied':
        if (closed) break;
        deepgramReady = true;
        while (pending.length) deepgram.send(pending.shift());
        log('agent_ready', { callSid, sessionId: ctx.sessionId });
        heartbeat = setInterval(() => {
          if (!closed) postEvent({ sessionId: ctx.sessionId, tenantId: ctx.salonId, event: 'heartbeat' });
        }, 30000);
        break;

      case 'AgentStartedSpeaking':
      case 'AgentThinking':
        clearSilenceWatchdog();
        break;

      case 'InjectionRefused':
        // Someone was talking after all, so the gap has closed on its own.
        log('injection_refused', { callSid });
        break;

      case 'UserStartedSpeaking':
        clearSilenceWatchdog();
        // Barge-in. Twilio has already buffered whatever the agent was saying;
        // without clearing it the caller talks over audio queued seconds ago.
        if (streamSid && twilioWs.readyState === WebSocket.OPEN) {
          twilioWs.send(JSON.stringify({ event: 'clear', streamSid }));
        }
        break;

      case 'FunctionCallRequest':
        // Tools run here rather than through Deepgram's server-side `endpoint`,
        // so a failure is ours to see and report. Deliberately not awaited: the
        // socket must keep pumping audio while Cal.com is being queried.
        runFunctions(message);
        break;

      case 'ConversationText':
        if (message.role !== 'user') clearSilenceWatchdog();
        if (ctx.sessionId && message.content) {
          postEvent({
            sessionId: ctx.sessionId,
            tenantId: ctx.salonId,
            event: 'transcript',
            role: message.role,
            content: message.content,
          });
        }
        break;

      case 'Error':
        log('agent_error', { callSid, code: message.code, description: message.description });
        break;
    }
  }

  twilioWs.on('message', (data) => {
    let frame;
    try {
      frame = JSON.parse(data.toString());
    } catch {
      return;
    }

    if (frame.event === 'start') {
      streamSid = frame.start?.streamSid || null;
      callSid = frame.start?.callSid || null;
      const params = frame.start?.customParameters || {};
      log('call_started', { callSid, sessionId: params.sessionId });
      if (!params.salonId || !params.sessionId || !params.from) {
        return teardown('missing_stream_parameters');
      }
      connectDeepgram(params).catch((error) => {
        log('setup_failed', { callSid, error: String(error) });
        teardown('setup_failed');
      });
      return;
    }

    if (frame.event === 'media' && frame.media?.payload) {
      const audio = Buffer.from(frame.media.payload, 'base64');
      if (deepgramReady && deepgram?.readyState === WebSocket.OPEN) {
        deepgram.send(audio);
      } else {
        pending.push(audio);
      }
      return;
    }

    if (frame.event === 'stop') teardown('caller_hung_up');
  });

  twilioWs.on('close', () => teardown('twilio_closed'));
  twilioWs.on('error', (error) => {
    log('twilio_error', { callSid, error: String(error) });
    teardown('twilio_error');
  });
});

server.listen(PORT, () => log('listening', { port: PORT, app: APP_BASE_URL }));
