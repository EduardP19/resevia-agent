import { NextRequest, NextResponse } from 'next/server';
import {
  findRecentDuplicateUserMessage,
  getActiveHold,
  getFAQs,
  getOrCreateConversation,
  getSalonBySmsNumber,
  getTranscriptHistory,
  getWorkers,
  saveMessage,
  saveMessageToTable,
  supabase,
} from '../../../lib/supabase';
import { buildSystemPrompt } from '../../../lib/agent';
import { callAI } from '../../../lib/ai';
import { sendSMS } from '../../../lib/twilio';
import { isHandoff } from '../../../lib/handoff';
import { executeToolCall, ToolContext } from '../../../lib/tool-handler';
import { logAppError, toErrorLogPayload } from '../../../lib/error-logger';
import { log, safeLog } from '@/lib/logger';
import { normalizeCustomerReply } from '@/lib/reply-format';
import { notifyOwnerConversationAttention } from '@/lib/owner-email-notifications';
import {
  formDataToRecord,
  numberOrNull,
  smsMetadataFromTwilioMessage,
  updateTranscriptSmsMetadata,
  upsertSmsMessage,
} from '@/lib/sms-messages';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const rawSmsPayload = formDataToRecord(formData);
    const userInput = formData.get('Body') as string;
    const fromNumber = formData.get('From') as string;
    const toNumber = formData.get('To') as string;
    const inboundMessageSid = (formData.get('MessageSid') || formData.get('SmsMessageSid')) as string | null;

    const salon = await getSalonBySmsNumber(toNumber);
    if (!salon) return new NextResponse('<Response></Response>', { status: 200, headers: { 'Content-Type': 'text/xml' } });

    const conversation = await getOrCreateConversation(salon.id, fromNumber);
    await log({
      level: 'info',
      category: 'sms',
      event: 'sms_received',
      from: fromNumber,
      to: toNumber,
      body: userInput,
      tenant_id: salon.id,
      session_id: conversation.id,
    });

    if (inboundMessageSid) {
      const { data: existingInbound } = await supabase
        .from('transcripts')
        .select('id')
        .eq('twilio_message_sid', inboundMessageSid)
        .maybeSingle();

      if (existingInbound) {
        safeLog({
          level: 'info',
          category: 'sms',
          event: 'duplicate_inbound_sms_ignored',
          tenant_id: salon.id,
          session_id: conversation.id,
          twilio_message_sid: inboundMessageSid,
        });
        return new NextResponse('<Response></Response>', { status: 200, headers: { 'Content-Type': 'text/xml' } });
      }
    }

    const duplicateUserMessage = await findRecentDuplicateUserMessage(conversation.id, userInput);
    if (duplicateUserMessage) {
      safeLog({
        level: 'info',
        category: 'sms',
        event: 'duplicate_inbound_content_ignored',
        tenant_id: salon.id,
        session_id: conversation.id,
      });
      return new NextResponse('<Response></Response>', { status: 200, headers: { 'Content-Type': 'text/xml' } });
    }

    let userMessage;
    try {
      userMessage = inboundMessageSid
        ? await saveMessageToTable(conversation.id, 'user', userInput, 'transcripts', undefined, {
            twilio_message_sid: inboundMessageSid,
          })
        : await saveMessage(conversation.id, 'user', userInput);
    } catch (error: any) {
      if (inboundMessageSid && error?.code === '23505') {
        safeLog({
          level: 'info',
          category: 'sms',
          event: 'duplicate_inbound_sms_ignored',
          tenant_id: salon.id,
          session_id: conversation.id,
          twilio_message_sid: inboundMessageSid,
        });
        return new NextResponse('<Response></Response>', { status: 200, headers: { 'Content-Type': 'text/xml' } });
      }
      throw error;
    }

    if (inboundMessageSid && userMessage?.id) {
      const inboundSmsStatus = (formData.get('SmsStatus') as string | null) || 'received';
      const inboundMetadata = {
        twilioMessageSid: inboundMessageSid,
        direction: 'inbound' as const,
        status: inboundSmsStatus,
        numSegments: numberOrNull(formData.get('NumSegments')),
        errorCode: (formData.get('ErrorCode') as string | null) || null,
        errorMessage: (formData.get('ErrorMessage') as string | null) || null,
        fromNumber,
        toNumber,
      };

      await updateTranscriptSmsMetadata(userMessage.id, inboundMetadata);
      await upsertSmsMessage({
        ...inboundMetadata,
        sessionId: conversation.id,
        transcriptId: userMessage.id,
        salonId: salon.id,
        rawPayload: rawSmsPayload,
      });

      safeLog({
        level: 'info',
        category: 'sms',
        event: 'sms_metadata_updated',
        tenant_id: salon.id,
        session_id: conversation.id,
        twilio_message_sid: inboundMessageSid,
        sms_direction: 'inbound',
        sms_status: inboundSmsStatus,
        sms_num_segments: inboundMetadata.numSegments,
      });
    }

    const [workers, faqs, activeHold, history] = await Promise.all([
      getWorkers(salon.id),
      getFAQs(salon.id),
      getActiveHold(fromNumber),
      getTranscriptHistory(conversation.id)
    ]);

    const bookingState = (conversation.metadata as any)?.booking_state || null;
    let systemPrompt = buildSystemPrompt(salon, workers, faqs, bookingState);
    let updatedBookingState = bookingState || {};
    
    if (activeHold) {
       systemPrompt += `\n\n[SYSTEM INFO] You currently have a slot held for this client: ${activeHold.service_name} at ${new Date(activeHold.start_time).toLocaleString()}. They need to confirm to finalize.`;
    }

    if (updatedBookingState?.service) {
      systemPrompt += `\n\n[SYSTEM REMINDER] The service is ALREADY LOCKED as "${updatedBookingState.service}". Do NOT ask for it. Do NOT mention other services. Focus ONLY on date and time.`;
    }

    const toolCtx: ToolContext = {
      salonId: salon.id,
      sessionId: conversation.id,
      customerPhone: fromNumber,
      salon,
      workers,
      faqs,
      salonServices: salon.services
    };

    let aiResponse = await callAI(
      systemPrompt,
      history.map((h: any) => ({ role: h.role, content: h.content })),
      { tenant_id: salon.id, session_id: conversation.id }
    );

    let toolCallCount = 0;
    while (aiResponse.tool_call && toolCallCount < 5) {
      toolCallCount++;
      const { name, args } = aiResponse.tool_call;

      const result = await executeToolCall(name, args, toolCtx, updatedBookingState);

      if (result.updatedBookingState) updatedBookingState = result.updatedBookingState;
      if (result.updatedSystemPrompt) systemPrompt = result.updatedSystemPrompt;

      await saveMessage(conversation.id, 'system' as any, `Tool (${name}): ${result.toolResult}`);
      const updatedHistory = await getTranscriptHistory(conversation.id);
      aiResponse = await callAI(
        systemPrompt,
        updatedHistory.map((h: any) => ({ role: h.role, content: h.content })),
        { tenant_id: salon.id, session_id: conversation.id }
      );
    }

    let reply =
      aiResponse.reply ||
      "I'm sorry, I ran into an issue processing your previous message. Could you please rephrase your last question?";
    reply = normalizeCustomerReply(reply);
    const triggerHandoff = isHandoff(reply);

    if (salon.approval_mode) {
      await saveMessage(conversation.id, 'draft' as any, reply);
      safeLog({
        level: 'info',
        category: 'session',
        event: 'draft_created',
        tenant_id: salon.id,
        session_id: conversation.id,
      });
      await supabase.from('sessions').update({
        metadata: { ...conversation.metadata, tokens: aiResponse.tokens, booking_state: updatedBookingState },
        status: 'needs_approval',
        updated_at: new Date().toISOString()
      }).eq('id', conversation.id);

      await notifyOwnerConversationAttention({
        conversationId: conversation.id,
        salonId: salon.id,
        status: 'needs_approval',
        clientPhone: conversation.client_identifier || fromNumber,
      }).catch(() => {});
      
      return new NextResponse('<Response></Response>', { status: 200, headers: { 'Content-Type': 'text/xml' } });
    }

    await supabase.from('sessions').update({
      metadata: { ...conversation.metadata, tokens: aiResponse.tokens, booking_state: updatedBookingState },
      status: triggerHandoff ? 'escalated' : 'active',
      updated_at: new Date().toISOString()
    }).eq('id', conversation.id);

    const statusCallbackUrl =
      process.env.TWILIO_STATUS_CALLBACK_URL || new URL('/api/twilio/status', req.url).toString();
    const outboundMessage = await sendSMS(fromNumber, reply, statusCallbackUrl, {
      tenant_id: salon.id,
      session_id: conversation.id,
    });
    const assistantMessage = await saveMessage(conversation.id, 'assistant', reply);

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
      sessionId: conversation.id,
      transcriptId: assistantMessage?.id ?? null,
      salonId: salon.id,
      rawPayload: outboundMessage,
    });

    // Auto mode should not retain pending drafts from previous manual cycles.
    await supabase
      .from('transcripts')
      .delete()
      .eq('session_id', conversation.id)
      .eq('role', 'draft');

    if (triggerHandoff) {
       safeLog({
         level: 'warning',
         category: 'session',
         event: 'session_escalated',
         tenant_id: salon.id,
         session_id: conversation.id,
         customer_phone: fromNumber,
       });
       await notifyOwnerConversationAttention({
         conversationId: conversation.id,
         salonId: salon.id,
         status: 'escalated',
         clientPhone: conversation.client_identifier || fromNumber,
       }).catch(() => {});
    }

    return new NextResponse('<Response></Response>', { status: 200, headers: { 'Content-Type': 'text/xml' } });
  } catch (error: any) {
    const payload = toErrorLogPayload(error, 'SMS webhook error');
    safeLog({
      level: 'error',
      category: 'system',
      event: 'webhook_error',
      error: payload.message,
      stack: payload.stack || undefined,
    });
    await logAppError({
      source: 'api.sms-webhook',
      message: payload.message,
      stack: payload.stack || undefined,
      path: '/api/sms-webhook',
      method: 'POST',
      runtime: 'server',
    });
    return new NextResponse('<Response></Response>', { status: 200, headers: { 'Content-Type': 'text/xml' } });
  }
}
