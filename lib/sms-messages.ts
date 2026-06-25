import { safeLog } from '@/lib/logger';
import { normalizeSmsPrice } from '@/lib/sms-pricing';
import { supabase } from '@/lib/supabase';

export type SmsDirection = 'inbound' | 'outbound';

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
  rawPayload?: Record<string, any> | null;
  pricedAt?: string | null;
  lastPriceLookupAt?: string | null;
  priceLookupAttempts?: number | null;
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

export function transcriptSmsPayload(metadata: SmsMetadata & { twilioMessageSid?: string | null }) {
  return compactRecord({
    twilio_message_sid: metadata.twilioMessageSid,
    sms_direction: metadata.direction,
    sms_status: metadata.status,
    sms_price: metadata.price,
    sms_price_unit: metadata.priceUnit,
    sms_num_segments: metadata.numSegments,
    sms_error_code: metadata.errorCode,
    sms_error_message: metadata.errorMessage,
    sms_from_number: metadata.fromNumber,
    sms_to_number: metadata.toNumber,
    sms_updated_at: new Date().toISOString(),
  });
}

export async function updateTranscriptSmsMetadata(
  transcriptId: string,
  metadata: SmsMetadata & { twilioMessageSid?: string | null }
) {
  const payload = transcriptSmsPayload(metadata);
  if (Object.keys(payload).length <= 1) return null;

  const { data, error } = await supabase
    .from('transcripts')
    .update(payload)
    .eq('id', transcriptId)
    .select('id, session_id, sms_direction')
    .maybeSingle();

  if (error) {
    safeLog({
      level: 'error',
      category: 'system',
      event: 'db_error',
      error: error?.message || String(error),
      stack: error?.stack,
      query_description: 'Update transcript SMS metadata',
      code: error?.code,
      transcript_id: transcriptId,
    });
  }

  return data;
}

export async function upsertSmsMessage(input: SmsMessageUpsert) {
  try {
    const { data: existing } = await supabase
      .from('sms_messages')
      .select('id, status')
      .eq('twilio_message_sid', input.twilioMessageSid)
      .maybeSingle();

    const status = shouldKeepExistingStatus(existing?.status, input.status)
      ? undefined
      : input.status;

    const payload = compactRecord({
      twilio_message_sid: input.twilioMessageSid,
      session_id: input.sessionId,
      transcript_id: input.transcriptId,
      salon_id: input.salonId,
      channel: input.channel,
      direction: input.direction,
      from_number: input.fromNumber,
      to_number: input.toNumber,
      status,
      price: input.price,
      price_unit: input.priceUnit,
      error_code: input.errorCode,
      error_message: input.errorMessage,
      num_segments: input.numSegments,
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
