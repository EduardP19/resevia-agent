import { NextRequest, NextResponse } from 'next/server';
import {
  getOrCreateConversation,
  getSalonById,
  refreshSessionSummary,
  saveMessage,
  supabase,
} from '@/lib/supabase';
import { sendSMS, sendWhatsAppTemplate } from '@/lib/twilio';
import { log, safeLog } from '@/lib/logger';
import { requireDashboardSessionFromRequest } from '@/lib/dashboard-auth';
import { getAgentName } from '@/lib/agent-name';
import {
  smsMetadataFromTwilioMessage,
  updateTranscriptSmsMetadata,
  upsertSmsMessage,
} from '@/lib/sms-messages';

type InitiateChannel = 'whatsapp' | 'sms';

/**
 * Owner-triggered outbound initiation.
 *
 * WhatsApp initiation sends a pre-approved Content template (required outside
 * the 24h window). If the WhatsApp send fails — or the tenant has no WhatsApp
 * sender configured — we fall back to a free-form SMS so the outreach still
 * lands. Either way the customer's reply continues the conversation on whatever
 * channel actually delivered (recorded as session.channel).
 */
export async function POST(req: NextRequest) {
  const auth = requireDashboardSessionFromRequest(req);
  if (auth.response) return auth.response;

  try {
    const body = await req.json();
    const clientPhone: string = (body?.clientPhone || '').trim();
    const requestedChannel: InitiateChannel = body?.channel === 'whatsapp' ? 'whatsapp' : 'sms';
    const smsMessage: string = (body?.message || '').trim();
    const contentVariables: Record<string, string> | undefined =
      body?.contentVariables && typeof body.contentVariables === 'object' ? body.contentVariables : undefined;
    // Human-readable rendering of the WA template, stored as the transcript so
    // the owner sees what the customer received (template body lives in Twilio).
    const templatePreview: string = (body?.templatePreview || '').trim();

    if (!clientPhone) {
      return NextResponse.json({ error: 'clientPhone is required' }, { status: 400 });
    }
    // A free-form body is mandatory for any SMS send (chosen directly or as the
    // WhatsApp fallback), since SMS has no template concept.
    if (requestedChannel === 'sms' && !smsMessage) {
      return NextResponse.json({ error: 'message is required for SMS initiation' }, { status: 400 });
    }

    const tenantId = auth.session.tenantId;
    const statusCallbackUrl =
      process.env.TWILIO_STATUS_CALLBACK_URL || new URL('/api/twilio/status', req.url).toString();

    let deliveredChannel: InitiateChannel = requestedChannel;
    let outboundMessage: any = null;
    let fellBackToSms = false;
    let transcriptContent = '';

    // --- Attempt WhatsApp template first when requested -----------------------
    if (requestedChannel === 'whatsapp') {
      try {
        // Always populate {{agent}} from the salon's own configured agent
        // name — never trust a client-supplied value for this slot.
        const salon = await getSalonById(tenantId);
        const agentVariables = { ...contentVariables, agent: getAgentName(salon) };

        outboundMessage = await sendWhatsAppTemplate(
          clientPhone,
          { contentSid: salon?.whatsapp_template_sid || undefined, contentVariables: agentVariables, statusCallbackUrl },
          { tenant_id: tenantId }
        );
        deliveredChannel = 'whatsapp';
        transcriptContent = templatePreview || '[WhatsApp template sent]';
      } catch (waError: any) {
        // WhatsApp unavailable/errored — fall back to SMS if we have a body.
        safeLog({
          level: 'warning',
          category: 'sms',
          event: 'whatsapp_initiation_fallback',
          tenant_id: tenantId,
          error: waError?.message || String(waError),
          code: waError?.code || null,
        });

        if (!smsMessage) {
          return NextResponse.json(
            {
              error:
                'WhatsApp send failed and no SMS fallback message was provided. Add a fallback message and retry.',
              code: waError?.code || null,
              fallbackRequired: true,
            },
            { status: 502 }
          );
        }
        fellBackToSms = true;
      }
    }

    // --- SMS path (direct choice OR WhatsApp fallback) ------------------------
    if (deliveredChannel === 'sms' || fellBackToSms) {
      outboundMessage = await sendSMS(clientPhone, smsMessage, statusCallbackUrl, { tenant_id: tenantId });
      deliveredChannel = 'sms';
      transcriptContent = smsMessage;
    }

    // --- Persist the conversation on the delivered channel --------------------
    const conversation = await getOrCreateConversation(tenantId, clientPhone, undefined, deliveredChannel);

    // Make sure an existing/reused session is tagged to the channel we used.
    await supabase
      .from('sessions')
      .update({ channel: deliveredChannel, status: 'active', updated_at: new Date().toISOString() })
      .eq('id', conversation.id);

    const assistantMessage = await saveMessage(conversation.id, 'assistant', transcriptContent);

    const outboundMetadata = {
      twilioMessageSid: outboundMessage.sid,
      direction: 'outbound' as const,
      ...smsMetadataFromTwilioMessage(outboundMessage),
    };
    if (assistantMessage?.id) {
      await updateTranscriptSmsMetadata(assistantMessage.id, outboundMetadata);
    }
    await upsertSmsMessage({
      ...outboundMetadata,
      channel: deliveredChannel,
      sessionId: conversation.id,
      transcriptId: assistantMessage?.id ?? null,
      salonId: tenantId,
      rawPayload: outboundMessage,
    });

    await refreshSessionSummary(conversation.id, 'active').catch(() => {});

    await log({
      level: 'info',
      category: 'dashboard',
      event: 'conversation_initiated',
      tenant_id: tenantId,
      session_id: conversation.id,
      user_id: auth.session.email,
      channel: deliveredChannel,
      requested_channel: requestedChannel,
      fell_back_to_sms: fellBackToSms,
    });

    return NextResponse.json({
      success: true,
      sessionId: conversation.id,
      channel: deliveredChannel,
      fellBackToSms,
    });
  } catch (error: any) {
    safeLog({
      level: 'error',
      category: 'system',
      event: 'db_error',
      error: error?.message || String(error),
      stack: error?.stack,
      query_description: 'Initiate outbound conversation',
      tenant_id: auth.session.tenantId,
    });
    return NextResponse.json(
      { error: error?.message || 'Failed to initiate conversation', code: error?.code || null },
      { status: 500 }
    );
  }
}
