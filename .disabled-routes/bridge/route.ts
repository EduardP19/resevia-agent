import { NextRequest } from 'next/server';
import { experimental_upgradeWebSocket } from '@vercel/functions';
import WebSocket from 'ws';
import { getFAQs, getWorkers, saveMessage, supabase } from '@/lib/supabase';
import { buildVoiceAgentSettings, DEEPGRAM_AGENT_URL } from '@/lib/voice-agent';
import { handleFunctionCallRequest } from '@/lib/voice-tools';
import { logError, safeLog } from '@/lib/logger';

export const dynamic = 'force-dynamic';
// A phone call is a long-lived socket, not a request/response. Vercel Fluid
// bills Active CPU (near zero while audio just passes through) plus provisioned
// memory for the connection's lifetime, so a generous ceiling is cheap; this is
// the hard stop on a call nobody hung up.
//
// Vercel closes the socket at maxDuration, which on a call means hanging up
// mid-sentence — so this is a real 10-minute cap on call length, not just a
// safety net. 800s is the generally-available Pro ceiling (Hobby caps at 300s
// regardless of what is set here); going beyond it needs the extended-duration
// beta.
export const maxDuration = 600;

// Deepgram closes a socket that goes quiet. Twilio sends media continuously, so
// this only matters during long tool calls, but it's cheap insurance.
const KEEPALIVE_MS = 8000;

/**
 * Twilio Media Streams <-> Deepgram Voice Agent bridge.
 *
 * Twilio's <Connect><Stream> dials this socket and speaks base64-wrapped 8kHz
 * mu-law over JSON frames; Deepgram speaks raw binary audio plus JSON control
 * events. Both sides are configured for the same mu-law/8kHz format (see
 * lib/voice-agent.ts), so audio is copied through untouched in both directions —
 * the only work this process does is unwrap/rewrap base64 and route control
 * events. Deepgram can't be dialled directly by Twilio because its socket needs
 * an Authorization header, which <Stream> cannot set; that, and holding the
 * call's tenant context, is the whole reason this bridge exists.
 */
