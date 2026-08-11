import { NextResponse } from 'next/server';
import {
  findRecentDuplicateUserMessage,
  getActiveHold,
  getFAQs,
  getOrCreateConversation,
  getSalonBySmsNumber,
  getSalonByWhatsAppNumber,
  getTranscriptHistory,
  getWorkers,
  refreshSessionSummary,
  saveMessage,
  saveMessageToTable,
  supabase,
} from '@/lib/supabase';
import { buildSystemPrompt } from '@/lib/agent';
import { callAI } from '@/lib/ai';
import { sendOnChannel, stripWhatsAppPrefix, type MessageChannel } from '@/lib/twilio';
import { isHandoff } from '@/lib/handoff';
import { executeToolCall, ToolContext } from '@/lib/tool-handler';
import { log, safeLog, setRequestContext } from '@/lib/logger';
import { normalizeCustomerReply } from '@/lib/reply-format';
import { scheduleDeferredNotification } from '@/lib/deferred-notifications';
import { addTokens, emptyTokens, recordTokenUsage } from '@/lib/token-usage';
import { resolveEffectiveApprovalMode } from '@/lib/agent-mode';
import { runObserver } from '@/lib/observer';
import {
  findSmsMessageBySid,
  formDataToRecord,
  numberOrNull,
  smsMetadataFromTwilioMessage,
  upsertSmsMessage,
} from '@/lib/sms-messages';

const AI_MODEL = process.env.AI_MODEL_NAME || 'gemini-2.5-flash';
const TWIML_EMPTY = '<Response></Response>';

function twiml() {
  return new NextResponse(TWIML_EMPTY, { status: 200, headers: { 'Content-Type': 'text/xml' } });
}

/**
 * Shared inbound message pipeline for Twilio SMS and WhatsApp webhooks.
 *
 * The two channels are identical except for how the salon is matched from the
 * destination number and the `whatsapp:` address prefix on inbound From/To.
 * The customer's reply always continues on the channel it arrived on, so the
 * outbound reply is sent via `sendOnChannel(channel, ...)`.
 */
