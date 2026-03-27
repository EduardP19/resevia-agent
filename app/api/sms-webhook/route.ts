import { NextRequest, NextResponse } from 'next/server';
import { getSalonBySmsNumber, getOrCreateConversation, getTranscriptHistory, saveMessage, getWorkers, getFAQs, getActiveHold, supabase } from '../../../lib/supabase';
import { buildSystemPrompt } from '../../../lib/agent';
import { callAI } from '../../../lib/ai';
import { sendSMS } from '../../../lib/twilio';
import { isHandoff } from '../../../lib/handoff';
import { holdBooking, confirmBooking, fetchAvailability, cancelBooking, rescheduleBooking, getBookingFields, bookDirect } from '../../../lib/booking_service';

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

    let systemPrompt = buildSystemPrompt(salon, workers, faqs);
    
    if (activeHold) {
       systemPrompt += `\n\n[SYSTEM INFO] You currently have a slot held for this client: ${activeHold.service_name} at ${new Date(activeHold.start_time).toLocaleString()}. They need to confirm to finalize.`;
    }

    let aiResponse = await callAI(systemPrompt, history.map((h: any) => ({ role: h.role, content: h.content })));

    let toolCallCount = 0;
    while (aiResponse.tool_call && toolCallCount < 5) {
      toolCallCount++;
      const { name, args } = aiResponse.tool_call;
      let toolResult: string;

      if (name === 'check_availability') {
        const slots = await fetchAvailability(args.date, args.serviceName, salon.id, args.workerName);
        toolResult = slots.length > 0 ? `Available: ${slots.join(', ')}` : "None found.";
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
          customerPhone: fromNumber,
          workerName: args.workerName,
          salonServices: salon.services
        });
        toolResult = JSON.stringify(directRes);
      } else if (name === 'book_appointment') {
        const result = await holdBooking({ ...args, salonId: salon.id, customerPhone: fromNumber, salonServices: salon.services });
        toolResult = result.success ? `Slot HELD. UID: ${result.bookingUid}` : `Failed: ${result.error}`;
      } else if (name === 'confirm_booking') {
        const result = await confirmBooking(args.holdUid);
        toolResult = result.success ? "Booking confirmed!" : `Failed: ${result.error}`;
      } else if (name === 'cancel_booking') {
        const result = await cancelBooking(fromNumber, salon.id, args.serviceName);
        toolResult = result.success
          ? `Cancelled: ${result.serviceName} on ${result.startTime}`
          : `Failed: ${result.error}`;
      } else if (name === 'reschedule_booking') {
        const result = await rescheduleBooking(fromNumber, salon.id, args.newDate, args.newTime, args.serviceName);
        toolResult = result.success
          ? `Rescheduled: ${result.serviceName} to ${result.newDate} at ${result.newTime}`
          : `Failed: ${result.error}`;
      } else {
        toolResult = 'Unknown tool.';
      }

      await saveMessage(conversation.id, 'system' as any, `Tool (${name}): ${toolResult}`);
      const updatedHistory = await getTranscriptHistory(conversation.id);
      aiResponse = await callAI(systemPrompt, updatedHistory.map((h: any) => ({ role: h.role, content: h.content })));
    }

    const reply = aiResponse.reply || "I'm sorry, I'm having trouble processing that.";
    const triggerHandoff = isHandoff(reply);

    // Human-in-the-Loop: If salon is in approval mode, save as draft and don't send SMS
    if (salon.approval_mode) {
      await saveMessage(conversation.id, 'draft' as any, reply);
      await supabase.from('sessions').update({
        metadata: { ...conversation.metadata, tokens: aiResponse.tokens },
        status: 'review',
        updated_at: new Date().toISOString()
      }).eq('id', conversation.id);
      
      return new NextResponse('<Response></Response>', { status: 200, headers: { 'Content-Type': 'text/xml' } });
    }

    await supabase.from('sessions').update({
      metadata: { ...conversation.metadata, tokens: aiResponse.tokens },
      status: triggerHandoff ? 'handed_over' : 'active',
      updated_at: new Date().toISOString()
    }).eq('id', conversation.id);

    await saveMessage(conversation.id, 'assistant', reply);
    await sendSMS(fromNumber, reply);

    return new NextResponse('<Response></Response>', { status: 200, headers: { 'Content-Type': 'text/xml' } });
  } catch (error: any) {
    console.error('[Webhook Error]', error);
    return new NextResponse('<Response></Response>', { status: 200, headers: { 'Content-Type': 'text/xml' } });
  }
}
