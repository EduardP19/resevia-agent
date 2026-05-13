import { NextRequest, NextResponse } from 'next/server';
import twilio from 'twilio';
import { sendSMS } from '@/lib/twilio';
import { getSalonBySmsNumber } from '@/lib/supabase';
import { safeLog } from '@/lib/logger';

const DEFAULT_INBOUND_CALL_SMS = "Hi, sorry we can't pickup. Looking for a new appointment?";

function buildVoiceTwiML(): string {
  const voiceResponse = new twilio.twiml.VoiceResponse();
  voiceResponse.hangup();
  return voiceResponse.toString();
}

export async function POST(req: NextRequest) {
  const xmlHeaders = { 'Content-Type': 'text/xml' };

  try {
    const formData = await req.formData();
    const fromNumber = (formData.get('From') as string | null)?.trim() || null;
    const toNumber = (formData.get('To') as string | null)?.trim() || null;
    const callSid = (formData.get('CallSid') as string | null)?.trim() || null;
    const smsBody = (process.env.TWILIO_INBOUND_CALL_SMS_BODY || DEFAULT_INBOUND_CALL_SMS).trim();

    if (!fromNumber || !toNumber) {
      safeLog({
        level: 'warning',
        category: 'sms',
        event: 'voice_webhook_missing_numbers',
        from: fromNumber,
        to: toNumber,
        call_sid: callSid,
      });
      return new NextResponse(buildVoiceTwiML(), { status: 200, headers: xmlHeaders });
    }

    const salon = await getSalonBySmsNumber(toNumber);

    await sendSMS(fromNumber, smsBody, undefined, {
      tenant_id: salon?.id,
      fromNumber: toNumber,
    });

    safeLog({
      level: 'info',
      category: 'sms',
      event: 'voice_call_auto_sms_sent',
      tenant_id: salon?.id,
      from: fromNumber,
      to: toNumber,
      call_sid: callSid,
      body: smsBody,
    });

    return new NextResponse(buildVoiceTwiML(), { status: 200, headers: xmlHeaders });
  } catch (error: any) {
    safeLog({
      level: 'error',
      category: 'sms',
      event: 'voice_webhook_error',
      error: error?.message || String(error),
      stack: error?.stack,
    });
    return new NextResponse(buildVoiceTwiML(), { status: 200, headers: xmlHeaders });
  }
}