export async function GET(req: NextRequest) {
  return experimental_upgradeWebSocket(async (twilioWs: WebSocket) => {
    let streamSid: string | null = null;
    let deepgram: WebSocket | null = null;
    let keepalive: ReturnType<typeof setInterval> | null = null;
    let closed = false;

    // Twilio starts streaming media the instant the call connects, but we can't
    // forward any of it until the Deepgram socket has accepted its Settings
    // frame. Buffering rather than dropping means the caller's first words —
    // often the whole reason they rang — survive the setup round trip.
    const pending: Buffer[] = [];
    let deepgramReady = false;

    const ctx: { salonId?: string; sessionId?: string; customerPhone?: string; callSid?: string } = {};

    const teardown = (reason: string) => {
      if (closed) return;
      closed = true;
      if (keepalive) clearInterval(keepalive);
      try { deepgram?.close(); } catch {}
      try { twilioWs.close(); } catch {}
      safeLog({
        type: 'integration',
        level: 'info',
        category: 'session',
        event: 'voice_call_ended',
        tenant_id: ctx.salonId,
        session_id: ctx.sessionId,
        call_sid: ctx.callSid,
        reason,
      });
    };

    const sendToTwilio = (audio: Buffer) => {
      if (!streamSid || twilioWs.readyState !== WebSocket.OPEN) return;
      twilioWs.send(
        JSON.stringify({ event: 'media', streamSid, media: { payload: audio.toString('base64') } })
      );
    };

    async function connectDeepgram(params: Record<string, string>) {
      const apiKey = process.env.DEEPGRAM_API_KEY;
      if (!apiKey) {
        logError('system', 'voice_bridge_missing_api_key', new Error('DEEPGRAM_API_KEY is not set'), {
          source: 'api.voice.bridge',
        });
        return teardown('missing_api_key');
      }

      ctx.salonId = params.salonId;
      ctx.sessionId = params.sessionId;
      ctx.customerPhone = params.from;

      const [{ data: salon }, workers, faqs, { data: session }] = await Promise.all([
        supabase.from('business_profiles').select('*').eq('id', params.salonId).single(),
        getWorkers(params.salonId),
        getFAQs(params.salonId),
        supabase.from('sessions').select('metadata').eq('id', params.sessionId).single(),
      ]);

      if (!salon) {
        logError('session', 'voice_bridge_missing_salon', new Error(`No salon ${params.salonId}`), {
          source: 'api.voice.bridge',
          call_sid: ctx.callSid,
        });
        return teardown('missing_salon');
      }

      const settings = buildVoiceAgentSettings({
        salon,
        workers,
        faqs,
        bookingState: (session?.metadata as any)?.booking_state || null,
      });

      deepgram = new WebSocket(DEEPGRAM_AGENT_URL, {
        headers: { Authorization: `Token ${apiKey}` },
      });

      deepgram.on('open', () => {
        deepgram!.send(JSON.stringify(settings));
        keepalive = setInterval(() => {
          if (deepgram?.readyState === WebSocket.OPEN) {
            deepgram.send(JSON.stringify({ type: 'KeepAlive' }));
          }
        }, KEEPALIVE_MS);
      });

      deepgram.on('message', (data: Buffer, isBinary: boolean) => {
        if (isBinary) return sendToTwilio(data);
        handleDeepgramEvent(data.toString());
      });

      deepgram.on('error', (error: any) => {
        logError('ai', 'voice_bridge_deepgram_error', error, {
          source: 'api.voice.bridge',
          tenant_id: ctx.salonId,
          session_id: ctx.sessionId,
        });
        teardown('deepgram_error');
      });

      deepgram.on('close', () => teardown('deepgram_closed'));
    }

    async function handleDeepgramEvent(raw: string) {
      let message: any;
      try {
        message = JSON.parse(raw);
      } catch {
        return;
      }

      switch (message.type) {
        case 'SettingsApplied':
          deepgramReady = true;
          for (const chunk of pending.splice(0)) deepgram?.send(chunk);
          break;

        case 'UserStartedSpeaking':
          // Barge-in: Twilio has already buffered whatever the agent was
          // mid-sentence on. Without this the caller talks over audio that was
          // queued seconds ago and the call feels broken.
          if (streamSid && twilioWs.readyState === WebSocket.OPEN) {
            twilioWs.send(JSON.stringify({ event: 'clear', streamSid }));
          }
          break;

        case 'ConversationText':
          // The spoken conversation lands in `transcripts` like any other
          // channel, so the dashboard inbox shows calls next to SMS threads.
          if (ctx.sessionId && message.content) {
            await saveMessage(
              ctx.sessionId,
              message.role === 'user' ? 'user' : 'assistant',
              message.content
            ).catch(() => {});
          }
          break;

        case 'FunctionCallRequest': {
          if (!ctx.salonId || !ctx.sessionId || !ctx.customerPhone) break;
          const responses = await handleFunctionCallRequest(message, {
            salonId: ctx.salonId,
            sessionId: ctx.sessionId,
            customerPhone: ctx.customerPhone,
          });
          for (const response of responses) {
            if (deepgram?.readyState === WebSocket.OPEN) deepgram.send(JSON.stringify(response));
          }
          break;
        }

        case 'Error':
          logError('ai', 'voice_bridge_agent_error', new Error(message.description || 'Deepgram agent error'), {
            source: 'api.voice.bridge',
            tenant_id: ctx.salonId,
            session_id: ctx.sessionId,
            code: message.code,
          });
          break;
      }
    }

    twilioWs.on('message', (data: Buffer) => {
      let frame: any;
      try {
        frame = JSON.parse(data.toString());
      } catch {
        return;
      }

      if (frame.event === 'start') {
        streamSid = frame.start?.streamSid || null;
        ctx.callSid = frame.start?.callSid || null;
        const params = frame.start?.customParameters || {};
        if (!params.salonId || !params.sessionId) return teardown('missing_stream_parameters');
        connectDeepgram(params).catch((error: any) => {
          logError('ai', 'voice_bridge_setup_failed', error, {
            source: 'api.voice.bridge',
            call_sid: ctx.callSid,
          });
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
    twilioWs.on('error', () => teardown('twilio_error'));
  });
}
