import { NextRequest, NextResponse } from 'next/server';
import { getSalonById, getOrCreateConversation, getTranscriptHistory, saveMessage, getWorkers, getFAQs, getActiveHold, supabase } from '../../../../lib/supabase';
import { buildSystemPrompt } from '../../../../lib/agent';
import { callAI } from '../../../../lib/ai';
import { isHandoff } from '../../../../lib/handoff';
import { executeToolCall, ToolContext } from '../../../../lib/tool-handler';

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
      customerPhone: from,
      salon,
      workers,
      faqs,
      salonServices: salon.services
    };

    let aiResponse = await callAI(systemPrompt, history.map((h: any) => ({ role: h.role, content: h.content })));
 
    let toolCallCount = 0;
    while (aiResponse.tool_call && toolCallCount < 5) {
      toolCallCount++;
      const { name, args } = aiResponse.tool_call;

      const result = await executeToolCall(name, args, toolCtx, updatedBookingState);

      if (result.updatedBookingState) updatedBookingState = result.updatedBookingState;
      if (result.updatedSystemPrompt) systemPrompt = result.updatedSystemPrompt;

      await saveMessage(conversation.id, 'system' as any, `Tool (${name}): ${result.toolResult}`);
      const updatedHistory = await getTranscriptHistory(conversation.id);
      aiResponse = await callAI(systemPrompt, updatedHistory.map((h: any) => ({ role: h.role, content: h.content })));
    }

    let reply =
      aiResponse.reply ||
      "I'm sorry, I ran into an issue processing your previous message. Could you please rephrase your last question?";
    const triggerHandoff = isHandoff(reply);

    if (salon.approval_mode) {
      await saveMessage(conversation.id, 'draft' as any, reply);
      await supabase.from('sessions').update({
        metadata: { ...conversation.metadata, tokens: aiResponse.tokens, booking_state: updatedBookingState },
        status: 'review',
        updated_at: new Date().toISOString()
      }).eq('id', conversation.id);

      return NextResponse.json({ reply, draft: true, status: 'review', sessionId: conversation.id });
    }

    await supabase.from('sessions').update({
      metadata: { ...conversation.metadata, tokens: aiResponse.tokens, booking_state: updatedBookingState },
      status: triggerHandoff ? 'handed_over' : 'active',
      updated_at: new Date().toISOString()
    }).eq('id', conversation.id);

    await saveMessage(conversation.id, 'assistant', reply);

    if (triggerHandoff) {
       const { notifyOwnerHandoff } = await import('../../../../lib/handoff_service');
       await notifyOwnerHandoff(conversation.id, salon.id);
    }

    return NextResponse.json({ reply, handoff: triggerHandoff, sessionId: conversation.id });
  } catch (error: any) {
    console.error('[Test SMS Error]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
