import { saveMessage } from '@/lib/supabase';
import { sendSMS, sendWhatsAppMessage, waitForWhatsAppConfirmation } from '@/lib/twilio';
import { smsMetadataFromTwilioMessage, upsertSmsMessage } from '@/lib/sms-messages';
import { recordClientWhatsAppAvailability } from '@/lib/clients';
import type { ClientProfile } from '@/lib/client-profile';
import { safeLog } from '@/lib/logger';

/**
 * Written confirmation of a booking taken on a channel that can't carry one.
 *
 * A phone call leaves the caller with nothing to look at, and we no longer ask
 * for an email address on voice — so the confirmation goes to the number they
 * called from: WhatsApp first, SMS if WhatsApp doesn't land. Same
 * WhatsApp-then-SMS shape as the missed-call follow-up in /api/twilio/voice,
 * with one addition: the outcome is written back to `clients.whatsapp_available`
 * so the next message to this person skips a WhatsApp attempt we already know
 * falls back.
 *
 * Note the WhatsApp send here is free-form, which Meta only delivers inside the
 * 24h customer-service window. A caller who has never messaged the salon on
 * WhatsApp is outside it, so the SMS fallback is the normal path, not the
 * exception — which is why the whole thing runs detached from the call.
 */

const WHATSAPP_CONFIRM_TIMEOUT_MS = Number(process.env.WHATSAPP_CONFIRM_TIMEOUT_MS || 20000);

export interface BookingConfirmationInput {
  salon: any;
  sessionId: string;
  customerPhone: string;
  body: string;
  client?: ClientProfile | null;
}

function normalizeE164(value: unknown): string | undefined {
  const trimmed = String(value ?? '').trim();
  if (!trimmed.includes('+')) return undefined;
  const normalized = `+${trimmed.slice(trimmed.indexOf('+') + 1).replace(/\D/g, '')}`;
  return normalized.length >= 8 ? normalized : undefined;
}

async function recordOutbound(params: {
  salonId: string;
  sessionId: string;
  channel: 'whatsapp' | 'sms';
  body: string;
  message: any;
}) {
  const transcript = await saveMessage(params.sessionId, 'assistant', params.body, params.channel);
  await upsertSmsMessage({
    twilioMessageSid: params.message.sid,
    direction: 'outbound',
    ...smsMetadataFromTwilioMessage(params.message),
    channel: params.channel,
    messageType: 'booking_confirmation',
    sessionId: params.sessionId,
    transcriptId: transcript?.id ?? null,
    salonId: params.salonId,
    rawPayload: params.message,
  });
}

export async function sendBookingConfirmation({
  salon,
  sessionId,
  customerPhone,
  body,
  client,
}: BookingConfirmationInput): Promise<{ channel: 'whatsapp' | 'sms' } | null> {
  const statusCallbackUrl = process.env.TWILIO_STATUS_CALLBACK_URL || undefined;
  const logContext = { tenant_id: salon?.id, session_id: sessionId };

  // `false` means a previous send to this number failed on WhatsApp. Unknown
  // (`null`) still gets a try — that's how the flag ever gets set.
  const whatsappWorthTrying = Boolean(salon?.whatsapp_number) && client?.whatsapp_available !== false;

  if (whatsappWorthTrying) {
    try {
      const message = await sendWhatsAppMessage(customerPhone, body, statusCallbackUrl, logContext);
      const { confirmed, status } = await waitForWhatsAppConfirmation(message.sid, WHATSAPP_CONFIRM_TIMEOUT_MS);

      if (confirmed) {
        await recordOutbound({ salonId: salon.id, sessionId, channel: 'whatsapp', body, message });
        await recordClientWhatsAppAvailability(salon.id, customerPhone, true);
        return { channel: 'whatsapp' };
      }

      safeLog({
        type: 'integration', level: 'warning', category: 'sms',
        event: 'whatsapp_booking_confirmation_unconfirmed',
        ...logContext, twilio_message_sid: message.sid, sms_status: status,
      });
      await recordClientWhatsAppAvailability(salon.id, customerPhone, false);
    } catch (error: any) {
      safeLog({
        type: 'integration', level: 'warning', category: 'sms',
        event: 'whatsapp_booking_confirmation_fallback',
        ...logContext, error: error?.message || String(error), code: error?.code || null,
      });
      // Only Twilio's own rejection says anything about this number. A missing
      // sender or missing credentials is our misconfiguration, and marking the
      // client unreachable for it would suppress WhatsApp for them forever.
      if (error?.code) await recordClientWhatsAppAvailability(salon.id, customerPhone, false);
    }
  }

  const message = await sendSMS(customerPhone, body, statusCallbackUrl, {
    ...logContext,
    fromNumber: normalizeE164(salon?.twilio_number),
  });
  await recordOutbound({ salonId: salon.id, sessionId, channel: 'sms', body, message });
  return { channel: 'sms' };
}
