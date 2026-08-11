import { NextRequest, NextResponse } from 'next/server';
import { refreshSessionSummary, saveMessage, supabase } from '@/lib/supabase';
import { sendOnChannel, type MessageChannel } from '@/lib/twilio';
import { log, safeLog } from '@/lib/logger';
import { requireDashboardSessionFromRequest } from '@/lib/dashboard-auth';
import {
  smsMetadataFromTwilioMessage,
  upsertSmsMessage,
} from '@/lib/sms-messages';

export async function POST(req: NextRequest) {
  const auth = requireDashboardSessionFromRequest(req);
  if (auth.response) return auth.response;

  try {
    const { sessionId, content, mode } = await req.json();

    const { data: session, error: sError } = await supabase
      .from('sessions')
      .select('*, business_profiles(twilio_number, whatsapp_number)')
      .eq('id', sessionId)
      .eq('salon_id', auth.session.tenantId)
      .single();

    if (!session || sError) return NextResponse.json({ error: 'Session not found' }, { status: 404 });

    // 1. Send on the session's own channel (WhatsApp replies here are free-form,
    //    which is valid because the customer just messaged — we're inside the 24h window).
    const channel: MessageChannel = session.channel === 'whatsapp' ? 'whatsapp' : 'sms';
    const statusCallbackUrl =
      process.env.TWILIO_STATUS_CALLBACK_URL || new URL('/api/twilio/status', req.url).toString();
    const outboundMessage = await sendOnChannel(channel, session.client_identifier, content, statusCallbackUrl, {
      tenant_id: session.salon_id,
      session_id: sessionId,
    });

    // 2. Save as final assistant message
    const assistantMessage = await saveMessage(sessionId, 'assistant', content);

    const outboundMetadata = {
      twilioMessageSid: outboundMessage.sid,
      direction: 'outbound' as const,
      ...smsMetadataFromTwilioMessage(outboundMessage),
    };
    await upsertSmsMessage({
      ...outboundMetadata,
      channel,
      sessionId,
      transcriptId: assistantMessage?.id ?? null,
      salonId: session.salon_id,
      rawPayload: outboundMessage,
    });
    
    // Delete any drafts for this session to clean up
    await supabase.from('transcripts').delete().eq('session_id', sessionId).eq('role', 'draft');

    // 3. Update session status to active
    await supabase.from('sessions').update({
      status: 'active',
      updated_at: new Date().toISOString()
    }).eq('id', sessionId);
    await refreshSessionSummary(sessionId, 'active').catch(() => {});

    const userId = auth.session.email;
    await log({
      type: 'audit',
      level: 'info',
      category: 'dashboard',
      event: 'message_approved',
      tenant_id: session.salon_id,
      session_id: sessionId,
      user_id: userId,
    });
    await log({
      type: 'audit',
      level: 'info',
      category: 'session',
      event: 'draft_approved',
      tenant_id: session.salon_id,
      session_id: sessionId,
      user_id: userId,
    });
    if (mode === 'manual') {
      await log({
        type: 'audit',
        level: 'info',
        category: 'dashboard',
        event: 'takeover_started',
        tenant_id: session.salon_id,
        session_id: sessionId,
        user_id: userId,
      });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[Approve Error]', error);
    safeLog({
      type: 'error',
      level: 'error',
      category: 'system',
      event: 'db_error',
      error: error?.message || String(error),
      stack: error?.stack,
      query_description: 'Approve dashboard draft and send SMS',
      tenant_id: auth.session.tenantId,
    });
    return NextResponse.json(
      {
        error: error.message || 'Failed to send message',
        code: error.code || null,
        status: error.status || null,
      },
      { status: 500 }
    );
  }
}
