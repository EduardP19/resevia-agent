import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { log, safeLog } from '@/lib/logger';
import { normalizeSmsPrice } from '@/lib/sms-pricing';
import {
  formDataToRecord,
  numberOrNull,
  transcriptSmsPayload,
  upsertSmsMessage,
} from '@/lib/sms-messages';

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const rawSmsPayload = formDataToRecord(formData);
  const messageSid = formData.get('MessageSid') as string | null;
  const status = formData.get('MessageStatus') as string | null;
  const errorCode = formData.get('ErrorCode') as string | null;
  const errorMessage = formData.get('ErrorMessage') as string | null;
  const callbackPrice = formData.get('Price') as string | null;
  const callbackPriceUnit = formData.get('PriceUnit') as string | null;
  const callbackNumSegments = formData.get('NumSegments') as string | null;
  const callbackFrom = formData.get('From') as string | null;
  const callbackTo = formData.get('To') as string | null;

  if (!messageSid) {
    return new NextResponse('<Response></Response>', {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    });
  }

  const statusMetadata = {
    twilioMessageSid: messageSid,
    status,
    price: normalizeSmsPrice(callbackPrice),
    priceUnit: callbackPriceUnit,
    numSegments: numberOrNull(callbackNumSegments),
    errorCode,
    errorMessage,
    fromNumber: callbackFrom,
    toNumber: callbackTo,
  };
  const updatePayload = transcriptSmsPayload(statusMetadata);

  const { data: updatedTranscript, error } = await supabase
    .from('transcripts')
    .update(updatePayload)
    .eq('twilio_message_sid', messageSid)
    .select('id, session_id, sms_direction')
    .maybeSingle();

  const ledgerRow = await upsertSmsMessage({
    ...statusMetadata,
    // Only set direction when we can confirm it from the transcript; omitting it
    // lets upsertSmsMessage preserve whatever direction is already in the ledger row.
    ...(updatedTranscript?.sms_direction ? { direction: updatedTranscript.sms_direction as any } : {}),
    sessionId: updatedTranscript?.session_id,
    transcriptId: updatedTranscript?.id,
    rawPayload: rawSmsPayload,
  });

  if (error) {
    safeLog({
      level: 'error',
      category: 'system',
      event: 'db_error',
      error: error?.message || String(error),
      stack: error?.stack,
      query_description: 'Update Twilio SMS status callback',
      code: error?.code,
    });
  } else if (updatedTranscript) {
    await log({
      level: 'info',
      category: 'sms',
      event: 'sms_status_updated',
      session_id: updatedTranscript.session_id,
      twilio_message_sid: messageSid,
      sms_direction: updatedTranscript.sms_direction,
      sms_status: statusMetadata.status,
      sms_price: statusMetadata.price,
      sms_price_unit: statusMetadata.priceUnit,
      sms_num_segments: statusMetadata.numSegments,
    });
  } else {
    await log({
      level: 'warning',
      category: 'sms',
      event: 'sms_status_unmatched',
      twilio_message_sid: messageSid,
      sms_status: statusMetadata.status,
      sms_price: statusMetadata.price,
      sms_price_unit: statusMetadata.priceUnit,
      sms_num_segments: statusMetadata.numSegments,
      sms_message_id: ledgerRow?.id,
    });
  }

  if (status === 'failed' || status === 'undelivered' || errorCode) {
    safeLog({
      level: 'error',
      category: 'sms',
      event: 'sms_failed',
      session_id: updatedTranscript?.session_id,
      twilio_message_sid: messageSid,
      sms_status: status,
      error: errorMessage || errorCode || 'Twilio reported SMS delivery failure',
    });
  }

  return new NextResponse('<Response></Response>', {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  });
}
