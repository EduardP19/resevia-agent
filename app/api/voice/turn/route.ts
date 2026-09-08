import { NextRequest, NextResponse } from 'next/server';
import { handleFunctionCallRequest } from '@/lib/voice-tools';
import { logError, withRequestContext } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * Deepgram Voice Agent function-calling endpoint.
 *
 * The bridge (/api/voice/bridge) normally executes tools in-process, because it
 * already holds the call's context and skips an HTTP hop. This route is the same
 * logic over HTTP, for two cases: configuring Deepgram functions with a server-side
 * `endpoint` instead of client-side execution, and exercising the booking tools
 * against a real session without placing a phone call.
 *
 * Call context is not in the body — Deepgram's FunctionCallRequest only carries
 * the function name and arguments — so it comes from the query string of the
 * endpoint URL, which is built per call when the Settings frame is assembled.
 *
 * Auth: VOICE_TURN_SECRET as a bearer token. Without it the route is closed
 * rather than open, since it can create real Cal.com bookings.
 */
export async function POST(req: NextRequest) {
  return withRequestContext({ path: '/api/voice/turn' }, async () => {
    const secret = process.env.VOICE_TURN_SECRET;
    if (!secret) {
      return NextResponse.json({ error: 'Voice turn endpoint not configured' }, { status: 503 });
    }
    if (req.headers.get('authorization') !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(req.url);
    const salonId = url.searchParams.get('salonId');
    const sessionId = url.searchParams.get('sessionId');
    const customerPhone = url.searchParams.get('from');

    if (!salonId || !sessionId || !customerPhone) {
      return NextResponse.json(
        { error: 'salonId, sessionId and from are required query parameters' },
        { status: 400 }
      );
    }

    try {
      const body = await req.json();
      const responses = await handleFunctionCallRequest(body, { salonId, sessionId, customerPhone });

      // A server-side endpoint answers one function per request; the bridge's
      // client-side path is the one that batches.
      return NextResponse.json(responses.length === 1 ? responses[0] : { responses });
    } catch (error: any) {
      logError('tool', 'voice_turn_failed', error, {
        source: 'api.voice.turn',
        path: '/api/voice/turn',
        method: 'POST',
        tenant_id: salonId,
        session_id: sessionId,
      });
      return NextResponse.json({ error: 'Tool execution failed' }, { status: 500 });
    }
  });
}
