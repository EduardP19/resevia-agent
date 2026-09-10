import { supabase, getFAQs, getWorkers } from '@/lib/supabase';
import { executeToolCall, type ToolContext } from '@/lib/tool-handler';
import { logError, safeLog } from '@/lib/logger';
import { getClientByPhone } from '@/lib/clients';
import { sendBookingConfirmation } from '@/lib/booking-confirmation';
import { clientDisplayName, normalizeClientPhone, type ClientProfile } from '@/lib/client-profile';

/**
 * Executes one Deepgram voice-agent function call against the same tool
 * implementations the SMS/WhatsApp pipeline uses.
 *
 * Voice differs from text in one structural way: Deepgram owns the LLM loop, so
 * there is no place for us to swap the system prompt mid-conversation. Where
 * the text pipeline reacts to `update_booking_state` by rebuilding the prompt,
 * here we persist the state to `sessions.metadata.booking_state` and return it
 * to the model as text. The next turn's prompt is Deepgram's, unchanged — which
 * is why the tool result spells the locked fields back out.
 */
/**
 * A caller can't be sent a link and now isn't asked for an email, so the only
 * written record of the booking is the message we send to the number they rang
 * from. Spelled out in full: they may not have the salon's number saved.
 */
function renderVoiceBookingConfirmation(params: {
  salon: any;
  client?: ClientProfile | null;
  serviceName: string;
  date: string;
  time: string;
  workerName?: string;
}): string {
  const { salon, client, serviceName, date, time, workerName } = params;
  const when = (() => {
    const parsed = new Date(`${date}T${time || '00:00'}:00`);
    if (Number.isNaN(parsed.getTime())) return `${date} at ${time}`;
    const day = parsed.toLocaleDateString('en-GB', {
      weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/London',
    });
    return time ? `${day} at ${time}` : day;
  })();
  const firstName = (client?.first_name || clientDisplayName(client) || '').trim();
  return [
    firstName ? `Hi ${firstName}, you're booked in.` : "You're booked in.",
    `${serviceName} on ${when}${workerName ? ` with ${workerName}` : ''} at ${salon?.name || 'the salon'}.`,
    'Reply to this message if you need to change or cancel.',
  ].join(' ');
}

function formatAppointment(value?: string | null, fallbackDate?: string, fallbackTime?: string) {
  const raw = value || (fallbackDate ? `${fallbackDate}T${fallbackTime || '00:00'}:00` : null);
  const parsed = raw ? new Date(raw) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) {
    return [fallbackDate, fallbackTime].filter(Boolean).join(' at ') || 'your selected time';
  }

  const day = parsed.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'Europe/London',
  });
  const time = parsed.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Europe/London',
  });
  return `${day} at ${time}`;
}

export interface VoiceToolCall {
  salonId: string;
  sessionId: string;
  customerPhone: string;
  name: string;
  args: any;
}

