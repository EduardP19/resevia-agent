import { NextRequest, NextResponse } from 'next/server';
import { log, safeLog } from '@/lib/logger';
import { normalizeSmsPrice } from '@/lib/sms-pricing';
import {
  findSmsMessageBySid,
  formDataToRecord,
  numberOrNull,
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
  // sms_messages is the source of truth for this SID — it already carries the
  // session/transcript linkage and direction, so no transcript lookup is needed.
  const existingLedgerRow = await findSmsMessageBySid(messageSid);

  const ledgerRow = await upsertSmsMessage({
    ...statusMetadata,
    // Omitting direction lets upsertSmsMessage preserve whatever is already on
    // the ledger row rather than overwriting it with a guess.
    ...(existingLedgerRow?.direction ? { direction: existingLedgerRow.direction as any } : {}),
    sessionId: existingLedgerRow?.session_id,
    transcriptId: existingLedgerRow?.transcript_id,
    rawPayload: rawSmsPayload,
  });

  if (existingLedgerRow) {
    await log({
      level: 'info',
      category: 'sms',
      event: 'sms_status_updated',
      session_id: existingLedgerRow.session_id,
      twilio_message_sid: messageSid,
      sms_direction: existingLedgerRow.direction,
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
      session_id: existingLedgerRow?.session_id,
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
