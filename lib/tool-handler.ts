import { supabase } from './supabase';
import { waitUntil } from '@vercel/functions';
import { buildSystemPrompt, type AgentChannel } from './agent';
import { safeLog } from '@/lib/logger';
import type { ClientProfile } from '@/lib/client-profile';
import { updateClientContact } from '@/lib/clients';
import { sendBookingConfirmation } from '@/lib/booking-confirmation';
import {
  holdBooking,
  confirmBooking,
  fetchAvailability,
  cancelBooking,
  rescheduleBooking,
  getBookingFields,
  bookDirect,
  usesPhoneIdentifier
} from './booking_service';

export interface ToolContext {
  salonId: string;
  sessionId?: string;
  customerPhone: string;
  salon: any;
  workers: any[];
  faqs: any[];
  salonServices: any[];
  /** Channel the conversation is on — only affects the prompt rebuilt by
   *  update_booking_state, which must stay in the same voice/text register. */
  channel?: AgentChannel;
  client?: ClientProfile | null;
}

export interface ToolCallResult {
  toolResult: string;
  updatedBookingState?: Record<string, any>;
  updatedSystemPrompt?: string;
}

/** Times as HH:mm from an availability result like "09:00 (Eduard), 14:30 (Elena)". */
function extractTimes(text: string): string[] {
  return Array.from(String(text || '').matchAll(/\b([0-2]?\d:[0-5]\d)\b/g)).map(m => m[1]);
}

/**
 * Whether the requested time was actually offered for this service and date.
 *
 * Permissive by design: if availability hasn't been checked, or was checked for
 * a different day or service, this doesn't block the booking — Cal.com remains
 * the real authority and will reject a genuine clash. It only catches the
 * specific failure of booking a time the client was never offered.
 */
function isOfferedTime(args: any, state: Record<string, any>): boolean {
  const offered: string[] = state?.offered_slots || [];
  if (offered.length === 0) return true;
  if (state?.offered_for !== `${args.date}|${args.serviceName}`) return true;
  return offered.includes(args.time);
}

function isWithinSixMonthWindow(date?: string): boolean {
  if (!date) return true;
  const requestedDate = new Date(`${date}T00:00:00`);
  if (Number.isNaN(requestedDate.getTime())) return false;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const maxDate = new Date(today);
  maxDate.setMonth(maxDate.getMonth() + 6);

  return requestedDate >= today && requestedDate <= maxDate;
}

