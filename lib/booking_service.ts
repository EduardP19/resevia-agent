import { supabase, completeSession } from './supabase';
import axios from 'axios';

const CAL_COM_API_KEY = process.env.CAL_COM_API_KEY;

const calApiV2 = axios.create({
  baseURL: 'https://api.cal.eu/v2',
  headers: {
    'Authorization': `Bearer ${CAL_COM_API_KEY}`,
    'cal-api-version': '2024-08-13',
    'Content-Type': 'application/json'
  }
});

function getUtcStart(date: string, time: string): string {
  const localDate = new Date(`${date}T${time}:00`);
  const utcDate = new Date(localDate.toLocaleString('en-US', { timeZone: 'UTC' }));
  const londonDate = new Date(localDate.toLocaleString('en-US', { timeZone: 'Europe/London' }));
  const offsetMs = londonDate.getTime() - utcDate.getTime();
  return new Date(localDate.getTime() - offsetMs).toISOString();
}

function formatSlotTime(isoString: string): string {
  return new Date(isoString).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/London'
  });
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
    let query = supabase
      .from('workers')
      .select('id, name, cal_event_type_id')
      .eq('salon_id', salonId)
      .eq('is_active', true);

    if (workerName) {
      query = query.ilike('name', `%${workerName}%`);
    } else {
      query = query.contains('services', [serviceName]);
    }

    const { data: workers } = await query;
    if (!workers || workers.length === 0) return [];

    const results = await Promise.all(
      workers.map(async (worker) => {
        try {
          const [calRes, holdsRes] = await Promise.all([
            calApiV2.get('/slots/available', {
              params: {
                startTime: `${date}T00:00:00Z`,
                endTime: `${date}T23:59:59Z`,
                eventTypeId: worker.cal_event_type_id
              }
            }),
            supabase
              .from('bookings')
              .select('start_time')
              .eq('worker_id', worker.id)
              .in('status', ['held', 'confirmed'])
          ]);

          const slots = extractSlotTimes(calRes.data.data?.slots, date);
          const heldTimes = new Set(
            (holdsRes.data || []).map((h: any) => new Date(h.start_time).toISOString())
          );

          return slots
            .filter(t => !heldTimes.has(new Date(t).toISOString()))
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
 * DB-only hold — no Cal.com call. Assigns the first available worker for the slot.
 * Cal.com is only called at confirm time.
 */
export async function holdBooking(details: {
  serviceName: string;
  date: string;
  time: string;
  clientName: string;
  clientEmail: string;
  salonId: string;
  customerPhone: string;
  workerName?: string;
}) {
  try {
    let workerQuery = supabase
      .from('workers')
      .select('id, name, cal_event_type_id')
      .eq('salon_id', details.salonId)
      .eq('is_active', true);

    if (details.workerName) {
      workerQuery = workerQuery.ilike('name', `%${details.workerName}%`);
    } else {
      workerQuery = workerQuery.contains('services', [details.serviceName]);
    }

    const [salonRes, workersRes] = await Promise.all([
      supabase.from('business_profiles').select('services').eq('id', details.salonId).single(),
      workerQuery
    ]);

    const service = salonRes.data?.services?.find((s: any) =>
      s.name.toLowerCase().includes(details.serviceName.toLowerCase())
    );
    const duration = service?.duration_minutes || 60;
    const startISO = getUtcStart(details.date, details.time);
    const endISO = new Date(new Date(startISO).getTime() + duration * 60000).toISOString();

    const workers = workersRes.data || [];
    if (workers.length === 0) {
      return { success: false, error: 'No workers available for this service.' };
    }

    // Find first worker with no conflict at this start time
    let assignedWorker = null;
    for (const worker of workers) {
      const { data: conflict } = await supabase
        .from('bookings')
        .select('id')
        .eq('worker_id', worker.id)
        .in('status', ['held', 'confirmed'])
        .eq('start_time', startISO)
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
      client_name: details.clientName,
      client_email: details.clientEmail,
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
        name: hold.client_name,
        email: hold.client_email,
        timeZone: 'Europe/London',
        language: 'en'
      },
      metadata: {
        service_name: hold.service_name,
        status: 'confirmed'
      }
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
    console.error('[Confirm Error]', error.response?.data || error.message);
    return { success: false, error: 'Failed to confirm booking.' };
  }
}
