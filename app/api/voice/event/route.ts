import { NextRequest, NextResponse } from 'next/server';
import { refreshSessionSummary, saveMessageToTable, supabase } from '@/lib/supabase';
import { waitUntil } from '@vercel/functions';
import { z } from 'zod';
import { logError, safeLog, withRequestContext } from '@/lib/logger';
import { recordVoiceCost } from '@/lib/costs';

export const dynamic = 'force-dynamic';
export const maxDuration = 15;

const eventSchema = z.object({
  sessionId: z.string().uuid(), tenantId: z.string().uuid(),
  event: z.enum(['transcript', 'call_ended', 'heartbeat']),
  eventId: z.string().uuid().optional(),
  occurredAt: z.string().datetime().optional(),
  role: z.enum(['user', 'assistant']).optional(),
  content: z.string().trim().min(1).max(20000).optional(),
  reason: z.string().max(200).optional(),
});

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
      const parsed = eventSchema.safeParse(await req.json());
      if (!parsed.success) {
        return NextResponse.json({ error: 'Invalid call event' }, { status: 400 });
      }
      const { sessionId, tenantId, event, eventId, occurredAt, role, content, reason } = parsed.data;
      const { data: session, error: sessionError } = await supabase.from('sessions')
        .select('id, created_at').eq('id', sessionId).eq('salon_id', tenantId).eq('channel', 'voice').maybeSingle();
      if (sessionError) throw sessionError;
      if (!session) return NextResponse.json({ error: 'Call not found' }, { status: 404 });

      if (event === 'transcript') {
        if (!content || !role) return NextResponse.json({ error: 'Transcript role and content are required' }, { status: 400 });
        try {
          await saveMessageToTable(sessionId, role, content, 'transcripts', undefined, {
            channel: 'voice', ...(eventId ? { id: eventId } : {}),
            ...(occurredAt ? { created_at: occurredAt } : {}),
          });
        } catch (error: any) {
          if (error?.code !== '23505' || !eventId) throw error;
        }
      }

      if (event === 'transcript' || event === 'heartbeat') {
        const { error } = await supabase.from('sessions').update({ updated_at: new Date().toISOString() })
          .eq('id', sessionId).eq('salon_id', tenantId).in('status', ['active', 'review']);
        if (error) throw error;
      }

      if (event === 'call_ended') {
        // Voice has an explicit end that text doesn't — the caller hangs up. No
        // need to wait for the 5-minute inactivity sweep to close the session.
        const { error } = await supabase
          .from('sessions')
          .update({ status: 'completed', updated_at: new Date().toISOString() })
          .eq('id', sessionId)
          .eq('salon_id', tenantId)
          .in('status', ['active', 'review', 'needs_approval']);
        if (error) throw error;
        waitUntil(refreshSessionSummary(sessionId).catch(() => {}));

        // Voice bills two per-minute meters — Twilio for carriage, Deepgram for
        // the agent — and the session was created by the webhook as the call
        // came in, so its age is the call duration. This is the only point at
        // which that duration is knowable, since the bridge is a separate
        // service and Deepgram's usage API reports per project, not per call.
        const seconds = session.created_at
          ? (Date.now() - new Date(session.created_at).getTime()) / 1000
          : 0;
        waitUntil(
          recordVoiceCost({
            salonId: tenantId,
            sessionId,
            seconds,
            agentHandled: true,
            reason,
          })
        );

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
