import { NextRequest, NextResponse } from 'next/server';
import {
  findRecentDuplicateUserMessage,
  getActiveHold,
  getFAQs,
  getOrCreateConversation,
  getSalonById,
  getTranscriptHistory,
  getWorkers,
  saveMessage,
  supabase,
} from '../../../../lib/supabase';
import { buildSystemPrompt } from '../../../../lib/agent';
import { callAI } from '../../../../lib/ai';
import { isHandoff } from '../../../../lib/handoff';
import { executeToolCall, ToolContext } from '../../../../lib/tool-handler';
import { logAppError, toErrorLogPayload } from '../../../../lib/error-logger';
import { log, safeLog } from '@/lib/logger';
import { normalizeCustomerReply } from '@/lib/reply-format';
import { notifyOwnerConversationAttention } from '@/lib/owner-email-notifications';

// Same logic as /api/sms-webhook but returns JSON instead of sending via Twilio
export async function POST(req: NextRequest) {
  try {
    const { message, from, salonId, id: sessionId } = await req.json();

    if (!message || !from) {
      return NextResponse.json({ error: 'message and from are required' }, { status: 400 });
    }

    // Use salonId directly if provided, otherwise fall back to first salon
    let salon;
    if (salonId) {
      salon = await getSalonById(salonId);
    } else {
      const { data } = await supabase.from('business_profiles').select('*').limit(1).single();
      salon = data;
    }

    if (!salon) return NextResponse.json({ error: 'No salon found' }, { status: 404 });

    const conversation = await getOrCreateConversation(salon.id, from, sessionId);
    await log({
      level: 'info',
      category: 'sms',
      event: 'sms_received',
      from,
      to: salon.twilio_number || null,
      body: message,
      tenant_id: salon.id,
      session_id: conversation.id,
      source: 'test_sms',
    });

    const duplicateUserMessage = await findRecentDuplicateUserMessage(conversation.id, message);
    if (duplicateUserMessage) {
      safeLog({
        level: 'info',
        category: 'sms',
        event: 'duplicate_test_message_ignored',
        tenant_id: salon.id,
        session_id: conversation.id,
        source: 'test_sms',
      });
      return NextResponse.json({ duplicate: true, sessionId: conversation.id });
    }

    await saveMessage(conversation.id, 'user', message);

    const [workers, faqs, activeHold, history] = await Promise.all([
      getWorkers(salon.id),
      getFAQs(salon.id),
      getActiveHold(from),
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
      customerPhone: from,
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
        clientPhone: conversation.client_identifier || from,
      }).catch(() => {});

      return NextResponse.json({ reply, draft: true, status: 'needs_approval', sessionId: conversation.id });
    }

    await supabase.from('sessions').update({
      metadata: { ...conversation.metadata, tokens: aiResponse.tokens, booking_state: updatedBookingState },
      status: triggerHandoff ? 'escalated' : 'active',
      updated_at: new Date().toISOString()
    }).eq('id', conversation.id);

    await saveMessage(conversation.id, 'assistant', reply);

    if (triggerHandoff) {
       safeLog({
         level: 'warning',
         category: 'session',
         event: 'session_escalated',
         tenant_id: salon.id,
         session_id: conversation.id,
         customer_phone: from,
       });
       await notifyOwnerConversationAttention({
         conversationId: conversation.id,
         salonId: salon.id,
         status: 'escalated',
         clientPhone: conversation.client_identifier || from,
       }).catch(() => {});
    }

    return NextResponse.json({ reply, handoff: triggerHandoff, sessionId: conversation.id });
  } catch (error: any) {
    const payload = toErrorLogPayload(error, 'Test SMS route error');
    safeLog({
      level: 'error',
      category: 'system',
      event: 'webhook_error',
      error: payload.message,
      stack: payload.stack || undefined,
      source: 'test_sms',
    });
    await logAppError({
      source: 'api.test.sms',
      message: payload.message,
      stack: payload.stack || undefined,
      path: '/api/test/sms',
      method: 'POST',
      runtime: 'server',
    });
    console.error('[Test SMS Error]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
