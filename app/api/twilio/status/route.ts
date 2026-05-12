import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { safeLog } from '@/lib/logger';

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const messageSid = formData.get('MessageSid') as string | null;
  const status = formData.get('MessageStatus') as string | null;
  const errorCode = formData.get('ErrorCode') as string | null;
  const errorMessage = formData.get('ErrorMessage') as string | null;

  if (!messageSid) {
    return new NextResponse('<Response></Response>', {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    });
  }

  const { data: updatedTranscript, error } = await supabase
    .from('transcripts')
    .update({
      sms_status: status,
      sms_price: formData.get('Price') as string | null,
      sms_price_unit: formData.get('PriceUnit') as string | null,
      sms_num_segments: formData.get('NumSegments') as string | null,
      sms_error_code: errorCode,
      sms_error_message: errorMessage,
      sms_updated_at: new Date().toISOString(),
    })
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
