import { safeLog } from '@/lib/logger';
import { normalizeSmsPrice } from '@/lib/sms-pricing';
import { supabase } from '@/lib/supabase';
import { resolveSmsFees, resolveWhatsAppFees, type MessageFees, type ServiceWindow } from '@/lib/message-rate-card';

export type SmsDirection = 'inbound' | 'outbound';

// Classifies *how* an outbound message was sent — surfaced in sms_messages so
// spend can be broken down by send type, not just channel/direction.
export type SmsMessageType =
  | 'whatsapp_template' // business-initiated Content template (outside 24h window)
  | 'auto_reply' // agent free-form reply to an inbound customer message
  | 'initiation' // owner-triggered outreach from the dashboard
  | 'missed_call_followup'; // voice webhook fallback after a missed call

export type SmsMetadata = {
  direction?: SmsDirection | null;
  status?: string | null;
  price?: number | null;
  priceUnit?: string | null;
  numSegments?: number | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  fromNumber?: string | null;
  toNumber?: string | null;
};

export type SmsMessageUpsert = SmsMetadata & {
  twilioMessageSid: string;
  sessionId?: string | null;
  transcriptId?: string | null;
  salonId?: string | null;
  channel?: 'sms' | 'whatsapp' | null;
  messageType?: SmsMessageType | null;
  rawPayload?: Record<string, any> | null;
  pricedAt?: string | null;
  lastPriceLookupAt?: string | null;
  priceLookupAttempts?: number | null;
  // Rate-card cost estimate. Computed here when omitted — see lib/message-rate-card.ts.
  metaFeeUsd?: number | null;
  twilioFeeUsd?: number | null;
  serviceWindow?: ServiceWindow | null;
};

const STATUS_RANK: Record<string, number> = {
  accepted: 1,
  queued: 1,
  receiving: 1,
  sending: 2,
  sent: 3,
  delivered: 4,
  received: 4,
  undelivered: 4,
  failed: 4,
  canceled: 4,
  read: 5,
};

function stringOrNull(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  return String(value);
}

export function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function compactRecord(record: Record<string, any>) {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined && value !== null)
  );
}

function jsonRecordOrEmpty(value: Record<string, any> | null | undefined) {
  if (!value) return undefined;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return {};
  }
}

function shouldKeepExistingStatus(existing?: string | null, incoming?: string | null) {
  if (!existing || !incoming) return false;
  return (STATUS_RANK[existing] || 0) > (STATUS_RANK[incoming] || 0);
}

export function formDataToRecord(formData: FormData) {
  const payload: Record<string, string> = {};
  formData.forEach((value, key) => {
    payload[key] = typeof value === 'string' ? value : value.name;
  });
  return payload;
}

export function smsMetadataFromTwilioMessage(message: any): SmsMetadata {
  return {
    status: stringOrNull(message?.status),
    price: normalizeSmsPrice(message?.price),
    priceUnit: stringOrNull(message?.priceUnit ?? message?.price_unit),
    numSegments: numberOrNull(message?.numSegments ?? message?.num_segments),
    errorCode: stringOrNull(message?.errorCode ?? message?.error_code),
    errorMessage: stringOrNull(message?.errorMessage ?? message?.error_message),
    fromNumber: stringOrNull(message?.from),
    toNumber: stringOrNull(message?.to),
  };
}

/**
 * Look up a ledger row by Twilio SID. `sms_messages` is the single source of
 * truth for per-message delivery/pricing metadata — transcripts only hold the
 * conversational content, linked back via sms_messages.transcript_id.
 */
export async function findSmsMessageBySid(twilioMessageSid: string) {
  const { data } = await supabase
    .from('sms_messages')
    .select('id, session_id, transcript_id, direction')
    .eq('twilio_message_sid', twilioMessageSid)
    .maybeSingle();

  return data;
}

/**
 * Rate-card estimate for a row being written.
 *
 * SMS is recomputed on every write: the segment count and the final status often
 * arrive on a later status callback, and both change the price. WhatsApp is priced
 * once, on the row's first write — the service window is only meaningful at send
 * time, and re-deriving it on each callback would re-query for no benefit.
 */
async function resolveFees(
  input: SmsMessageUpsert,
  existing?: { channel?: string | null; direction?: string | null; num_segments?: number | null; service_window?: string | null; status?: string | null } | null,
  effectiveStatus?: string | null
): Promise<MessageFees | null> {
  if (input.metaFeeUsd !== undefined || input.twilioFeeUsd !== undefined) return null;

  const channel = input.channel ?? existing?.channel ?? null;
  const direction = (input.direction ?? existing?.direction ?? null) as SmsDirection | null;
  if (!direction) return null;

  if (channel === 'whatsapp') {
    if (existing?.service_window) return null; // already priced
    return resolveWhatsAppFees({
      direction,
      customerNumber: direction === 'inbound' ? input.fromNumber : input.toNumber,
      messageType: input.messageType,
    });
  }

  if (channel === 'sms') {
    return resolveSmsFees({
      direction,
      numSegments: input.numSegments ?? existing?.num_segments,
      status: effectiveStatus,
    });
  }

  return null;
}

export async function upsertSmsMessage(input: SmsMessageUpsert) {
  try {
    const { data: existing } = await supabase
      .from('sms_messages')
      .select('id, status, channel, direction, num_segments, service_window')
      .eq('twilio_message_sid', input.twilioMessageSid)
      .maybeSingle();

    const status = shouldKeepExistingStatus(existing?.status, input.status)
      ? undefined
      : input.status;

    const fees = await resolveFees(input, existing, status ?? existing?.status);

    const payload = compactRecord({
      twilio_message_sid: input.twilioMessageSid,
      session_id: input.sessionId,
      transcript_id: input.transcriptId,
      salon_id: input.salonId,
      channel: input.channel,
      message_type: input.messageType,
      direction: input.direction,
      from_number: input.fromNumber,
      to_number: input.toNumber,
      status,
      price: input.price,
      price_unit: input.priceUnit,
      error_code: input.errorCode,
      error_message: input.errorMessage,
      num_segments: input.numSegments,
      meta_fee_usd: input.metaFeeUsd ?? fees?.metaFeeUsd,
      twilio_fee_usd: input.twilioFeeUsd ?? fees?.twilioFeeUsd,
      service_window: input.serviceWindow ?? fees?.serviceWindow,
      raw_payload: jsonRecordOrEmpty(input.rawPayload),
      priced_at: input.pricedAt,
      last_price_lookup_at: input.lastPriceLookupAt,
      price_lookup_attempts: input.priceLookupAttempts,
      updated_at: new Date().toISOString(),
    });

    const { data, error } = await supabase
      .from('sms_messages')
      .upsert(payload, { onConflict: 'twilio_message_sid' })
      .select()
      .single();

    if (error) {
      safeLog({
        type: 'error',
        level: 'error',
        category: 'system',
        event: 'db_error',
        error: error?.message || String(error),
        stack: error?.stack,
        query_description: 'Upsert SMS message ledger row',
        code: error?.code,
        twilio_message_sid: input.twilioMessageSid,
      });
      return null;
    }

    return data;
  } catch (error: any) {
    safeLog({
      type: 'error',
      level: 'error',
      category: 'system',
      event: 'db_error',
      error: error?.message || String(error),
      stack: error?.stack,
      query_description: 'Upsert SMS message ledger row',
      twilio_message_sid: input.twilioMessageSid,
    });
    return null;
  }
}
