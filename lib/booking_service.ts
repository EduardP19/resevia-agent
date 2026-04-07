import { supabase, completeSession } from './supabase';
import axios from 'axios';

const CAL_COM_API_KEY = process.env.CAL_COM_API_KEY;

const calApiV2 = axios.create({
  baseURL: 'https://api.cal.eu/v2',
  headers: {
    'Authorization': `Bearer ${CAL_COM_API_KEY}`,
    'Content-Type': 'application/json'
  }
});

const VERSION_STABLE = '2024-06-11';
const VERSION_LATEST = '2024-08-13';
const LONDON_TIME_ZONE = 'Europe/London';

const DAY_TO_INDEX: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

function getUtcStart(date: string, time: string): string {
  const localDate = new Date(`${date}T${time}:00`);
  const utcDate = new Date(localDate.toLocaleString('en-US', { timeZone: 'UTC' }));
  const londonDate = new Date(localDate.toLocaleString('en-US', { timeZone: LONDON_TIME_ZONE }));
  const offsetMs = londonDate.getTime() - utcDate.getTime();
  return new Date(localDate.getTime() - offsetMs).toISOString();
}

function isWithinBookingWindow(date: string): boolean {
  const requestedDate = new Date(`${date}T00:00:00`);
  if (Number.isNaN(requestedDate.getTime())) return false;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const maxDate = new Date(today);
  maxDate.setMonth(maxDate.getMonth() + 6);

  return requestedDate >= today && requestedDate <= maxDate;
}

function formatSlotTime(isoString: string): string {
  return new Date(isoString).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: LONDON_TIME_ZONE
  });
}

function parseTimeToMinutes(raw: string): number | null {
  const normalized = raw.trim().toLowerCase();
  const match = normalized.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!match) return null;

  let hours = Number(match[1]);
  const minutes = Number(match[2] || '0');
  const meridiem = (match[3] || '').toLowerCase();

  if (Number.isNaN(hours) || Number.isNaN(minutes) || minutes > 59) return null;

  if (meridiem === 'am') {
    if (hours === 12) hours = 0;
  } else if (meridiem === 'pm') {
    if (hours < 12) hours += 12;
  }

  if (hours > 23) return null;
  return hours * 60 + minutes;
}

function parseDayToken(raw: string): number[] {
  const cleaned = raw.replace(/\./g, '').trim().toLowerCase();
  if (!cleaned) return [];

  if (cleaned.includes('-')) {
    const [startToken, endToken] = cleaned.split('-').map((part) => part.trim().slice(0, 3));
    const start = DAY_TO_INDEX[startToken];
    const end = DAY_TO_INDEX[endToken];
    if (start === undefined || end === undefined) return [];

    if (start <= end) {
      return Array.from({ length: end - start + 1 }, (_, i) => start + i);
    }
    return [...Array.from({ length: 7 - start }, (_, i) => start + i), ...Array.from({ length: end + 1 }, (_, i) => i)];
  }

  const parts = cleaned.split(/[,&/]/).map((part) => part.trim()).filter(Boolean);
  return parts
    .map((part) => DAY_TO_INDEX[part.slice(0, 3)])
    .filter((value): value is number => value !== undefined);
}

