import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const API_KEY = process.env.CAL_COM_API_KEY;

async function finalTest() {
  try {
    console.log('--- Final V2 Injection Test ---');
    const res = await axios.post('https://api.cal.eu/v2/bookings', {
      eventTypeId: 237850,
      start: '2026-03-30T14:00:00Z',
      lengthInMinutes: 20,
      attendee: {
        name: 'Eduard Test',
        email: 'eduard@test.com'
      },
      timeZone: 'Europe/London',
      language: 'en',
      metadata: {}
    }, {
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'cal-api-version': '2024-06-11'
      }
    });
    console.log('✅ SUCCESS! Booking ID:', res.data.data.id);
  } catch (err: any) {
    console.log('❌ FAILED:', JSON.stringify(err.response?.data || err.message, null, 2));
  }
}

finalTest();
