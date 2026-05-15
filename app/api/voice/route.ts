import { NextRequest, NextResponse } from 'next/server';
import twilio from 'twilio';
import { sendSMS } from '@/lib/twilio';
import { getSalonById, getDefaultSalon, getOrCreateConversation, getSalonBySmsNumber, saveMessage } from '@/lib/supabase';
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

  console.log('[voice] ▶ webhook received');

  void handleVoiceWebhook(req).catch((error: any) => {
    console.error(`[voice] ✗ uncaught async error — ${error?.message}`, error?.stack);
  });

  return new NextResponse(buildVoiceTwiML(), { status: 200, headers: xmlHeaders });
}

async function handleVoiceWebhook(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const businessId = searchParams.get('businessId');

    const formData = await req.formData();
    const callerRaw = ((formData.get('Caller') as string | null) || (formData.get('From') as string | null))?.trim() || null;
    const calledRaw = ((formData.get('Called') as string | null) || (formData.get('To') as string | null))?.trim() || null;
    const callSid = (formData.get('CallSid') as string | null)?.trim() || null;

    console.log(`[voice] parsed form — Caller: ${callerRaw}, Called: ${calledRaw}, CallSid: ${callSid}, businessId: ${businessId}`);

    const fromNumber = normalizeE164Candidate(callerRaw);
    const toNumber = normalizeE164Candidate(calledRaw);
    const smsBody = (process.env.TWILIO_INBOUND_CALL_SMS_BODY || DEFAULT_INBOUND_CALL_SMS).trim();

    console.log(`[voice] normalized — from: ${fromNumber}, to: ${toNumber}`);

    if (!fromNumber) {
      console.warn(`[voice] ✗ invalid caller number — raw: ${callerRaw}`);
      await log({
        level: 'warning',
        category: 'sms',
        event: 'voice_webhook_invalid_caller',
        from: callerRaw,
        to: calledRaw,
        call_sid: callSid,
      });
      return;
    }

    // Resolve salon: prefer explicit businessId param, then fall back to number lookup
    let salon: any = null;
    if (businessId) {
      salon = await getSalonById(businessId);
      if (!salon) {
        console.warn(`[voice] ✗ no salon found for businessId: ${businessId}`);
      }
    }
    if (!salon) {
      salon = toNumber ? await getSalonBySmsNumber(toNumber) : await getDefaultSalon();
    }

    if (!salon) {
      console.warn(`[voice] ✗ no salon found — businessId: ${businessId}, toNumber: ${toNumber}`);
      await log({
        level: 'error',
        category: 'sms',
        event: 'voice_webhook_missing_salon',
        from: callerRaw,
        to: calledRaw,
        call_sid: callSid,
        business_id: businessId,
      });
      return;
    }

    console.log(`[voice] salon found — id: ${salon.id}, name: ${salon.name}`);

    const conversation = await getOrCreateConversation(salon.id, fromNumber);
    console.log(`[voice] conversation ready — id: ${conversation.id}, status: ${conversation.status}`);

    const profileTwilioNumber = normalizeE164Candidate(salon.twilio_number || null);
    const senderNumber = profileTwilioNumber || toNumber || undefined;

    console.log(`[voice] sender resolution — profile twilio_number: ${profileTwilioNumber}, toNumber: ${toNumber}, using: ${senderNumber}`);

    if (profileTwilioNumber && profileTwilioNumber !== toNumber) {
      console.warn(`[voice] ⚠ twilio number mismatch — profile: ${profileTwilioNumber}, inbound to: ${toNumber}`);
      await log({
        level: 'warning',
        category: 'sms',
        event: 'voice_webhook_to_number_mismatch',
        tenant_id: salon.id,
        session_id: conversation.id,
        inbound_to: toNumber,
        profile_twilio_number: profileTwilioNumber,
        call_sid: callSid,
      });
    }

    console.log(`[voice] sending SMS — to: ${fromNumber}, from: ${senderNumber}, body: "${smsBody}"`);
    await sendSMS(fromNumber, smsBody, undefined, {
      tenant_id: salon.id,
      session_id: conversation.id,
      fromNumber: senderNumber,
    });
    console.log(`[voice] ✓ SMS sent`);

    await saveMessage(conversation.id, 'system', `[Voice webhook] Missed call from ${fromNumber}. Auto-SMS sent.`);
    console.log(`[voice] ✓ system message saved`);

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
      business_id: businessId,
    });

    console.log(`[voice] ✓ complete`);
  } catch (error: any) {
    console.error(`[voice] ✗ uncaught error — ${error?.message}`, error?.stack);
    const payload = toErrorLogPayload(error, 'Twilio voice webhook error');
    await log({
      level: 'error',
      category: 'sms',
      event: 'voice_webhook_error',
      error: payload.message,
      stack: payload.stack,
    });
    await logAppError({
      source: 'api.voice',
      message: payload.message,
      level: 'error',
      stack: payload.stack || undefined,
      context: {
        path: '/api/voice',
      },
      path: '/api/voice',
      method: 'POST',
      runtime: 'server',
    });
  }
}
