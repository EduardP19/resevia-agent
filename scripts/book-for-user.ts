import 'dotenv/config';
import { holdBooking, confirmBooking } from '../lib/booking_service';

async function bookForUser() {
  const details = {
    serviceName: 'Ladies - Wash & Blow Dry',
    date: '2026-03-30', // Monday
    time: '11:00',      // 11 AM
    responses: {
      name: 'Eduard Test',
      email: 'eduard@test.com'
    },
    salonId: 'e38da5c1-ca7a-430e-ae91-a15535bb67be',
    customerPhone: '+447700000001',
  };

  console.log('--- Attempting to book appointment ---');
  console.log('Details:', JSON.stringify(details, null, 2));

  try {
    // 1. Create Hold
    const holdRes = await holdBooking(details);
    if (!holdRes.success) {
      console.error('❌ Failed to create hold:', holdRes.error);
      return;
    }
    console.log('✅ Hold created successully. UID:', holdRes.bookingUid);

    // 2. Confirm Booking
    const confirmRes = await confirmBooking(holdRes.bookingUid!);
    if (!confirmRes.success) {
      console.error('❌ Failed to confirm booking:', confirmRes.error);
      return;
    }
    console.log('✅ Booking confirmed successfully! Cal.com UID:', confirmRes.bookingUid);

  } catch (err: any) {
    console.error('❌ An unexpected error occurred:', err.message);
  }
}

bookForUser();
