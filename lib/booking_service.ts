import { supabase } from './supabase';
import axios from 'axios';

const CAL_COM_API_KEY = process.env.CAL_COM_API_KEY;
const SERVICE_EVENT_TYPE_ID = 237850; // "Service Booking" portal
const HOLD_EVENT_TYPE_ID = 238175;    // "HOLD - Slot Reserved" portal

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
  const utcStart = new Date(localDate.getTime() - offsetMs);
  return utcStart.toISOString();
}

/**
 * Creates a hold booking (no emails sent) to block a slot.
 */
export async function holdBooking(details: {
  serviceName: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
  clientName: string;
  clientEmail: string;
  salonId: string;
  customerPhone: string;
}) {
  try {
    const { data: salon } = await supabase
      .from('business_profiles')
      .select('services')
      .eq('id', details.salonId)
      .single();

    const service = salon?.services.find((s: any) => 
      s.name.toLowerCase().includes(details.serviceName.toLowerCase())
    );

    const duration = service?.duration_minutes || 15;
    const price = service?.price || 0;
    const startISO = getUtcStart(details.date, details.time);

    const response = await calApiV2.post('/bookings', {
      eventTypeId: HOLD_EVENT_TYPE_ID,
      start: startISO,
      lengthInMinutes: duration,
      attendee: {
        name: details.clientName,
        email: details.clientEmail,
        timeZone: 'Europe/London',
        language: 'en'
      },
      metadata: {
        service_name: details.serviceName,
        price: `£${price}`,
        status: 'held'
      }
    });

    const booking = response.data.data;
    
    // Track in Supabase for ghosting logic
    await supabase.from('bookings').insert({
      cal_booking_uid: booking.uid,
      cal_booking_id: booking.id,
      salon_id: details.salonId,
      customer_phone: details.customerPhone,
      status: 'held',
      service_name: details.serviceName,
      start_time: startISO,
      expires_at: new Date(Date.now() + 10 * 60000).toISOString(), // 10 min hold
    });

    return { success: true, bookingUid: booking.uid, duration };
  } catch (error: any) {
    console.error('[Hold Error]', error.response?.data || error.message);
    return { success: false, error: 'Failed to hold slot.' };
  }
}

/**
 * Confirms a hold by canceling it and creating a real booking.
 */
export async function confirmBooking(holdUid: string) {
  try {
    // 1. Get hold details from Supabase
    const { data: hold } = await supabase
      .from('bookings')
      .select('*')
      .eq('cal_booking_uid', holdUid)
      .single();

    if (!hold) throw new Error('Hold not found.');

    // 2. Cancel the hold on Cal.com
    await calApiV2.post(`/bookings/${holdUid}/cancel`, {
      cancellationReason: 'Slot confirmed by customer'
    });

    // 3. Create the real booking
    const response = await calApiV2.post('/bookings', {
      eventTypeId: SERVICE_EVENT_TYPE_ID,
      start: hold.start_time,
      lengthInMinutes: hold.duration || 30, // Need to track duration in DB too
      attendee: {
        name: 'Confirmed Client', // Ideally pass real name/email from previous flow
        email: 'confirmed@resevia.com',
        timeZone: 'Europe/London',
        language: 'en'
      },
      metadata: {
        service_name: hold.service_name,
        status: 'confirmed'
      }
    });

    const newBooking = response.data.data;

    // 4. Update Supabase
    await supabase
      .from('bookings')
      .update({ status: 'confirmed', cal_booking_uid: newBooking.uid, cal_booking_id: newBooking.id })
      .eq('id', hold.id);

    return { success: true, bookingUid: newBooking.uid };
  } catch (error: any) {
    console.error('[Confirm Error]', error.response?.data || error.message);
    return { success: false, error: 'Failed to confirm booking.' };
  }
}

/**
 * Fetch availability using v2 slots API
 */
export async function fetchAvailability(date: string) {
  try {
    const response = await calApiV2.get('/slots/available', {
      params: {
        startTime: `${date}T00:00:00Z`,
        endTime: `${date}T23:59:59Z`,
        eventTypeId: SERVICE_EVENT_TYPE_ID
      }
    });

    return response.data.data?.slots || [];
  } catch (error: any) {
    console.error('[V2 Availability Error]', error.message);
    return [];
  }
}
