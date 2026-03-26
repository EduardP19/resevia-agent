import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const API_KEY = process.env.CAL_COM_API_KEY;

async function testBooking() {
  const bases = ['https://api.cal.com/v1', 'https://api.cal.eu/v1'];
  
  for (const base of bases) {
    try {
      console.log(`Trying base: ${base}`);
      // Try to find the event type ID for '15min'
      const res = await axios.get(`${base}/event-types`, {
        params: { apiKey: API_KEY }
      });
      
      const eventTypes = res.data.event_types || [];
      const event15 = eventTypes.find((e: any) => e.slug === '15min');
      
      if (event15) {
        console.log(`Found Event Type ID: ${event15.id}`);
        // Attempt a booking
        const bookingRes = await axios.post(`${base}/bookings`, {
          eventTypeId: event15.id,
          start: '2026-03-30T14:00:00.000Z',
          responses: {
            name: 'Test Client',
            email: 'test@example.com',
            notes: 'SIMULATED BOOKING: Blow dry'
          },
          timeZone: 'Europe/London'
        }, {
          params: { apiKey: API_KEY }
        });
        
        console.log('✅ Booking Success!', bookingRes.data.booking.id);
        return;
      } else {
        console.log('Event "15min" not found at this base.');
      }
    } catch (err: any) {
      console.log(`Failed at ${base}:`, err.response?.data?.message || err.message);
    }
  }
}

testBooking();