export async function runVoiceToolCall({
  salonId,
  sessionId,
  customerPhone,
  name,
  args,
}: VoiceToolCall): Promise<string> {
  const [{ data: session }, { data: salon }, workers, faqs, client] = await Promise.all([
    supabase.from('sessions').select('id, metadata, client_identifier').eq('id', sessionId).eq('salon_id', salonId).eq('channel', 'voice').single(),
    supabase.from('business_profiles').select('*').eq('id', salonId).single(),
    getWorkers(salonId),
    getFAQs(salonId),
    getClientByPhone(salonId, customerPhone),
  ]);

  if (!salon) return 'Failed: salon not found.';
  if (!session || normalizeClientPhone(session.client_identifier) !== normalizeClientPhone(customerPhone)) {
    return 'Failed: call not found.';
  }

  const bookingState = (session?.metadata as any)?.booking_state || {};

  const ctx: ToolContext = {
    salonId,
    sessionId,
    customerPhone,
    salon,
    workers,
    faqs,
    salonServices: salon.services,
    channel: 'voice',
    client,
  };

  let { toolResult, updatedBookingState } = await executeToolCall(name, args, ctx, bookingState);

  if (name === 'book_direct') {
    let booked: any = null;
    try {
      booked = JSON.parse(toolResult);
    } catch {
      // A non-JSON result is a failure message from the tool handler, not a booking.
    }
    if (booked?.success) {
      let confirmationChannel: 'whatsapp' | 'sms' | null = null;
      try {
        const confirmation = await sendBookingConfirmation({
          salon,
          sessionId,
          customerPhone,
          client,
          body: renderVoiceBookingConfirmation({
            salon,
            client,
            serviceName: args?.serviceName,
            date: args?.date,
            time: args?.time,
            workerName: booked.workerName,
          }),
          customerName: booked.customerName || args?.responses?.name || clientDisplayName(client) || null,
          appointment: formatAppointment(booked.startTime, args?.date, args?.time),
          serviceName: booked.serviceName || args?.serviceName,
          confirmationNumber: booked.bookingUid || null,
          // Voice tool requests must finish the fallback before returning.
          // A long detached poll can be frozen once the serverless response ends.
          whatsappConfirmTimeoutMs: 6000,
        });
        confirmationChannel = confirmation?.channel || null;
        safeLog({
          type: 'integration', level: 'info', category: 'sms',
          event: 'voice_booking_confirmation_sent',
          tenant_id: salonId, session_id: sessionId, channel: confirmation?.channel,
        });
      } catch (error: any) {
        logError('sms', 'voice_booking_confirmation_failed', error, {
          tenant_id: salonId, session_id: sessionId,
        });
      }
      // Deepgram's prompt is fixed for the call, so the tool result is the only
      // place the model can be told what the caller is about to receive.
      toolResult =
        `${toolResult} ${confirmationChannel
          ? `A written confirmation was sent by ${confirmationChannel === 'whatsapp' ? 'WhatsApp' : 'text'} to the number they called from.`
          : 'The booking is confirmed, but the written confirmation could not be sent. Do not claim that it was sent.'} ` +
        `Now call end_call as your final action with outcome "booked" and put the complete warm goodbye in closingMessage. Do not ask another question.`;
    }
  }

  if (updatedBookingState) {
    await supabase
      .from('sessions')
      .update({
        metadata: { ...((session?.metadata as any) || {}), booking_state: updatedBookingState },
        updated_at: new Date().toISOString(),
      })
      .eq('id', sessionId);

    // Deepgram's prompt is fixed for the life of the call, so the only way the
    // model learns what's now locked in is through this result string.
    const locked = ['service', 'date', 'time', 'worker']
      .filter((k) => updatedBookingState[k])
      .map((k) => `${k}: ${updatedBookingState[k]}`)
      .join(', ');
    if (locked) {
      return `${toolResult} Confirmed so far — ${locked}. Do not ask for these again.`;
    }
  }

  return toolResult;
}

/**
 * Deepgram sends `FunctionCallRequest` with one or more functions; each needs a
 * `FunctionCallResponse` carrying the same id. A thrown tool error is returned
 * as spoken-safe text rather than propagated — a failed tool must not drop the
 * call.
 */
export async function handleFunctionCallRequest(
  message: any,
  ctx: { salonId: string; sessionId: string; customerPhone: string }
): Promise<any[]> {
  const functions = Array.isArray(message?.functions) ? message.functions : [];

  return Promise.all(
    functions.map(async (fn: any) => {
      let content: string;
      try {
        const args = typeof fn.arguments === 'string' ? JSON.parse(fn.arguments || '{}') : fn.arguments || {};
        content = await runVoiceToolCall({ ...ctx, name: fn.name, args });
      } catch (error: any) {
        safeLog({
          type: 'error',
          level: 'error',
          category: 'tool',
          event: 'voice_tool_failed',
          tool_name: fn?.name,
          tenant_id: ctx.salonId,
          session_id: ctx.sessionId,
          error: error?.message || String(error),
          stack: error?.stack,
        });
        content = "Failed: that didn't work just now. Tell the caller you'll have the team follow up.";
      }
      return { type: 'FunctionCallResponse', id: fn.id, name: fn.name, content };
    })
  );
}