function runAfterResponse(work: Promise<unknown>) {
  try {
    waitUntil(work);
  } catch {
    void work;
  }
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

function dispatchBookingConfirmation(params: {
  result: any;
  args: any;
  ctx: ToolContext;
}) {
  const { result, args, ctx } = params;
  if (!result?.success || !ctx.sessionId || (ctx.channel !== 'sms' && ctx.channel !== 'whatsapp')) return;

  runAfterResponse(
    sendBookingConfirmation({
      salon: ctx.salon,
      sessionId: ctx.sessionId,
      customerPhone: ctx.customerPhone,
      client: ctx.client,
      body: '',
      customerName: result.customerName || args?.responses?.name || ctx.client?.first_name || null,
      appointment: formatAppointment(result.startTime, args?.date, args?.time),
      serviceName: result.serviceName || args?.serviceName || null,
      confirmationNumber: result.bookingUid || null,
    })
      .then((sent) => {
        safeLog({
          type: 'integration',
          level: 'info',
          category: 'sms',
          event: 'booking_confirmation_sent',
          tenant_id: ctx.salonId,
          session_id: ctx.sessionId,
          channel: sent?.channel,
        });
      })
      .catch((error: any) => {
        safeLog({
          type: 'error',
          level: 'warning',
          category: 'sms',
          event: 'booking_confirmation_failed',
          tenant_id: ctx.salonId,
          session_id: ctx.sessionId,
          error: error?.message || String(error),
        });
      })
  );
}

/**
 * Shared tool call dispatcher. Used by both /api/sms-webhook and /api/test/sms
 * to eliminate code duplication (SKILL Architecture Rule #10).
 */
export async function executeToolCall(
  name: string,
  args: any,
  ctx: ToolContext,
  currentBookingState: Record<string, any>
): Promise<ToolCallResult> {
  const toLowerSafe = (value: unknown) => String(value || '').toLowerCase();
  let toolResult: string;
  let updatedBookingState: Record<string, any> | undefined;
  let updatedSystemPrompt: string | undefined;

  safeLog({
    type: 'integration',
    level: 'info',
    category: 'tool',
    event: 'tool_called',
    tool_name: name,
    tenant_id: ctx.salonId,
    session_id: ctx.sessionId,
    input: args,
  });

  try {
    if (name === 'update_client_profile') {
      try {
        ctx.client = await updateClientContact(ctx.salonId, ctx.customerPhone, args);
        updatedSystemPrompt = buildSystemPrompt(ctx.salon, ctx.workers, ctx.faqs, currentBookingState, { channel: ctx.channel, client: ctx.client });
        toolResult = 'Client contact details saved.';
      } catch (error: any) {
        safeLog({ type: 'error', level: 'error', category: 'tool', event: 'client_contact_save_failed',
          tenant_id: ctx.salonId, session_id: ctx.sessionId, error: error?.message });
        toolResult = 'Contact details could not be saved to the client record. Keep the supplied details in this conversation and continue helping with the booking.';
      }
    } else if (name === 'check_availability') {
      if (!isWithinSixMonthWindow(args?.date)) {
        toolResult = 'Failed: Bookings are available from today up to 6 months ahead only.';
      } else {
      const slots = await fetchAvailability(args.date, args.serviceName, ctx.salonId, args.workerName);
      toolResult = slots.length > 0 ? `Available: ${slots.join(', ')}` : 'None found.';
      }

    } else if (name === 'get_booking_requirements') {
      const { data: allWorkers } = await supabase
        .from('workers')
        .select('id, name, cal_event_type_id, services')
        .eq('salon_id', ctx.salonId)
        .eq('is_active', true);

      const workerNeedle = toLowerSafe(args?.workerName);
      const serviceNeedle = toLowerSafe(args?.serviceName);
      const worker = (allWorkers || []).find(w => {
        if (workerNeedle) return toLowerSafe(w?.name).includes(workerNeedle);
        if (!serviceNeedle) return false;
        return (w.services as string[] || []).some(s => toLowerSafe(s).includes(serviceNeedle));
      });

      if (worker) {
        const fields = await getBookingFields(worker.cal_event_type_id);
        // Internal/system fields are auto-filled server-side and should never be asked from clients.
        // Email joins them whenever Cal identifies attendees by phone — there is no
        // email field on the event type to fill. It's also hidden on voice
        // regardless, because reading an address back over a phone line is slow and
        // error-prone; either way the confirmation goes to the client's number.
        // See sendBookingConfirmation in lib/booking-confirmation.ts.
        const skipEmail = usesPhoneIdentifier() || ctx.channel === 'voice';
        const hiddenFields = new Set(skipEmail ? ['title', 'email'] : ['title']);
        const clientFacingFields = fields.filter((f: any) => !hiddenFields.has(String(f.name || '').toLowerCase()));
        const summary = clientFacingFields.map((f: any) => `${f.name}${f.required ? ' (required)' : ''}`).join(', ');
        toolResult = `To book ${args?.serviceName || 'this service'}, I need: ${summary}`;
      } else {
        toolResult = 'Service not found or no workers available.';
      }

    } else if (name === 'book_direct') {
      const missing = ['serviceName', 'date', 'time'].filter(k => !args?.[k]);
      if (missing.length) {
        // The model has called this with undefined service/date/time. Name the
        // gaps rather than letting holdBooking fail with something opaque.
        toolResult = `Failed: cannot book yet — still missing ${missing.join(', ')}. Ask the client for what's missing, then try again.`;
      } else if (!isOfferedTime(args, currentBookingState)) {
        toolResult =
          `Failed: ${args.time} was not one of the times availability returned for that day. ` +
          `Call check_availability again and offer the client only the times it gives you.`;
      } else {
      // When Cal identifies attendees by email, the voice agent still doesn't ask
      // for one — fall back to whatever the client record holds, and let
      // bookDirect's placeholder stand when it holds nothing. Under the phone
      // identifier there is no email field at all, so passing one is rejected.
      const responses = { ...(args.responses || {}) };
      if (usesPhoneIdentifier()) {
        delete responses.email;
      } else if (ctx.channel === 'voice' && !responses.email && ctx.client?.email) {
        responses.email = ctx.client.email;
      }
      const directRes = await bookDirect({
        serviceName: args.serviceName,
        date: args.date,
        time: args.time,
        responses,
        salonId: ctx.salonId,
        salonName: ctx.salon?.name,
        customerPhone: ctx.customerPhone,
        workerName: args.workerName,
        salonServices: ctx.salonServices
      });
      dispatchBookingConfirmation({ result: directRes, args, ctx });
      toolResult = JSON.stringify(directRes);
      }

    } else if (name === 'book_appointment') {
      const result = await holdBooking({
        ...args,
        salonId: ctx.salonId,
        customerPhone: ctx.customerPhone,
        salonServices: ctx.salonServices
      });
      toolResult = result.success ? `Slot HELD. UID: ${result.bookingUid}` : `Failed: ${result.error}`;

    } else if (name === 'confirm_booking') {
      const result = await confirmBooking(args.holdUid);
      dispatchBookingConfirmation({ result, args, ctx });
      toolResult = result.success ? 'Booking confirmed!' : `Failed: ${result.error}`;

    } else if (name === 'cancel_booking') {
      const result = await cancelBooking(ctx.customerPhone, ctx.salonId, args.serviceName);
      toolResult = result.success
        ? `Cancelled: ${result.serviceName} on ${result.startTime}`
        : `Failed: ${result.error}`;

    } else if (name === 'reschedule_booking') {
      const result = await rescheduleBooking(ctx.customerPhone, ctx.salonId, args.newDate, args.newTime, args.serviceName);
      toolResult = result.success
        ? `Rescheduled: ${result.serviceName} to ${result.newDate} at ${result.newTime}`
        : `Failed: ${result.error}`;

    } else if (name === 'update_booking_state') {
      const requestedDate = args?.date || currentBookingState?.date;
      const validDate = isWithinSixMonthWindow(requestedDate);
      updatedBookingState = {
        ...currentBookingState,
        service: args.serviceName || currentBookingState?.service,
        date: validDate ? requestedDate : currentBookingState?.date,
        time: args.time || currentBookingState?.time,
        worker: args.workerName || currentBookingState?.worker
      };
      // Rebuild prompt with new state so AI knows it has been saved
      updatedSystemPrompt = buildSystemPrompt(ctx.salon, ctx.workers, ctx.faqs, updatedBookingState, {
        channel: ctx.channel,
        client: ctx.client,
      });
      toolResult = validDate
        ? 'Memory updated. I will remember these details.'
        : 'Failed: Bookings are available from today up to 6 months ahead only.';

    } else {
      toolResult = 'Unknown tool.';
    }

    safeLog({
      type: 'integration',
      level: 'info',
      category: 'tool',
      event: 'tool_success',
      tool_name: name,
      tenant_id: ctx.salonId,
      session_id: ctx.sessionId,
      // Truncated, but present: without the result there was no way to tell
      // which slots Cal actually offered when reviewing a call afterwards.
      result: String(toolResult).slice(0, 500),
    });
    return { toolResult, updatedBookingState, updatedSystemPrompt };
  } catch (error: any) {
    safeLog({
      type: 'error',
      level: 'error',
      category: 'tool',
      event: 'tool_failed',
      tool_name: name,
      tenant_id: ctx.salonId,
      session_id: ctx.sessionId,
      error: error?.message || String(error),
      stack: error?.stack,
    });
    throw error;
  }
}
