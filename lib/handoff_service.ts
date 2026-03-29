import { supabase } from './supabase';

/**
 * Service to handle outbound alerts when a session is escalated (handed_over).
 * Currently logs to console, but designed to be extended to Email/Slack.
 */
export async function notifyOwnerHandoff(sessionId: string, salonId: string) {
  try {
    const { data: session } = await supabase
      .from('sessions')
      .select('*, business_profiles(name, twilio_number)')
      .eq('id', sessionId)
      .single();

    if (!session) return;

    const salonName = session.business_profiles?.name || 'Your Salon';
    const clientRef = session.client_identifier;

    console.log('\x1b[31m%s\x1b[0m', `🚨 [HANDOFF ALERT] ${salonName}: Client ${clientRef} has been escalated to human support!`);
    console.log('\x1b[31m%s\x1b[0m', `🔗 View here: ${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/dashboard/sessions/${sessionId}`);

    // TODO: In production, trigger Email (Resend) or Slack Webhook here.
  } catch (err) {
    console.error('[Handoff Notification Error]', err);
  }
}