function parseOpeningHours(openingHoursRaw?: string | null): Record<number, { open: number; close: number } | null> | null {
  if (!openingHoursRaw || !openingHoursRaw.trim()) return null;

  const parsed: Record<number, { open: number; close: number } | null> = {
    0: null,
    1: null,
    2: null,
    3: null,
    4: null,
    5: null,
    6: null,
  };

  const text = openingHoursRaw.trim();
  const lines: string[] = [];

  try {
    const maybeJson = JSON.parse(text);
    if (maybeJson && typeof maybeJson === 'object' && !Array.isArray(maybeJson)) {
      for (const [key, value] of Object.entries(maybeJson)) {
        lines.push(`${key}: ${String(value)}`);
      }
    }
  } catch {
    lines.push(...text.split(/\n|;/).map((line) => line.trim()).filter(Boolean));
  }

  if (lines.length === 0) {
    lines.push(...text.split(/\n|;/).map((line) => line.trim()).filter(Boolean));
  }

  let parsedAtLeastOne = false;

  for (const line of lines) {
    const [dayPartRaw, timePartRaw] = line.includes(':')
      ? [line.slice(0, line.indexOf(':')), line.slice(line.indexOf(':') + 1)]
      : line.split(/\s+/, 2);

    const dayPart = (dayPartRaw || '').trim();
    const timePart = (timePartRaw || '').trim().toLowerCase();
    if (!dayPart || !timePart) continue;

    const days = parseDayToken(dayPart);
    if (days.length === 0) continue;

    if (timePart.includes('closed')) {
      for (const day of days) parsed[day] = null;
      parsedAtLeastOne = true;
      continue;
    }

    const rangeMatch = timePart.match(/(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*(?:-|to)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i);
    if (!rangeMatch) continue;

    const open = parseTimeToMinutes(rangeMatch[1]);
    const close = parseTimeToMinutes(rangeMatch[2]);
    if (open === null || close === null || close <= open) continue;

    for (const day of days) {
      parsed[day] = { open, close };
    }
    parsedAtLeastOne = true;
  }

  return parsedAtLeastOne ? parsed : null;
}

function getLondonDayAndMinutes(date: Date): { day: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: LONDON_TIME_ZONE,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const weekday = (parts.find((part) => part.type === 'weekday')?.value || '').toLowerCase().slice(0, 3);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value || '0');
  const minute = Number(parts.find((part) => part.type === 'minute')?.value || '0');
  const day = DAY_TO_INDEX[weekday] ?? 0;

  return { day, minutes: hour * 60 + minute };
}

function isWithinOpeningHours(startIso: string, durationMinutes: number, openingHoursRaw?: string | null): boolean {
  const schedule = parseOpeningHours(openingHoursRaw);
  if (!schedule) return true;

  const start = new Date(startIso);
  const end = new Date(start.getTime() + durationMinutes * 60000);
  const startInfo = getLondonDayAndMinutes(start);
  const endInfo = getLondonDayAndMinutes(end);

  if (startInfo.day !== endInfo.day) return false;

  const dayHours = schedule[startInfo.day];
  if (!dayHours) return false;

  return startInfo.minutes >= dayHours.open && endInfo.minutes <= dayHours.close;
}

function extractSlotTimes(slotsData: any, date: string): string[] {
  if (!slotsData) return [];
  if (Array.isArray(slotsData)) {
    return slotsData.map((s: any) => s.time || s).filter(Boolean);
  }
  // Date-keyed format: { "2026-03-27": [{ time: "..." }, ...] }
  const daySlots: any[] = slotsData[date] || (Object.values(slotsData) as any[]).flat();
  return daySlots.map((s: any) => s.time || s).filter(Boolean);
}

/**
 * Fetch availability across all workers who offer the given service.
 * Filters out slots already held or confirmed in our DB.
 */
