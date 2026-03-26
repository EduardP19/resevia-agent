import { supabase } from '../lib/supabase';
import { sendSMS } from '../lib/twilio';
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

async function processGhosting() {
  const now = new Date();
  
  // 1. Find holds that need a reminder (5-10 mins in)
  // Logic: expired_at is 10 mins from creation. Reminder at 5 mins.
  const { data: needsReminder } = await supabase
    .from('bookings')
    .select('*, salon:business_profiles(name)')
    .eq('status', 'held')
    .is('reminded_at', null)
    .lt('expires_at', new Date(now.getTime() + 5 * 60000).toISOString());

  if (needsReminder) {
    for (const hold of needsReminder) {
      const msg = `Hi! Just checking in. We have that slot for ${hold.service_name} at ${new Date(hold.start_time).toLocaleTimeString()} held for you. It will be released in 5 minutes if not confirmed!`;
      await sendSMS(hold.customer_phone, msg);
      await supabase.from('bookings').update({ reminded_at: now.toISOString() }).eq('id', hold.id);
    }
  }

  // 2. Find holds that have truly expired (10 mins in)
  const { data: expired } = await supabase
    .from('bookings')
    .select('*')
    .eq('status', 'held')
    .lt('expires_at', now.toISOString());

  if (expired) {
    for (const hold of expired) {
      // Release slot on Cal.com
      await calApiV2.post(`/bookings/${hold.cal_booking_uid}/cancel`, {
        cancellationReason: 'Hold expired due to ghosting'
      });

      // Update DB
      await supabase.from('bookings').update({ status: 'expired' }).eq('id', hold.id);

      // Send final SMS
      const msg = `Your slot for ${hold.service_name} has been released. If you'd still like to book, just text back here and I can help!`;
      await sendSMS(hold.customer_phone, msg);
    }
  }
}

// In a real app, this would be a CRON job. For this demonstration, we can trigger it.
processGhosting().catch(console.error);
