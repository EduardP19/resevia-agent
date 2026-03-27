import { NextRequest, NextResponse } from 'next/server';
import { getSalonBySmsNumber, getOrCreateConversation, getTranscriptHistory, saveMessage, supabase } from '../../../../lib/supabase';
import { buildSystemPrompt } from '../../../../lib/agent';
import { callAI } from '../../../../lib/ai';
import { isHandoff } from '../../../../lib/handoff';
import { holdBooking, confirmBooking, fetchAvailability, cancelBooking, rescheduleBooking } from '../../../../lib/booking_service';

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
      const { data } = await supabase.from('business_profiles').select('*').eq('id', salonId).single();
      salon = data;
    } else {
      const { data } = await supabase.from('business_profiles').select('*').limit(1).single();
      salon = data;
    }

    if (!salon) return NextResponse.json({ error: 'No salon found' }, { status: 404 });

    const conversation = await getOrCreateConversation(salon.id, from);
    await saveMessage(conversation.id, 'user', message);

    const { data: activeHold } = await supabase
      .from('bookings')
      .select('*')
      .eq('customer_phone', from)
      .eq('status', 'held')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    const { data: workers } = await supabase
      .from('workers')
      .select('name, services')
      .eq('salon_id', salon.id)
      .eq('is_active', true);

    let history = await getTranscriptHistory(conversation.id);
    let systemPrompt = buildSystemPrompt(salon, workers || []);

    if (activeHold) {
      systemPrompt += `\n\n[SYSTEM INFO] You currently have a slot held for this client: ${activeHold.service_name} at ${new Date(activeHold.start_time).toLocaleString()}. They need to confirm to finalize.`;
    }

    let aiResponse = await callAI(systemPrompt, history.map((h: any) => ({ role: h.role, content: h.content })));

    if (aiResponse.tool_call) {
      const { name, args } = aiResponse.tool_call;
      let toolResult;

      if (name === 'check_availability') {
        const slots = await fetchAvailability(args.date, args.serviceName, salon.id, args.workerName);
        toolResult = slots.length > 0 ? `Available: ${slots.join(', ')}` : 'None found.';
      } else if (name === 'book_appointment') {
        const result = await holdBooking({ ...args, salonId: salon.id, customerPhone: from });
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
      }

      await saveMessage(conversation.id, 'system' as any, `Tool (${name}): ${toolResult}`);
      const updatedHistory = await getTranscriptHistory(conversation.id);
      aiResponse = await callAI(systemPrompt, updatedHistory.map((h: any) => ({ role: h.role, content: h.content })));
    }

    const reply = aiResponse.reply || "I'm sorry, I'm having trouble processing that.";
    const triggerHandoff = isHandoff(reply);

    await supabase.from('sessions').update({
      metadata: { ...conversation.metadata, tokens: aiResponse.tokens },
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