export async function fetchAvailability(
  date: string,
  serviceName: string,
  salonId: string,
  workerName?: string
) {
  try {
    if (!isWithinBookingWindow(date)) {
      return [];
    }

    const [workersRes, salonRes] = await Promise.all([
      supabase
        .from('workers')
        .select('id, name, cal_event_type_id, services')
        .eq('salon_id', salonId)
        .eq('is_active', true),
      supabase
        .from('business_profiles')
        .select('opening_hours, services')
        .eq('id', salonId)
        .single(),
    ]);

    const allWorkers = workersRes.data;
    if (!allWorkers || allWorkers.length === 0) return [];

    const matchedService = (salonRes.data?.services || []).find((s: any) =>
      String(s?.name || '').toLowerCase().includes(serviceName.toLowerCase())
    );
    const serviceDuration = Number(matchedService?.duration_minutes || 60);
    const openingHoursRaw = salonRes.data?.opening_hours || null;

    const workers = allWorkers.filter(w => {
      if (workerName) {
        return w.name.toLowerCase().includes(workerName.toLowerCase());
      }
      return (w.services as string[] || []).some(s => 
        s.toLowerCase().includes(serviceName.toLowerCase())
      );
    });

    if (workers.length === 0) return [];

    const results = await Promise.all(
      workers.map(async (worker) => {
        try {
          const [calRes, holdsRes] = await Promise.all([
            calApiV2.get('/slots/available', {
              params: {
                startTime: `${date}T00:00:00Z`,
                endTime: `${date}T23:59:59Z`,
                eventTypeId: worker.cal_event_type_id
              },
              headers: { 'cal-api-version': VERSION_LATEST }
            }),
            supabase
              .from('bookings')
              .select('start_time, end_time')
              .eq('worker_id', worker.id)
              .in('status', ['held', 'confirmed'])
          ]);

          const slots = extractSlotTimes(calRes.data.data?.slots, date);
          const existingBookings = (holdsRes.data || []).map((h: any) => ({
            start: new Date(h.start_time).getTime(),
            end: new Date(h.end_time).getTime(),
          }));

          return slots
            .filter((slotStart) => {
              const slotStartIso = new Date(slotStart).toISOString();
              const slotStartMs = new Date(slotStartIso).getTime();
              const slotEndMs = slotStartMs + serviceDuration * 60000;

              const overlapsBooking = existingBookings.some((booking) =>
                slotStartMs < booking.end && slotEndMs > booking.start
              );
              if (overlapsBooking) return false;

              return isWithinOpeningHours(slotStartIso, serviceDuration, openingHoursRaw);
            })
            .map(t => `${formatSlotTime(t)} (${worker.name})`);
        } catch {
          return [];
        }
      })
    );

    return results.flat();
  } catch (error: any) {
    console.error('[Availability Error]', error.message);
    return [];
  }
}

/**
 * Fetch required booking fields for an event type.
 */
export async function getBookingFields(eventTypeId: number) {
  try {
    const res = await calApiV2.get(`/event-types/${eventTypeId}`, {
      headers: { 'cal-api-version': VERSION_STABLE }
    });
    // Support both { data: { bookingFields } } and { data: { eventType: { bookingFields } } }
    return res.data.data?.eventType?.bookingFields || res.data.data?.bookingFields || [];
  } catch (error: any) {
    console.error('[Fields Error]', error.response?.data || error.message);
    return [];
  }
}

/**
 * DB-only hold — no Cal.com call. Assigns the first available worker for the slot.
 * Cal.com is only called at confirm time.
 */
