import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { safeLog } from '@/lib/logger';
import { getSMSMessage } from '@/lib/twilio';

export async function POST(req: NextRequest) {
  const formData = await req.formData();
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

  let twilioMessage: any = null;
  if (!callbackPrice || !callbackPriceUnit || !callbackNumSegments) {
    try {
      twilioMessage = await getSMSMessage(messageSid);
    } catch (error: any) {
      safeLog({
        level: 'warning',
        category: 'sms',
        event: 'sms_price_lookup_failed',
        twilio_message_sid: messageSid,
        error: error?.message || String(error),
        stack: error?.stack,
      });
    }
  }

  const resolvedStatus = status || twilioMessage?.status || null;
  const resolvedErrorCode = errorCode || twilioMessage?.errorCode || null;
  const resolvedErrorMessage = errorMessage || twilioMessage?.errorMessage || null;
  const updatePayload: Record<string, any> = {
    sms_status: resolvedStatus,
    sms_price: callbackPrice || twilioMessage?.price || null,
    sms_price_unit: callbackPriceUnit || twilioMessage?.priceUnit || null,
    sms_num_segments: callbackNumSegments || twilioMessage?.numSegments || null,
    sms_error_code: resolvedErrorCode,
    sms_error_message: resolvedErrorMessage,
    sms_updated_at: new Date().toISOString(),
  };
  const resolvedFrom = callbackFrom || twilioMessage?.from || null;
  const resolvedTo = callbackTo || twilioMessage?.to || null;
  if (resolvedFrom) updatePayload.sms_from_number = resolvedFrom;
  if (resolvedTo) updatePayload.sms_to_number = resolvedTo;

  const { data: updatedTranscript, error } = await supabase
    .from('transcripts')
    .update(updatePayload)
    .eq('twilio_message_sid', messageSid)
    .select('session_id')
    .maybeSingle();

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
  }

  if (resolvedStatus === 'failed' || resolvedStatus === 'undelivered' || resolvedErrorCode) {
    safeLog({
      level: 'error',
      category: 'sms',
      event: 'sms_failed',
      session_id: updatedTranscript?.session_id,
      twilio_message_sid: messageSid,
      sms_status: resolvedStatus,
      error: resolvedErrorMessage || resolvedErrorCode || 'Twilio reported SMS delivery failure',
    });
  }

  return new NextResponse('<Response></Response>', {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  });
}
