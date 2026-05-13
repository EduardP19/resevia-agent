import { NextRequest, NextResponse } from 'next/server';
import twilio from 'twilio';
import { sendSMS } from '@/lib/twilio';
import { getDefaultSalon, getOrCreateConversation, getSalonBySmsNumber, saveMessage } from '@/lib/supabase';
import { log } from '@/lib/logger';
import { logAppError, toErrorLogPayload } from '@/lib/error-logger';

const DEFAULT_INBOUND_CALL_SMS = "Hi, sorry we can't pickup. Looking for a new appointment?";

function buildVoiceTwiML(): string {
  const voiceResponse = new twilio.twiml.VoiceResponse();
  voiceResponse.hangup();
  return voiceResponse.toString();
}

function normalizeE164Candidate(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const plusIndex = trimmed.indexOf('+');
  if (plusIndex === -1) return null;
  const normalized = `+${trimmed.slice(plusIndex + 1).replace(/\D/g, '')}`;
  if (normalized.length < 8) return null;
  return normalized;
}

export async function POST(req: NextRequest) {
  const xmlHeaders = { 'Content-Type': 'text/xml' };

  try {
    const formData = await req.formData();
    const callerRaw = ((formData.get('Caller') as string | null) || (formData.get('From') as string | null))?.trim() || null;
    const calledRaw = ((formData.get('Called') as string | null) || (formData.get('To') as string | null))?.trim() || null;
    const fromNumber = normalizeE164Candidate(callerRaw);
    const toNumber = normalizeE164Candidate(calledRaw);
    const callSid = (formData.get('CallSid') as string | null)?.trim() || null;
    const smsBody = (process.env.TWILIO_INBOUND_CALL_SMS_BODY || DEFAULT_INBOUND_CALL_SMS).trim();

    if (!fromNumber) {
      await log({
        level: 'warning',
        category: 'sms',
        event: 'voice_webhook_invalid_caller',
        from: callerRaw,
        to: calledRaw,
        call_sid: callSid,
      });
      return new NextResponse(buildVoiceTwiML(), { status: 200, headers: xmlHeaders });
    }

    const salon = toNumber ? await getSalonBySmsNumber(toNumber) : await getDefaultSalon();
    if (!salon) {
      await log({
        level: 'error',
        category: 'sms',
        event: 'voice_webhook_missing_salon',
        from: callerRaw,
        to: calledRaw,
        call_sid: callSid,
      });
      return new NextResponse(buildVoiceTwiML(), { status: 200, headers: xmlHeaders });
    }

    const conversation = await getOrCreateConversation(salon.id, fromNumber);
    const profileTwilioNumber = normalizeE164Candidate((salon as any)?.twilio_number || null);
    const senderNumber = profileTwilioNumber || toNumber || undefined;

    if (profileTwilioNumber && profileTwilioNumber !== toNumber) {
      await log({
        level: 'warning',
        category: 'sms',
        event: 'voice_webhook_to_number_mismatch',
        tenant_id: salon?.id,
        session_id: conversation?.id,
        inbound_to: toNumber,
        profile_twilio_number: profileTwilioNumber,
        call_sid: callSid,
      });
    }

    await sendSMS(fromNumber, smsBody, undefined, {
      tenant_id: salon.id,
      session_id: conversation.id,
      fromNumber: senderNumber,
    });

    await saveMessage(conversation.id, 'system', `[Voice webhook] Missed call from ${fromNumber}. Auto-SMS sent.`);

    await log({
      level: 'info',
      category: 'sms',
      event: 'voice_call_auto_sms_sent',
      tenant_id: salon.id,
      session_id: conversation.id,
      from: fromNumber,
      to: toNumber,
      call_sid: callSid,
      body: smsBody,
    });

    return new NextResponse(buildVoiceTwiML(), { status: 200, headers: xmlHeaders });
  } catch (error: any) {
    const payload = toErrorLogPayload(error, 'Twilio voice webhook error');
    await log({
      level: 'error',
      category: 'sms',
      event: 'voice_webhook_error',
      error: payload.message,
      stack: payload.stack,
    });
    await logAppError({
      source: 'api.twilio.voice',
      message: payload.message,
      level: 'error',
      stack: payload.stack || undefined,
      context: {
        path: '/api/twilio/voice',
      },
      path: '/api/twilio/voice',
      method: 'POST',
      runtime: 'server',
    });
    return new NextResponse(buildVoiceTwiML(), { status: 200, headers: xmlHeaders });
  }
}
