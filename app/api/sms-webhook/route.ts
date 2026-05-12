import { NextRequest, NextResponse } from 'next/server';
import { getSalonBySmsNumber, getOrCreateConversation, getTranscriptHistory, saveMessage, getWorkers, getFAQs, getActiveHold, supabase } from '../../../lib/supabase';
import { buildSystemPrompt } from '../../../lib/agent';
import { callAI } from '../../../lib/ai';
import { getSMSMessageWithPricing, sendSMS } from '../../../lib/twilio';
import { isHandoff } from '../../../lib/handoff';
import { executeToolCall, ToolContext } from '../../../lib/tool-handler';
import { logAppError, toErrorLogPayload } from '../../../lib/error-logger';
import { safeLog } from '@/lib/logger';
import { normalizeSmsPrice } from '@/lib/sms-pricing';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const userInput = formData.get('Body') as string;
    const fromNumber = formData.get('From') as string;
    const toNumber = formData.get('To') as string;
    const inboundMessageSid = (formData.get('MessageSid') || formData.get('SmsMessageSid')) as string | null;

    const salon = await getSalonBySmsNumber(toNumber);
    if (!salon) return new NextResponse('<Response></Response>', { status: 200, headers: { 'Content-Type': 'text/xml' } });

    const conversation = await getOrCreateConversation(salon.id, fromNumber);
    safeLog({
      level: 'info',
      category: 'sms',
      event: 'sms_received',
      from: fromNumber,
      to: toNumber,
      body: userInput,
      tenant_id: salon.id,
      session_id: conversation.id,
    });
    const userMessage = await saveMessage(conversation.id, 'user', userInput);

    if (inboundMessageSid && userMessage?.id) {
      let inboundTwilioMessage: any = null;
      const inboundPrice = formData.get('Price');
      const inboundPriceUnit = formData.get('PriceUnit');
      const inboundNumSegments = formData.get('NumSegments');

      if (!inboundPrice || !inboundPriceUnit || !inboundNumSegments) {
        try {
          inboundTwilioMessage = await getSMSMessageWithPricing(inboundMessageSid);
        } catch (error: any) {
          safeLog({
            level: 'warning',
            category: 'sms',
            event: 'sms_price_lookup_failed',
            tenant_id: salon.id,
            session_id: conversation.id,
            twilio_message_sid: inboundMessageSid,
            error: error?.message || String(error),
            stack: error?.stack,
          });
        }
      }

      const inboundSmsPrice = normalizeSmsPrice(inboundPrice || inboundTwilioMessage?.price);
      const inboundSmsPriceUnit = (inboundPriceUnit as string | null) || inboundTwilioMessage?.priceUnit || inboundTwilioMessage?.price_unit || null;
      const inboundSmsNumSegments = (inboundNumSegments as string | null) || inboundTwilioMessage?.numSegments || inboundTwilioMessage?.num_segments || null;
      const inboundSmsStatus = (formData.get('SmsStatus') as string | null) || inboundTwilioMessage?.status || 'received';

      await supabase
        .from('transcripts')
        .update({
          twilio_message_sid: inboundMessageSid,
          sms_direction: 'inbound',
          sms_status: inboundSmsStatus,
          sms_price: inboundSmsPrice,
          sms_price_unit: inboundSmsPriceUnit,
          sms_num_segments: inboundSmsNumSegments,
          sms_error_code: (formData.get('ErrorCode') as string | null) || inboundTwilioMessage?.errorCode || null,
          sms_error_message: (formData.get('ErrorMessage') as string | null) || inboundTwilioMessage?.errorMessage || null,
          sms_from_number: fromNumber,
          sms_to_number: toNumber,
          sms_updated_at: new Date().toISOString(),
        })
        .eq('id', userMessage.id);

      safeLog({
        level: 'info',
        category: 'sms',
        event: 'sms_metadata_updated',
        tenant_id: salon.id,
        session_id: conversation.id,
        twilio_message_sid: inboundMessageSid,
        sms_direction: 'inbound',
        sms_status: inboundSmsStatus,
        sms_price: inboundSmsPrice,
        sms_price_unit: inboundSmsPriceUnit,
        sms_num_segments: inboundSmsNumSegments,
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
        status: 'review',
        updated_at: new Date().toISOString()
      }).eq('id', conversation.id);
      
      return new NextResponse('<Response></Response>', { status: 200, headers: { 'Content-Type': 'text/xml' } });
    }

    await supabase.from('sessions').update({
      metadata: { ...conversation.metadata, tokens: aiResponse.tokens, booking_state: updatedBookingState },
      status: triggerHandoff ? 'handed_over' : 'active',
      updated_at: new Date().toISOString()
    }).eq('id', conversation.id);

    const statusCallbackUrl =
      process.env.TWILIO_STATUS_CALLBACK_URL || new URL('/api/twilio/status', req.url).toString();
    const outboundMessage = await sendSMS(fromNumber, reply, statusCallbackUrl, {
      tenant_id: salon.id,
      session_id: conversation.id,
    });
    const assistantMessage = await saveMessage(conversation.id, 'assistant', reply);

    if (assistantMessage?.id) {
      await supabase
        .from('transcripts')
        .update({
          twilio_message_sid: outboundMessage.sid,
          sms_direction: 'outbound',
          sms_status: outboundMessage.status || null,
          sms_price: normalizeSmsPrice(outboundMessage.price),
          sms_price_unit: outboundMessage.priceUnit || null,
          sms_num_segments: outboundMessage.numSegments || null,
          sms_error_code: outboundMessage.errorCode || null,
          sms_error_message: outboundMessage.errorMessage || null,
          sms_from_number: outboundMessage.from || null,
          sms_to_number: outboundMessage.to || null,
          sms_updated_at: new Date().toISOString(),
        })
        .eq('id', assistantMessage.id);
    }

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
       const { notifyOwnerHandoff } = await import('../../../lib/handoff_service');
       await notifyOwnerHandoff(conversation.id, salon.id);
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
