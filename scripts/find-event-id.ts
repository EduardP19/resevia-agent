import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const API_KEY = process.env.CAL_COM_API_KEY;

async function listEventTypes() {
  try {
    const res = await axios.get('https://api.cal.com/v1/event-types', {
      params: { apiKey: API_KEY }
    });
    console.log('--- Cal.com Event Types ---');
    console.log(JSON.stringify(res.data.event_types.map((e: any) => ({
      id: e.id,
      title: e.title,
      slug: e.slug
    })), null, 2));
  } catch (err: any) {
    console.error('API Error:', err.response?.data || err.message);
  }
}

listEventTypes();