export async function holdBooking(details: {
  serviceName: string;
  date: string;
  time: string;
  responses: Record<string, any>;
  salonId: string;
  salonName?: string;
  customerPhone: string;
  workerName?: string;
  salonServices?: any[];
}) {
  try {
    if (!isWithinBookingWindow(details.date)) {
      return { success: false, error: 'Bookings are available from today up to 6 months ahead only.' };
    }

    let workerQuery = supabase
      .from('workers')
      .select('id, name, cal_event_type_id, services')
      .eq('salon_id', details.salonId)
      .eq('is_active', true);

    const [salonRes, workersRes] = await Promise.all([
      details.salonServices
        ? Promise.resolve({ data: { services: details.salonServices, name: details.salonName || 'Salon', opening_hours: null } })
        : supabase.from('business_profiles').select('name, services, opening_hours').eq('id', details.salonId).single(),
      workerQuery
    ]);

    const allWorkers = workersRes.data || [];
    const workers = allWorkers.filter(w => {
      if (details.workerName) {
        return w.name.toLowerCase().includes(details.workerName.toLowerCase());
      }
      return (w.services as string[] || []).some(s => 
        s.toLowerCase().includes(details.serviceName.toLowerCase())
      );
    });

    const service = salonRes.data?.services?.find((s: any) =>
      s.name.toLowerCase().includes(details.serviceName.toLowerCase())
    );
    const resolvedSalonName = salonRes.data?.name || details.salonName || 'Salon';

    const normalizedResponses = { ...(details.responses || {}) };
    if (!normalizedResponses.title || !String(normalizedResponses.title).trim()) {
      normalizedResponses.title = `${resolvedSalonName} - ${details.serviceName}`;
    }

    const duration = service?.duration_minutes || 60;
    const startISO = getUtcStart(details.date, details.time);
    const endISO = new Date(new Date(startISO).getTime() + duration * 60000).toISOString();
    const openingHoursRaw = salonRes.data?.opening_hours || null;

    if (workers.length === 0) {
      return { success: false, error: 'No workers available for this service.' };
    }

    if (!isWithinOpeningHours(startISO, duration, openingHoursRaw)) {
      return { success: false, error: 'That time falls outside opening hours for this service duration.' };
    }

    // Find first worker with no conflict at this start time
    let assignedWorker = null;
    for (const worker of workers) {
      const { data: conflict } = await supabase
        .from('bookings')
        .select('id')
        .eq('worker_id', worker.id)
        .in('status', ['held', 'confirmed'])
        .lt('start_time', endISO)
        .gt('end_time', startISO)
        .limit(1);

      if (!conflict || conflict.length === 0) {
        assignedWorker = worker;
        break;
      }
    }

    if (!assignedWorker) {
      return { success: false, error: 'No workers available at that time.' };
    }

    const holdUid = `hold_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const { error: insertError } = await supabase.from('bookings').insert({
      cal_booking_uid: holdUid,
      salon_id: details.salonId,
      worker_id: assignedWorker.id,
      customer_phone: details.customerPhone,
      client_name: normalizedResponses.name || 'Client',
      client_email: normalizedResponses.email || 'client@example.com',
      responses: normalizedResponses,
      status: 'held',
      service_name: details.serviceName,
      duration_minutes: duration,
      start_time: startISO,
      end_time: endISO,
      expires_at: new Date(Date.now() + 10 * 60000).toISOString(),
    });

    if (insertError) {
      // Unique constraint violation = race condition, slot just taken
      return { success: false, error: 'That slot was just taken. Please choose another.' };
    }

    return { success: true, bookingUid: holdUid, workerName: assignedWorker.name, duration };
  } catch (error: any) {
    console.error('[Hold Error]', error.message);
    return { success: false, error: 'Failed to hold slot.' };
  }
}

/**
 * Cancels the customer's next upcoming confirmed booking.
 */
export async function cancelBooking(customerPhone: string, salonId: string, serviceName?: string) {
  try {
    let query = supabase
      .from('bookings')
      .select('*')
      .eq('customer_phone', customerPhone)
      .eq('salon_id', salonId)
      .eq('status', 'confirmed')
      .gte('start_time', new Date().toISOString())
      .order('start_time', { ascending: true });

    if (serviceName) {
      query = (query as any).ilike('service_name', `%${serviceName}%`);
    }

    const { data: bookings } = await (query as any).limit(1);
    if (!bookings || bookings.length === 0) {
      return { success: false, error: 'No upcoming booking found.' };
    }

    const booking = bookings[0];

    await calApiV2.delete(`/bookings/${booking.cal_booking_uid}`, {
      data: { cancellationReason: 'Customer requested cancellation via SMS' },
      headers: { 'cal-api-version': VERSION_LATEST }
    });

    await supabase.from('bookings').update({ status: 'cancelled' }).eq('id', booking.id);

    return {
      success: true,
      serviceName: booking.service_name,
      startTime: new Date(booking.start_time).toLocaleString('en-GB', { timeZone: 'Europe/London' })
    };
  } catch (error: any) {
    console.error('[Cancel Error]', error.response?.data || error.message);
    return { success: false, error: 'Failed to cancel booking.' };
  }
}

/**
 * Reschedules the customer's next upcoming confirmed booking to a new date/time.
 * Uses Cal.com native reschedule endpoint — no cancel+rebook needed.
 */
export async function rescheduleBooking(
  customerPhone: string,
  salonId: string,
  newDate: string,
  newTime: string,
  serviceName?: string
) {
  try {
    if (!isWithinBookingWindow(newDate)) {
      return { success: false, error: 'Reschedules are available from today up to 6 months ahead only.' };
    }

    let query = supabase
      .from('bookings')
      .select('*')
      .eq('customer_phone', customerPhone)
      .eq('salon_id', salonId)
      .eq('status', 'confirmed')
      .gte('start_time', new Date().toISOString())
      .order('start_time', { ascending: true });

    if (serviceName) {
      query = (query as any).ilike('service_name', `%${serviceName}%`);
    }

    const { data: bookings } = await (query as any).limit(1);
    if (!bookings || bookings.length === 0) {
      return { success: false, error: 'No upcoming booking found.' };
    }

    const booking = bookings[0];
    const newStartISO = getUtcStart(newDate, newTime);
    const newEndISO = new Date(new Date(newStartISO).getTime() + booking.duration_minutes * 60000).toISOString();

    const { data: salon } = await supabase
      .from('business_profiles')
      .select('opening_hours')
      .eq('id', salonId)
      .single();

    if (!isWithinOpeningHours(newStartISO, booking.duration_minutes, salon?.opening_hours || null)) {
      return { success: false, error: 'That new time exceeds opening hours for this service duration.' };
    }

    await calApiV2.patch(`/bookings/${booking.cal_booking_uid}/reschedule`, {
      start: newStartISO
    }, {
      headers: { 'cal-api-version': VERSION_LATEST }
    });

    await supabase
      .from('bookings')
      .update({ start_time: newStartISO, end_time: newEndISO })
      .eq('id', booking.id);

    return {
      success: true,
      serviceName: booking.service_name,
      newTime: formatSlotTime(newStartISO),
      newDate
    };
  } catch (error: any) {
    console.error('[Reschedule Error]', error.response?.data || error.message);
    return { success: false, error: 'Failed to reschedule booking.' };
  }
}

/**
 * Confirms a hold by creating the real booking in Cal.com using the assigned worker's event type.
 */
export async function confirmBooking(holdUid: string) {
  try {
    const { data: hold } = await supabase
      .from('bookings')
      .select('*, workers(name, cal_event_type_id)')
      .eq('cal_booking_uid', holdUid)
      .single();

    if (!hold) throw new Error('Hold not found.');
    if (hold.status !== 'held') throw new Error('Booking is no longer on hold.');

    const worker = (hold as any).workers;
    if (!worker) throw new Error('Worker not found for this booking.');

    const response = await calApiV2.post('/bookings', {
      eventTypeId: worker.cal_event_type_id,
      start: hold.start_time,
      lengthInMinutes: hold.duration_minutes,
      attendee: {
        name: hold.responses?.name || hold.client_name,
        email: hold.responses?.email || hold.client_email,
        timeZone: 'Europe/London',
        language: 'en'
      },
      bookingFieldsResponses: hold.responses || {},
      metadata: {
        service_name: hold.service_name,
        status: 'confirmed'
      }
    }, {
      headers: { 'cal-api-version': VERSION_LATEST }
    });

    const newBooking = response.data.data;

    await supabase
      .from('bookings')
      .update({
        status: 'confirmed',
        cal_booking_uid: newBooking.uid,
        cal_booking_id: newBooking.id
      })
      .eq('id', hold.id);

    await completeSession(hold.salon_id, hold.customer_phone);

    return { success: true, bookingUid: newBooking.uid };
  } catch (error: any) {
    console.error('[Confirm Error]', JSON.stringify(error.response?.data || error.message, null, 2));
    return { success: false, error: 'Failed to confirm booking.' };
  }
}

/**
 * A seamless one-step booking that holds and confirms immediately.
 */
export async function bookDirect(details: {
  serviceName: string;
  date: string;
  time: string;
  responses: Record<string, any>;
  salonId: string;
  salonName?: string;
  customerPhone: string;
  workerName?: string;
  salonServices?: any[];
}) {
  try {
    // 1. Hold the slot
    const hold = await holdBooking(details);
    if (!hold.success) return hold;

    // 2. Confirm immediately
    const confirm = await confirmBooking(hold.bookingUid!);
    if (!confirm.success) return confirm;

    return { 
        success: true, 
        bookingUid: confirm.bookingUid,
        workerName: hold.workerName,
        duration: hold.duration
    };
  } catch (error: any) {
    console.error('[Direct Booking Error]', error.message);
    return { success: false, error: 'Failed to finalize booking.' };
  }
}
