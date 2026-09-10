import { saveMessage } from '@/lib/supabase';
import { sendSMS, sendWhatsAppTemplate, waitForWhatsAppConfirmation } from '@/lib/twilio';
import { smsMetadataFromTwilioMessage, recordMessageCost } from '@/lib/costs';
import { recordClientWhatsAppAvailability } from '@/lib/clients';
import type { ClientProfile } from '@/lib/client-profile';
import { safeLog } from '@/lib/logger';

/**
 * Written confirmation of a booking.
 *
 * The approved WhatsApp Content template is tried first, so confirmations work
 * outside Meta's 24h service window. If WhatsApp is unavailable, unconfirmed or
 * rejected, the same rendered body falls back to SMS.
 */

const WHATSAPP_CONFIRM_TIMEOUT_MS = Number(process.env.WHATSAPP_CONFIRM_TIMEOUT_MS || 20000);
const BOOKING_CONFIRMATION_TEMPLATE_SID =
  process.env.TWILIO_WHATSAPP_BOOKING_CONFIRMATION_TEMPLATE_SID || null;
const RETIRED_BOOKING_CONFIRMATION_TEMPLATE_SIDS = new Set([
  // Duplicate template submitted on 2026-09-09, then deleted after we found
  // Amo already had an approved Meta template with the same body.
  'HX2dd40673975135520e1714cee50f91e9',
]);

export interface BookingConfirmationInput {
  salon: any;
  sessionId: string;
  customerPhone: string;
  body: string;
  client?: ClientProfile | null;
  customerName?: string | null;
  appointment?: string | null;
  serviceName?: string | null;
  confirmationNumber?: string | null;
  whatsappConfirmTimeoutMs?: number;
}

function normalizeE164(value: unknown): string | undefined {
  const trimmed = String(value ?? '').trim();
  if (!trimmed.includes('+')) return undefined;
  const normalized = `+${trimmed.slice(trimmed.indexOf('+') + 1).replace(/\D/g, '')}`;
  return normalized.length >= 8 ? normalized : undefined;
}

function firstNameFrom(input: BookingConfirmationInput) {
  const provided = String(input.customerName || '').trim();
  const fromClient = String(input.client?.first_name || '').trim();
  return provided.split(/\s+/)[0] || fromClient || 'there';
}

function bookingConfirmationTemplateSid(salon: any) {
  const contentSid = (
    String(salon?.whatsapp_booking_confirmation_template_sid || '').trim() ||
    BOOKING_CONFIRMATION_TEMPLATE_SID ||
    null
  );
  return contentSid && !RETIRED_BOOKING_CONFIRMATION_TEMPLATE_SIDS.has(contentSid) ? contentSid : null;
}

function renderBookingConfirmationBody(input: BookingConfirmationInput) {
  return [
    `Hi ${firstNameFrom(input)},`,
    `Your appointment is scheduled for ${input.appointment || 'your selected time'}.`,
    '',
    `Service: ${input.serviceName || 'your appointment'}`,
    `Confirmation number: ${input.confirmationNumber || 'pending'}`,
    '',
    "We're looking forward to your visit.",
  ].join('\n');
}

async function recordOutbound(params: {
  salonId: string;
  sessionId: string;
  channel: 'whatsapp' | 'sms';
  body: string;
  message: any;
}) {
  const transcript = await saveMessage(params.sessionId, 'assistant', params.body, params.channel);
  await recordMessageCost({
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
  customerName,
  appointment,
  serviceName,
  confirmationNumber,
  whatsappConfirmTimeoutMs,
}: BookingConfirmationInput): Promise<{ channel: 'whatsapp' | 'sms' } | null> {
  const statusCallbackUrl = process.env.TWILIO_STATUS_CALLBACK_URL || undefined;
  const logContext = { tenant_id: salon?.id, session_id: sessionId };
  const confirmationBody = body || renderBookingConfirmationBody({
    salon,
    sessionId,
    customerPhone,
    body,
    client,
    customerName,
    appointment,
    serviceName,
    confirmationNumber,
  });

  // `false` means a previous send to this number failed on WhatsApp. Unknown
  // (`null`) still gets a try — that's how the flag ever gets set.
  const whatsappWorthTrying = Boolean(salon?.whatsapp_number) && client?.whatsapp_available !== false;

  if (whatsappWorthTrying) {
    try {
      const contentSid = bookingConfirmationTemplateSid(salon);
      if (!contentSid) {
        throw new Error('[Twilio] Missing booking confirmation WhatsApp template. Set TWILIO_WHATSAPP_BOOKING_CONFIRMATION_TEMPLATE_SID or business_profiles.whatsapp_booking_confirmation_template_sid.');
      }

      const message = await sendWhatsAppTemplate(
        customerPhone,
        {
          contentSid,
          contentVariables: {
            '1': firstNameFrom({ salon, sessionId, customerPhone, body: confirmationBody, client, customerName }),
            '2': appointment || 'your selected time',
            '3': serviceName || 'your appointment',
            '4': confirmationNumber || 'pending',
          },
          statusCallbackUrl,
        },
        logContext
      );
      const { confirmed, status } = await waitForWhatsAppConfirmation(
        message.sid,
        whatsappConfirmTimeoutMs ?? WHATSAPP_CONFIRM_TIMEOUT_MS,
        2000,
        logContext
      );

      if (confirmed) {
        await recordOutbound({ salonId: salon.id, sessionId, channel: 'whatsapp', body: confirmationBody, message });
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

  const message = await sendSMS(customerPhone, confirmationBody, statusCallbackUrl, {
    ...logContext,
    fromNumber: normalizeE164(salon?.twilio_number),
  });
  await recordOutbound({ salonId: salon.id, sessionId, channel: 'sms', body: confirmationBody, message });
  return { channel: 'sms' };
}
