import { NextRequest, NextResponse } from 'next/server';
import twilio from 'twilio';
import { sendSMS, sendWhatsAppTemplate } from '@/lib/twilio';
import { getDefaultSalon, getOrCreateConversation, getSalonBySmsNumber, saveMessage, supabase } from '@/lib/supabase';
import { log, safeLog } from '@/lib/logger';
import { logAppError, toErrorLogPayload } from '@/lib/error-logger';
import { getAgentName } from '@/lib/agent-name';

// Supports {{agent}} / {{salon}} tokens, substituted per-tenant below.
// Override via TWILIO_INBOUND_CALL_SMS_BODY using the same token syntax.
const DEFAULT_INBOUND_CALL_SMS =
  "Hi 👋, I'm {{agent}}, {{salon}}'s virtual assistant.\n\nSorry we've missed you call. What service are you looking to book? ✨";

function renderMissedCallSms(salon: any): string {
  const template = (process.env.TWILIO_INBOUND_CALL_SMS_BODY || DEFAULT_INBOUND_CALL_SMS).trim();
  const salonName = (typeof salon?.name === 'string' && salon.name.trim()) || 'us';
  return template.replaceAll('{{agent}}', getAgentName(salon)).replaceAll('{{salon}}', salonName);
}

/**
 * Missed-call follow-up: try WhatsApp first (business-initiated template,
 * required outside the 24h window), falling back to free-form SMS if WhatsApp
 * is unavailable, unconfigured, or errors. Mirrors the same WA-then-SMS
 * fallback used by the dashboard's manual initiation endpoint.
 */
async function sendMissedCallFollowup(params: {
  salon: any;
  fromNumber: string;
  sessionId: string;
  smsBody: string;
  smsFromNumber?: string;
}): Promise<{ channel: 'whatsapp' | 'sms'; message: any }> {
  const { salon, fromNumber, sessionId, smsBody, smsFromNumber } = params;

  if (salon?.whatsapp_number) {
    try {
      const message = await sendWhatsAppTemplate(
        fromNumber,
        {
          contentSid: salon?.whatsapp_template_sid || undefined,
          contentVariables: { agent: getAgentName(salon) },
        },
        { tenant_id: salon.id, session_id: sessionId }
      );
      return { channel: 'whatsapp', message };
    } catch (waError: any) {
      safeLog({
        level: 'warning',
        category: 'sms',
        event: 'whatsapp_missed_call_fallback',
        tenant_id: salon.id,
        session_id: sessionId,
        error: waError?.message || String(waError),
        code: waError?.code || null,
      });
    }
  }

  const message = await sendSMS(fromNumber, smsBody, undefined, {
    tenant_id: salon.id,
    session_id: sessionId,
    fromNumber: smsFromNumber,
  });
  return { channel: 'sms', message };
}

function buildVoiceTwiML(): string {
  const voiceResponse = new twilio.twiml.VoiceResponse();
  voiceResponse.reject({ reason: 'busy' });
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

  try {
    const formData = await req.formData();
    const callerRaw = ((formData.get('Caller') as string | null) || (formData.get('From') as string | null))?.trim() || null;
    const calledRaw = ((formData.get('Called') as string | null) || (formData.get('To') as string | null))?.trim() || null;
    const callSid = (formData.get('CallSid') as string | null)?.trim() || null;

    console.log(`[voice] parsed form — Caller: ${callerRaw}, Called: ${calledRaw}, CallSid: ${callSid}`);

    const fromNumber = normalizeE164Candidate(callerRaw);
    const toNumber = normalizeE164Candidate(calledRaw);

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
      return new NextResponse(buildVoiceTwiML(), { status: 200, headers: xmlHeaders });
    }

    console.log(`[voice] looking up salon for toNumber: ${toNumber}`);
    const salon = toNumber ? await getSalonBySmsNumber(toNumber) : await getDefaultSalon();

    if (!salon) {
      console.warn(`[voice] ✗ no salon found for toNumber: ${toNumber}`);
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

    console.log(`[voice] salon found — id: ${salon.id}, name: ${(salon as any).name}`);

    const smsBody = renderMissedCallSms(salon);

    console.log(`[voice] getting or creating conversation — salonId: ${salon.id}, from: ${fromNumber}`);
    // Created as 'sms' by default; retagged below once we know which channel
    // actually delivered (WhatsApp template attempt happens first).
    const conversation = await getOrCreateConversation(salon.id, fromNumber);
    console.log(`[voice] conversation ready — id: ${conversation.id}, status: ${conversation.status}`);

    const profileTwilioNumber = normalizeE164Candidate((salon as any)?.twilio_number || null);
    const senderNumber = profileTwilioNumber || toNumber || undefined;

    console.log(`[voice] sender resolution — profile twilio_number: ${profileTwilioNumber}, toNumber: ${toNumber}, using: ${senderNumber}`);

    if (profileTwilioNumber && profileTwilioNumber !== toNumber) {
      console.warn(`[voice] ⚠ twilio number mismatch — profile: ${profileTwilioNumber}, inbound to: ${toNumber}`);
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

    console.log(`[voice] sending missed-call follow-up (WhatsApp-first) — to: ${fromNumber}`);
    const { channel: deliveredChannel } = await sendMissedCallFollowup({
      salon,
      fromNumber,
      sessionId: conversation.id,
      smsBody,
      smsFromNumber: senderNumber,
    });
    console.log(`[voice] ✓ follow-up sent via ${deliveredChannel}`);

    if (deliveredChannel !== conversation.channel) {
      await supabase.from('sessions').update({ channel: deliveredChannel }).eq('id', conversation.id);
    }

    await saveMessage(
      conversation.id,
      'system',
      `[Voice webhook] Missed call from ${fromNumber}. Auto follow-up sent via ${deliveredChannel}.`
    );
    console.log(`[voice] ✓ system message saved`);

    await log({
      level: 'info',
      category: 'sms',
      event: 'voice_call_auto_followup_sent',
      tenant_id: salon.id,
      session_id: conversation.id,
      from: fromNumber,
      to: toNumber,
      call_sid: callSid,
      channel: deliveredChannel,
      body: smsBody,
    });

    console.log(`[voice] ✓ complete`);
    return new NextResponse(buildVoiceTwiML(), { status: 200, headers: xmlHeaders });
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
