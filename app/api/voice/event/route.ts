import { NextRequest, NextResponse } from 'next/server';
import { saveMessage, supabase } from '@/lib/supabase';
import { logError, safeLog, withRequestContext } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const maxDuration = 15;

/**
 * Conversation events forwarded by the audio bridge.
 *
 * Deepgram executes the booking tools itself, so the bridge sees the spoken
 * conversation but has nowhere to put it. This writes it to `transcripts` and
 * closes the session on hangup, which is what makes a phone call show up in the
 * dashboard inbox alongside SMS and WhatsApp threads instead of as an empty row.
 */
export async function POST(req: NextRequest) {
  return withRequestContext({ path: '/api/voice/event' }, async () => {
    const secret = process.env.VOICE_TURN_SECRET;
    if (!secret) {
      return NextResponse.json({ error: 'Voice endpoints not configured' }, { status: 503 });
    }
    if (req.headers.get('authorization') !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
      const { sessionId, tenantId, event, role, content, reason } = await req.json();
      if (!sessionId) {
        return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
      }

      if (event === 'transcript' && content) {
        await saveMessage(sessionId, role === 'user' ? 'user' : 'assistant', content);
      }

      if (event === 'call_ended') {
        // Voice has an explicit end that text doesn't — the caller hangs up. No
        // need to wait for the 5-minute inactivity sweep to close the session.
        await supabase
          .from('sessions')
          .update({ status: 'completed', updated_at: new Date().toISOString() })
          .eq('id', sessionId)
          .in('status', ['active', 'review']);

        safeLog({
          type: 'integration',
          level: 'info',
          category: 'session',
          event: 'voice_call_ended',
          tenant_id: tenantId,
          session_id: sessionId,
          reason,
        });
      }

      return NextResponse.json({ ok: true });
    } catch (error: any) {
      logError('session', 'voice_event_failed', error, {
        source: 'api.voice.event',
        path: '/api/voice/event',
      });
      return NextResponse.json({ error: 'Could not record voice event' }, { status: 500 });
    }
  });
}
