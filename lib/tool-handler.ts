import { supabase } from './supabase';
import { buildSystemPrompt } from './agent';
import {
  holdBooking,
  confirmBooking,
  fetchAvailability,
  cancelBooking,
  rescheduleBooking,
  getBookingFields,
  bookDirect
} from './booking_service';

export interface ToolContext {
  salonId: string;
  customerPhone: string;
  salon: any;
  workers: any[];
  faqs: any[];
  salonServices: any[];
}

export interface ToolCallResult {
  toolResult: string;
  updatedBookingState?: Record<string, any>;
  updatedSystemPrompt?: string;
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

  if (name === 'check_availability') {
    const slots = await fetchAvailability(args.date, args.serviceName, ctx.salonId, args.workerName);
    toolResult = slots.length > 0 ? `Available: ${slots.join(', ')}` : 'None found.';

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
      const hiddenFields = new Set(['title']);
      const clientFacingFields = fields.filter((f: any) => !hiddenFields.has(String(f.name || '').toLowerCase()));
      const summary = clientFacingFields.map((f: any) => `${f.name}${f.required ? ' (required)' : ''}`).join(', ');
      toolResult = `To book ${args?.serviceName || 'this service'}, I need: ${summary}`;
    } else {
      toolResult = 'Service not found or no workers available.';
    }

  } else if (name === 'book_direct') {
    const directRes = await bookDirect({
      serviceName: args.serviceName,
      date: args.date,
      time: args.time,
      responses: args.responses || {},
      salonId: ctx.salonId,
      salonName: ctx.salon?.name,
      customerPhone: ctx.customerPhone,
      workerName: args.workerName,
      salonServices: ctx.salonServices
    });
    toolResult = JSON.stringify(directRes);

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
    updatedBookingState = {
      ...currentBookingState,
      service: args.serviceName || currentBookingState?.service,
      date: args.date || currentBookingState?.date,
      time: args.time || currentBookingState?.time,
      worker: args.workerName || currentBookingState?.worker
    };
    // Rebuild prompt with new state so AI knows it has been saved
    updatedSystemPrompt = buildSystemPrompt(ctx.salon, ctx.workers, ctx.faqs, updatedBookingState);
    toolResult = 'Memory updated. I will remember these details.';

  } else {
    toolResult = 'Unknown tool.';
  }

  return { toolResult, updatedBookingState, updatedSystemPrompt };
}
