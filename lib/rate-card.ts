import { supabase } from '@/lib/supabase';
import { safeLog } from '@/lib/logger';
import { stripWhatsAppPrefix } from '@/lib/twilio';

/**
 * Published list prices, applied at write time so every row in `costs` carries a
 * number the moment it is created.
 *
 * This is the *estimate* half of the estimate-to-billed progression: a cost row
 * starts here with `estimated = true`, and is overwritten later by whatever the
 * provider actually billed. Nothing downstream has to know which it is looking
 * at — it sums one column either way.
 *
 * Every rate is env-overridable, and so is the currency they are denominated in.
 * The defaults are USD list prices, but Twilio bills some accounts in another
 * currency entirely — this one is billed in GBP — and an estimate is only
 * comparable to the billed figure if both carry the same unit. Set
 * RATE_CARD_CURRENCY alongside rates in that currency; never leave the rates in
 * one currency and the label in another.
 *
 * Carrier surcharges and MMS are not modelled.
 */

/** The currency the rates below are expressed in. */
export const RATE_CARD_CURRENCY = (process.env.RATE_CARD_CURRENCY || 'USD').trim().toUpperCase();

function readRate(raw: string | undefined, fallback: number) {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/** SMS is billed per segment, not per message. */
export const SMS_OUTBOUND_SEGMENT_FEE_USD = readRate(process.env.SMS_OUTBOUND_SEGMENT_FEE_USD, 0.056);
export const SMS_INBOUND_SEGMENT_FEE_USD = readRate(process.env.SMS_INBOUND_SEGMENT_FEE_USD, 0.0075);
/** Applied once to messages that end up failed/undelivered. Set to 0 to disable. */
export const SMS_FAILED_MESSAGE_FEE_USD = readRate(process.env.SMS_FAILED_MESSAGE_FEE_USD, 0.001);

export const WHATSAPP_META_FEE_USD = readRate(process.env.WHATSAPP_META_FEE_USD, 0.022);
export const WHATSAPP_TWILIO_FEE_USD = readRate(process.env.WHATSAPP_TWILIO_FEE_USD, 0.005);
export const SERVICE_WINDOW_HOURS = 24;

/**
 * Voice is billed per minute by two providers at once: Deepgram for the agent
 * (STT + LLM + TTS on one meter) and Twilio for carrying the call.
 *
 * Deepgram's own usage API (`/v1/projects/{id}/usage/breakdown`) reports real
 * spend, but only per project and only in aggregate — it cannot attribute a call
 * to a tenant, so it can't price a row at hangup. These rates do that; a later
 * reconciliation job could upgrade the row the way SMS pricing does.
 */
export const VOICE_DEEPGRAM_USD_PER_MINUTE = readRate(process.env.DEEPGRAM_VOICE_USD_PER_MINUTE, 0.075);
export const VOICE_TWILIO_USD_PER_MINUTE = readRate(process.env.TWILIO_VOICE_USD_PER_MINUTE, 0.0085);

const FAILED_STATUSES = new Set(['failed', 'undelivered']);

export type ServiceWindow = 'open' | 'closed';

export type RatedCost = {
  amount: number;
  currency: string;
  serviceWindow: ServiceWindow | null;
};

/**
 * Meta's customer service window is open for 24h after the customer's last
 * inbound WhatsApp message. Inbound rows store the number without the
 * `whatsapp:` prefix.
 */
export async function isServiceWindowOpen(customerNumber: string, at: Date = new Date()): Promise<boolean> {
  const number = stripWhatsAppPrefix(customerNumber || '');
  if (!number) return false;

  const windowStart = new Date(at.getTime() - SERVICE_WINDOW_HOURS * 60 * 60 * 1000).toISOString();

  try {
    const { data, error } = await supabase
      .from('costs')
      .select('id')
      .eq('source', 'whatsapp')
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
export function rateSms(input: {
  direction: 'inbound' | 'outbound';
  numSegments?: number | null;
  status?: string | null;
}): RatedCost {
  const segments = Number(input.numSegments);
  const billableSegments = Number.isFinite(segments) && segments > 0 ? segments : 1;
  const rate = input.direction === 'outbound' ? SMS_OUTBOUND_SEGMENT_FEE_USD : SMS_INBOUND_SEGMENT_FEE_USD;
  const failedFee = FAILED_STATUSES.has((input.status || '').toLowerCase()) ? SMS_FAILED_MESSAGE_FEE_USD : 0;

  return {
    amount: billableSegments * rate + failedFee,
    currency: RATE_CARD_CURRENCY,
    serviceWindow: null,
  };
}

/**
 * WhatsApp: flat Twilio platform fee both directions, plus Meta's fee on template
 * sends and on anything outside the 24h window. Free-form replies inside the
 * window cost only the platform fee.
 */
export async function rateWhatsApp(input: {
  direction: 'inbound' | 'outbound';
  customerNumber?: string | null;
  kind?: string | null;
  at?: Date;
}): Promise<RatedCost> {
  if (input.direction === 'inbound') {
    return { amount: WHATSAPP_TWILIO_FEE_USD, currency: RATE_CARD_CURRENCY, serviceWindow: 'open' };
  }

  const windowOpen = input.customerNumber
    ? await isServiceWindowOpen(input.customerNumber, input.at)
    : false;
  // Templates are utility/marketing category — Meta charges them either way.
  const metaCharged = input.kind === 'whatsapp_template' || input.kind === 'booking_confirmation' || !windowOpen;

  return {
    amount: WHATSAPP_TWILIO_FEE_USD + (metaCharged ? WHATSAPP_META_FEE_USD : 0),
    currency: RATE_CARD_CURRENCY,
    serviceWindow: windowOpen ? 'open' : 'closed',
  };
}

/** Voice: both per-minute meters, billed against the same call duration. */
export function rateVoice(input: { seconds: number; agentHandled?: boolean }): RatedCost {
  const seconds = Number.isFinite(input.seconds) && input.seconds > 0 ? input.seconds : 0;
  const minutes = seconds / 60;
  const perMinute =
    VOICE_TWILIO_USD_PER_MINUTE + (input.agentHandled === false ? 0 : VOICE_DEEPGRAM_USD_PER_MINUTE);

  return { amount: minutes * perMinute, currency: RATE_CARD_CURRENCY, serviceWindow: null };
}
