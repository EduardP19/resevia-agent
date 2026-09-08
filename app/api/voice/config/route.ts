import { NextRequest, NextResponse } from 'next/server';
import { getFAQs, getWorkers, supabase } from '@/lib/supabase';
import { buildVoiceAgentSettings } from '@/lib/voice-agent';
import { logError, safeLog, withRequestContext } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const maxDuration = 15;

/**
 * Per-call Deepgram Settings for the audio bridge.
 *
 * The bridge runs on a different host (Vercel functions can't hold WebSockets
 * without an entitlement this account doesn't have), so it has no database
 * access and no business logic. It asks this endpoint for the agent's whole
 * configuration — system prompt, services, FAQs, tool schemas — and forwards it
 * to Deepgram verbatim. Everything tenant-specific stays here.
 *
 * Tools are configured for server-side execution, pointing back at
 * /api/voice/turn, so the bridge never touches Cal.com or Supabase either.
 */
export async function GET(req: NextRequest) {
  return withRequestContext({ path: '/api/voice/config' }, async () => {
    const secret = process.env.VOICE_TURN_SECRET;
    if (!secret) {
      return NextResponse.json({ error: 'Voice endpoints not configured' }, { status: 503 });
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
      const [{ data: salon }, workers, faqs, { data: session }] = await Promise.all([
        supabase.from('business_profiles').select('*').eq('id', salonId).single(),
        getWorkers(salonId),
        getFAQs(salonId),
        supabase.from('sessions').select('metadata').eq('id', sessionId).single(),
      ]);

      if (!salon) {
        return NextResponse.json({ error: 'Salon not found' }, { status: 404 });
      }

      const toolUrl = new URL('/api/voice/turn', req.url);
      toolUrl.searchParams.set('salonId', salonId);
      toolUrl.searchParams.set('sessionId', sessionId);
      toolUrl.searchParams.set('from', customerPhone);

      const settings = buildVoiceAgentSettings({
        salon,
        workers,
        faqs,
        bookingState: (session?.metadata as any)?.booking_state || null,
        toolEndpoint: {
          url: toolUrl.toString(),
          headers: { authorization: `Bearer ${secret}` },
        },
      });

      safeLog({
        type: 'integration',
        level: 'info',
        category: 'session',
        event: 'voice_config_issued',
        tenant_id: salonId,
        session_id: sessionId,
      });

      return NextResponse.json(settings);
    } catch (error: any) {
      logError('session', 'voice_config_failed', error, {
        source: 'api.voice.config',
        path: '/api/voice/config',
        tenant_id: salonId,
        session_id: sessionId,
      });
      return NextResponse.json({ error: 'Could not build voice settings' }, { status: 500 });
    }
  });
}
