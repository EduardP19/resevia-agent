import http from 'node:http';
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
  let closed = false;
  let deepgramReady = false;
  let ctx = {};

  // Twilio starts streaming the moment the call connects, but nothing can be
  // forwarded until Deepgram has accepted its Settings. Buffering instead of
  // dropping means the caller's opening words — often the whole point of the
  // call — survive the setup round trip.
  const pending = [];

  function teardown(reason) {
    if (closed) return;
    closed = true;
    if (keepalive) clearInterval(keepalive);
    try { deepgram?.close(); } catch {}
    try { twilioWs.close(); } catch {}
    log('call_ended', { callSid, reason });
    if (ctx.sessionId) {
      postEvent({ sessionId: ctx.sessionId, tenantId: ctx.salonId, event: 'call_ended', reason });
    }
  }

  async function postEvent(body) {
    try {
      await fetch(`${APP_BASE_URL}/api/voice/event`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          authorization: `Bearer ${VOICE_TURN_SECRET}`,
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      // A dropped transcript must never end a live call.
      log('event_post_failed', { callSid, error: String(error) });
    }
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

  function handleDeepgramEvent(raw) {
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }

    switch (message.type) {
      case 'SettingsApplied':
        deepgramReady = true;
        while (pending.length) deepgram.send(pending.shift());
        log('agent_ready', { callSid, sessionId: ctx.sessionId });
        break;

      case 'UserStartedSpeaking':
        // Barge-in. Twilio has already buffered whatever the agent was saying;
        // without clearing it the caller talks over audio queued seconds ago.
        if (streamSid && twilioWs.readyState === WebSocket.OPEN) {
          twilioWs.send(JSON.stringify({ event: 'clear', streamSid }));
        }
        break;

      case 'ConversationText':
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