export async function handleInboundMessage(req: Request, channel: MessageChannel): Promise<NextResponse> {
  const formData = await req.formData();
  const rawSmsPayload = formDataToRecord(formData);
  const userInput = formData.get('Body') as string;
  const rawFrom = formData.get('From') as string;
  const rawTo = formData.get('To') as string;
  const inboundMessageSid = (formData.get('MessageSid') || formData.get('SmsMessageSid')) as string | null;

  // WhatsApp inbound numbers carry a `whatsapp:` prefix; normalize for storage
  // and matching so the rest of the pipeline is channel-agnostic.
  const fromNumber = channel === 'whatsapp' ? stripWhatsAppPrefix(rawFrom) : rawFrom;
  const toNumber = channel === 'whatsapp' ? stripWhatsAppPrefix(rawTo) : rawTo;

  const salon =
    channel === 'whatsapp' ? await getSalonByWhatsAppNumber(toNumber) : await getSalonBySmsNumber(toNumber);
  if (!salon) return twiml();

  const conversation = await getOrCreateConversation(salon.id, fromNumber, undefined, channel);

  // From here on every log in this request inherits the tenant and session,
  // including ones emitted deep inside lib/ai.ts and lib/twilio.ts.
  setRequestContext({ tenant_id: salon.id, session_id: conversation.id });

  await log({
    type: 'integration',
    level: 'info',
    category: 'sms',
    event: channel === 'whatsapp' ? 'whatsapp_received' : 'sms_received',
    from: fromNumber,
    to: toNumber,
    body: userInput,
    tenant_id: salon.id,
    session_id: conversation.id,
  });

  if (inboundMessageSid) {
    // sms_messages holds the unique Twilio SID for every message we've seen,
    // so it is the dedupe index for Twilio webhook retries.
    const existingInbound = await findSmsMessageBySid(inboundMessageSid);

    if (existingInbound) {
      safeLog({
        type: 'audit',
        level: 'info',
        category: 'sms',
        event: 'duplicate_inbound_sms_ignored',
        tenant_id: salon.id,
        session_id: conversation.id,
        twilio_message_sid: inboundMessageSid,
      });
      return twiml();
    }
  }

  const duplicateUserMessage = await findRecentDuplicateUserMessage(conversation.id, userInput);
  if (duplicateUserMessage) {
    safeLog({
      type: 'audit',
      level: 'info',
      category: 'sms',
      event: 'duplicate_inbound_content_ignored',
      tenant_id: salon.id,
      session_id: conversation.id,
    });
    return twiml();
  }

  const userMessage = await saveMessage(conversation.id, 'user', userInput);

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

    await upsertSmsMessage({
      ...inboundMetadata,
      channel,
      sessionId: conversation.id,
      transcriptId: userMessage.id,
      salonId: salon.id,
      rawPayload: rawSmsPayload,
    });

    safeLog({
      type: 'integration',
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
    getTranscriptHistory(conversation.id),
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
    salonServices: salon.services,
  };

  let aiResponse = await callAI(
    systemPrompt,
    history.map((h: any) => ({ role: h.role, content: h.content })),
    { tenant_id: salon.id, session_id: conversation.id }
  );
  let interactionTokens = addTokens(emptyTokens(), aiResponse.tokens);

  let toolCallCount = 0;
  const toolTrace: Array<{ name: string; result: string }> = [];
  while (aiResponse.tool_call && toolCallCount < 5) {
    toolCallCount++;
    const { name, args } = aiResponse.tool_call;

    const result = await executeToolCall(name, args, toolCtx, updatedBookingState);
    toolTrace.push({ name, result: result.toolResult });

    if (result.updatedBookingState) updatedBookingState = result.updatedBookingState;
    if (result.updatedSystemPrompt) systemPrompt = result.updatedSystemPrompt;

    await saveMessage(conversation.id, 'system' as any, `Tool (${name}): ${result.toolResult}`);
    const updatedHistory = await getTranscriptHistory(conversation.id);
    aiResponse = await callAI(
      systemPrompt,
      updatedHistory.map((h: any) => ({ role: h.role, content: h.content })),
      { tenant_id: salon.id, session_id: conversation.id }
    );
    interactionTokens = addTokens(interactionTokens, aiResponse.tokens);
  }

  // Log token/credit consumption for this whole inbound interaction.
  await recordTokenUsage({
    salonId: salon.id,
    sessionId: conversation.id,
    model: AI_MODEL,
    channel,
    interaction: 'inbound_message',
    tokens: interactionTokens,
    toolCalls: toolCallCount,
  });

  let reply =
    aiResponse.reply ||
    "I'm sorry, I ran into an issue processing your previous message. Could you please rephrase your last question?";
  reply = normalizeCustomerReply(reply);
  const triggerHandoff = isHandoff(reply);

  // Per-chat Manual/Auto: the chat's own override wins, else fall back to the salon default.
  const effectiveManual = resolveEffectiveApprovalMode(conversation, salon);

  if (effectiveManual) {
    await saveMessage(conversation.id, 'draft' as any, reply);
    safeLog({
      type: 'audit',
      level: 'info',
      category: 'session',
      event: 'draft_created',
      tenant_id: salon.id,
      session_id: conversation.id,
    });
    await supabase
      .from('sessions')
      .update({
        metadata: { ...conversation.metadata, booking_state: updatedBookingState },
        status: 'needs_approval',
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversation.id);

    await refreshSessionSummary(conversation.id, 'needs_approval').catch(() => {});

    await scheduleDeferredNotification({
      conversationId: conversation.id,
      salonId: salon.id,
      status: 'needs_approval',
      clientPhone: conversation.client_identifier || fromNumber,
    }).catch(() => {});

    await runObserver({
      salonId: salon.id,
      sessionId: conversation.id,
      channel,
      userMessage: userInput,
      reply,
      status: 'needs_approval',
      agentName: salon.agent_name,
      toolTrace,
      toolCallCount,
    }).catch(() => {});

    return twiml();
  }

  await supabase
    .from('sessions')
    .update({
      metadata: { ...conversation.metadata, booking_state: updatedBookingState },
      status: triggerHandoff ? 'escalated' : 'active',
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversation.id);

  const statusCallbackUrl =
    process.env.TWILIO_STATUS_CALLBACK_URL || new URL('/api/twilio/status', req.url).toString();
  const outboundMessage = await sendOnChannel(channel, fromNumber, reply, statusCallbackUrl, {
    tenant_id: salon.id,
    session_id: conversation.id,
  });
  const assistantMessage = await saveMessage(conversation.id, 'assistant', reply);

  const outboundMetadata = {
    twilioMessageSid: outboundMessage.sid,
    direction: 'outbound' as const,
    ...smsMetadataFromTwilioMessage(outboundMessage),
  };
  await upsertSmsMessage({
    ...outboundMetadata,
    channel,
    messageType: 'auto_reply',
    sessionId: conversation.id,
    transcriptId: assistantMessage?.id ?? null,
    salonId: salon.id,
    rawPayload: outboundMessage,
  });

  // Auto mode should not retain pending drafts from previous manual cycles.
  await supabase.from('transcripts').delete().eq('session_id', conversation.id).eq('role', 'draft');

  await refreshSessionSummary(conversation.id, triggerHandoff ? 'escalated' : 'active').catch(() => {});

  if (triggerHandoff) {
    safeLog({
      type: 'audit',
      level: 'warning',
      category: 'session',
      event: 'session_escalated',
      tenant_id: salon.id,
      session_id: conversation.id,
      customer_phone: fromNumber,
    });
    await scheduleDeferredNotification({
      conversationId: conversation.id,
      salonId: salon.id,
      status: 'escalated',
      clientPhone: conversation.client_identifier || fromNumber,
    }).catch(() => {});
  }

  await runObserver({
    salonId: salon.id,
    sessionId: conversation.id,
    channel,
    userMessage: userInput,
    reply,
    status: triggerHandoff ? 'escalated' : 'active',
    agentName: salon.agent_name,
    toolTrace,
    toolCallCount,
  }).catch(() => {});

  return twiml();
}
