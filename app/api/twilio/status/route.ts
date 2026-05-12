import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const messageSid = formData.get('MessageSid') as string | null;

  if (!messageSid) {
    return new NextResponse('<Response></Response>', {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    });
  }

  await supabase
    .from('transcripts')
    .update({
      sms_status: formData.get('MessageStatus') as string | null,
      sms_price: formData.get('Price') as string | null,
      sms_price_unit: formData.get('PriceUnit') as string | null,
      sms_num_segments: formData.get('NumSegments') as string | null,
      sms_error_code: formData.get('ErrorCode') as string | null,
      sms_error_message: formData.get('ErrorMessage') as string | null,
      sms_updated_at: new Date().toISOString(),
    })
    .eq('twilio_message_sid', messageSid);

  return new NextResponse('<Response></Response>', {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  });
}
