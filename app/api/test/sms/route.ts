import { NextRequest, NextResponse } from 'next/server';
import { getSalonById, getOrCreateConversation, getTranscriptHistory, saveMessage, getWorkers, getFAQs, getActiveHold, supabase } from '../../../../lib/supabase';
import { buildSystemPrompt } from '../../../../lib/agent';
import { callAI } from '../../../../lib/ai';
import { isHandoff } from '../../../../lib/handoff';
import { holdBooking, confirmBooking, fetchAvailability, cancelBooking, rescheduleBooking, getBookingFields, bookDirect } from '../../../../lib/booking_service';

// Same logic as /api/sms-webhook but returns JSON instead of sending via Twilio
export async function POST(req: NextRequest) {
  try {
    const { message, from, salonId } = await req.json();

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

    const conversation = await getOrCreateConversation(salon.id, from);
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

    let aiResponse = await callAI(systemPrompt, history.map((h: any) => ({ role: h.role, content: h.content })));
 
     let toolCallCount = 0;
    while (aiResponse.tool_call && toolCallCount < 5) {
      toolCallCount++;
      const { name, args } = aiResponse.tool_call;
      let toolResult: string;

      if (name === 'check_availability') {
        const slots = await fetchAvailability(args.date, args.serviceName, salon.id, args.workerName);
        toolResult = slots.length > 0 ? `Available: ${slots.join(', ')}` : 'None found.';
      } else if (name === 'get_booking_requirements') {
        const { data: allWorkers } = await supabase
          .from('workers')
          .select('id, name, cal_event_type_id, services')
          .eq('salon_id', salon.id)
          .eq('is_active', true);

        const worker = (allWorkers || []).find(w => {
          if (args.workerName) return w.name.toLowerCase().includes(args.workerName.toLowerCase());
          return (w.services as string[] || []).some(s => s.toLowerCase().includes(args.serviceName.toLowerCase()));
        });

        if (worker) {
          const fields = await getBookingFields(worker.cal_event_type_id);
          const summary = fields.map((f: any) => `${f.name}${f.required ? ' (required)' : ''}`).join(', ');
          toolResult = `To book ${args.serviceName}, I need: ${summary}`;
        } else {
          toolResult = "Service not found or no workers available.";
        }
      } else if (name === 'book_direct') {
        const directRes = await bookDirect({
          serviceName: args.serviceName,
          date: args.date,
          time: args.time,
          responses: args.responses || {},
          salonId: salon.id,
          customerPhone: from,
          workerName: args.workerName,
          salonServices: salon.services
        });
        toolResult = JSON.stringify(directRes);
      } else if (name === 'book_appointment') {
        const result = await holdBooking({ ...args, salonId: salon.id, customerPhone: from, salonServices: salon.services });
        toolResult = result.success ? `Slot HELD. UID: ${result.bookingUid}` : `Failed: ${result.error}`;
      } else if (name === 'confirm_booking') {
        const result = await confirmBooking(args.holdUid);
        toolResult = result.success ? 'Booking confirmed!' : `Failed: ${result.error}`;
      } else if (name === 'cancel_booking') {
        const result = await cancelBooking(from, salon.id, args.serviceName);
        toolResult = result.success
          ? `Cancelled: ${result.serviceName} on ${result.startTime}`
          : `Failed: ${result.error}`;
      } else if (name === 'reschedule_booking') {
        const result = await rescheduleBooking(from, salon.id, args.newDate, args.newTime, args.serviceName);
        toolResult = result.success
          ? `Rescheduled: ${result.serviceName} to ${result.newDate} at ${result.newTime}`
          : `Failed: ${result.error}`;
      } else if (name === 'update_booking_state') {
        updatedBookingState = {
          ...updatedBookingState,
          service: args.serviceName || updatedBookingState?.service,
          date: args.date || updatedBookingState?.date,
          time: args.time || updatedBookingState?.time,
          worker: args.workerName || updatedBookingState?.worker
        };
        // Rebuild prompt with new state so AI knows it has been saved
        systemPrompt = buildSystemPrompt(salon, workers, faqs, updatedBookingState);
        toolResult = "Memory updated. I will remember these details.";
      } else {
        toolResult = 'Unknown tool.';
      }

      await saveMessage(conversation.id, 'system' as any, `Tool (${name}): ${toolResult}`);
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

      return NextResponse.json({ reply, draft: true, status: 'review', sessionId: conversation.id });
    }

    await supabase.from('sessions').update({
      metadata: { ...conversation.metadata, tokens: aiResponse.tokens, booking_state: updatedBookingState },
      status: triggerHandoff ? 'handed_over' : 'active',
      updated_at: new Date().toISOString()
    }).eq('id', conversation.id);

    await saveMessage(conversation.id, 'assistant', reply);

    return NextResponse.json({ reply, handoff: triggerHandoff, sessionId: conversation.id });
  } catch (error: any) {
    console.error('[Test SMS Error]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
