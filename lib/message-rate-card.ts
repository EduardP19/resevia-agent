import { supabase } from '@/lib/supabase';
import { safeLog } from '@/lib/logger';
import { stripWhatsAppPrefix } from '@/lib/twilio';

/**
 * Rate-card cost estimate per message, recorded on `sms_messages` alongside
 * Twilio's own reported `price`. The two are separate views of the same spend and
 * must never be summed:
 *
 *   price          — what Twilio actually billed (arrives late, sometimes never)
 *   twilio_fee_usd — what the published rate card says this message costs
 *   meta_fee_usd   — Meta's WhatsApp share, which Twilio bills against the
 *                    conversation rather than the message
 *
 * SMS is charged **per segment** (160 GSM-7 chars, 153/segment once concatenated;
 * 70/67 for Unicode), so the estimate multiplies the rate by `num_segments`.
 * WhatsApp is per message: a flat Twilio platform fee both directions, plus Meta's
 * fee on template sends and on anything sent outside the 24h service window.
 *
 * Every rate is env-overridable — the defaults are the published US/UK list prices.
 * Carrier surcharges and MMS are not modelled.
 */

function readRate(raw: string | undefined, fallback: number) {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/** Per segment, not per message. */
export const SMS_OUTBOUND_SEGMENT_FEE_USD = readRate(process.env.SMS_OUTBOUND_SEGMENT_FEE_USD, 0.056);
export const SMS_INBOUND_SEGMENT_FEE_USD = readRate(process.env.SMS_INBOUND_SEGMENT_FEE_USD, 0.0075);
/** Applied once to messages that end up failed/undelivered. Set to 0 to disable. */
export const SMS_FAILED_MESSAGE_FEE_USD = readRate(process.env.SMS_FAILED_MESSAGE_FEE_USD, 0.001);

export const WHATSAPP_META_FEE_USD = readRate(process.env.WHATSAPP_META_FEE_USD, 0.022);
export const WHATSAPP_TWILIO_FEE_USD = readRate(process.env.WHATSAPP_TWILIO_FEE_USD, 0.005);
export const SERVICE_WINDOW_HOURS = 24;

const FAILED_STATUSES = new Set(['failed', 'undelivered']);

export type ServiceWindow = 'open' | 'closed';

export type MessageFees = {
  metaFeeUsd: number;
  twilioFeeUsd: number;
  serviceWindow: ServiceWindow | null;
};

/**
 * Meta's customer service window is open for 24h after the customer's last inbound
 * WhatsApp message. Inbound rows store the number without the `whatsapp:` prefix.
 */
export async function isServiceWindowOpen(customerNumber: string, at: Date = new Date()): Promise<boolean> {
  const number = stripWhatsAppPrefix(customerNumber || '');
  if (!number) return false;

  const windowStart = new Date(at.getTime() - SERVICE_WINDOW_HOURS * 60 * 60 * 1000).toISOString();

  try {
    const { data, error } = await supabase
      .from('sms_messages')
      .select('id')
      .eq('channel', 'whatsapp')
      .eq('direction', 'inbound')
      .eq('from_number', number)
      .gte('created_at', windowStart)
      .limit(1);

    if (error) throw error;
    return (data || []).length > 0;
  } catch (error: any) {
    safeLog({
      type: 'error',
      level: 'warning',
      category: 'sms',
      event: 'whatsapp_service_window_lookup_failed',
      error: error?.message || String(error),
      customer_phone: number,
    });
    // Assume closed: over-reporting cost is safer than silently under-reporting it.
    return false;
  }
}

/** SMS: per-segment rate by direction, plus the processing fee on a failed send. */
export function resolveSmsFees(input: {
  direction: 'inbound' | 'outbound';
  numSegments?: number | null;
  status?: string | null;
}): MessageFees {
  const segments = Number(input.numSegments);
  const billableSegments = Number.isFinite(segments) && segments > 0 ? segments : 1;
  const rate = input.direction === 'outbound' ? SMS_OUTBOUND_SEGMENT_FEE_USD : SMS_INBOUND_SEGMENT_FEE_USD;
  const failedFee = FAILED_STATUSES.has((input.status || '').toLowerCase()) ? SMS_FAILED_MESSAGE_FEE_USD : 0;

  return {
    metaFeeUsd: 0,
    twilioFeeUsd: billableSegments * rate + failedFee,
    serviceWindow: null,
  };
}

/** WhatsApp: flat Twilio fee both directions; Meta's fee on templates / outside the window. */
export async function resolveWhatsAppFees(input: {
  direction: 'inbound' | 'outbound';
  customerNumber?: string | null;
  messageType?: string | null;
  at?: Date;
}): Promise<MessageFees> {
  if (input.direction === 'inbound') {
    return { metaFeeUsd: 0, twilioFeeUsd: WHATSAPP_TWILIO_FEE_USD, serviceWindow: 'open' };
  }

  const windowOpen = input.customerNumber
    ? await isServiceWindowOpen(input.customerNumber, input.at)
    : false;
  // Templates are utility/marketing category — Meta charges them either way.
  const isTemplate = input.messageType === 'whatsapp_template';
  const metaCharged = isTemplate || !windowOpen;

  return {
    metaFeeUsd: metaCharged ? WHATSAPP_META_FEE_USD : 0,
    twilioFeeUsd: WHATSAPP_TWILIO_FEE_USD,
    serviceWindow: windowOpen ? 'open' : 'closed',
  };
}
