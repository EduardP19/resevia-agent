import { NextRequest, NextResponse } from 'next/server';
import { getSalonBySmsNumber, getOrCreateConversation, getTranscriptHistory, saveMessage, getWorkers, getFAQs, getActiveHold, supabase } from '../../../lib/supabase';
import { buildSystemPrompt } from '../../../lib/agent';
import { callAI } from '../../../lib/ai';
import { sendSMS } from '../../../lib/twilio';
import { isHandoff } from '../../../lib/handoff';
import { executeToolCall, ToolContext } from '../../../lib/tool-handler';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const userInput = formData.get('Body') as string;
    const fromNumber = formData.get('From') as string;
    const toNumber = formData.get('To') as string;

    const salon = await getSalonBySmsNumber(toNumber);
    if (!salon) return new NextResponse('<Response></Response>', { status: 200, headers: { 'Content-Type': 'text/xml' } });

    const conversation = await getOrCreateConversation(salon.id, fromNumber);
    await saveMessage(conversation.id, 'user', userInput);

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
      customerPhone: fromNumber,
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

    let reply = aiResponse.reply || "I'm sorry, I'm having trouble processing that.";
    const triggerHandoff = isHandoff(reply);

    if (salon.approval_mode) {
      await saveMessage(conversation.id, 'draft' as any, reply);
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

    await saveMessage(conversation.id, 'assistant', reply);
    await sendSMS(fromNumber, reply);

    return new NextResponse('<Response></Response>', { status: 200, headers: { 'Content-Type': 'text/xml' } });
  } catch (error: any) {
    return new NextResponse('<Response></Response>', { status: 200, headers: { 'Content-Type': 'text/xml' } });
  }
}
