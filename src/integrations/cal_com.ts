import axios from 'axios';

const CAL_COM_API_KEY = process.env.CAL_COM_API_KEY;
const CAL_COM_EVENT_TYPE_ID = process.env.CAL_COM_EVENT_TYPE_ID;

const calApi = axios.create({
  baseURL: 'https://api.cal.com/v1',
  params: {
    apiKey: CAL_COM_API_KEY
  }
});

/**
 * Checks for available slots on a given date.
 */
export async function checkAvailability(date: string) {
  try {
    const response = await calApi.get('/availability', {
      params: {
        dateFrom: `${date}T00:00:00Z`,
        dateTo: `${date}T23:59:59Z`,
        eventTypeId: CAL_COM_EVENT_TYPE_ID
      }
    });

    // Return the first 3 available slots for brevity in SMS
    return response.data.slots?.[date]?.slice(0, 3).map((s: any) => s.time) || [];
  } catch (error: any) {
    console.error('[Cal.com Error]', error.response?.data || error.message);
    return [];
  }
}

/**
 * Books an appointment on Cal.com.
 */
export async function bookAppointment(details: {
  date: string;
  time: string;
  name: string;
  email: string;
  notes?: string;
}) {
  try {
    const response = await calApi.post('/bookings', {
      eventTypeId: parseInt(CAL_COM_EVENT_TYPE_ID || '0'),
      start: `${details.date}T${details.time}:00Z`, // Simplified ISO string
      responses: {
        name: details.name,
        email: details.email,
        notes: details.notes
      },
      timeZone: 'Europe/London' // Default for now
    });

    return { success: true, bookingId: response.data.booking.id };
  } catch (error: any) {
    console.error('[Cal.com Booking Error]', error.response?.data || error.message);
    return { success: false, error: error.response?.data?.message || 'Booking failed' };
  }
}
