import { NextRequest, NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import twilio from 'twilio';
import { sendSMS, sendWhatsAppTemplate, waitForWhatsAppConfirmation } from '@/lib/twilio';
import { getDefaultSalon, getOrCreateConversation, getSalonBySmsNumber, saveMessage, supabase } from '@/lib/supabase';
import { log, logError, safeLog, setRequestContext, withRequestContext } from '@/lib/logger';

import { getAgentName } from '@/lib/agent-name';
import { smsMetadataFromTwilioMessage, upsertSmsMessage } from '@/lib/sms-messages';

// Covers the up-to-30s WhatsApp delivery-confirmation poll in the background
// follow-up (kicked off via waitUntil after the TwiML response is sent),
// plus headroom for the salon/conversation lookups and SMS fallback.
export const maxDuration = 45;

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
 * required outside the 24h window). After sending, poll Twilio for up to 30s
 * waiting for the message to reach a confirmed (sent/delivered/read) status —
 * a 200 from the initial API call only means Twilio accepted the request, not
 * that it was delivered. If it fails, is undelivered, or doesn't confirm
 * within 30s, fall back to free-form SMS with the same message. Mirrors the
 * same WA-then-SMS fallback used by the dashboard's manual initiation
 * endpoint (which does not wait for delivery confirmation).
 */
async function sendMissedCallFollowup(params: {
  salon: any;
  fromNumber: string;
  sessionId: string;
  smsBody: string;
  smsFromNumber?: string;
  statusCallbackUrl?: string;
}): Promise<{ channel: 'whatsapp' | 'sms'; message: any; messageType: 'whatsapp_template' | 'missed_call_followup' }> {
  const { salon, fromNumber, sessionId, smsBody, smsFromNumber, statusCallbackUrl } = params;

  if (salon?.whatsapp_number) {
    try {
      const message = await sendWhatsAppTemplate(
        fromNumber,
        {
          contentSid: salon?.whatsapp_template_sid || undefined,
          contentVariables: { '1': getAgentName(salon) },
          statusCallbackUrl,
        },
        { tenant_id: salon.id, session_id: sessionId }
      );

      const { confirmed, status } = await waitForWhatsAppConfirmation(message.sid, 30000);
      if (confirmed) {
        return { channel: 'whatsapp', message, messageType: 'whatsapp_template' };
      }

      safeLog({
        type: 'integration',
        level: 'warning',
        category: 'sms',
        event: 'whatsapp_missed_call_unconfirmed',
        tenant_id: salon.id,
        session_id: sessionId,
        twilio_message_sid: message.sid,
        sms_status: status,
      });
    } catch (waError: any) {
      safeLog({
        type: 'integration',
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

  const message = await sendSMS(fromNumber, smsBody, statusCallbackUrl, {
    tenant_id: salon.id,
    session_id: sessionId,
    fromNumber: smsFromNumber,
  });
  return { channel: 'sms', message, messageType: 'missed_call_followup' };
}

function buildVoiceTwiML(): string {
  const voiceResponse = new twilio.twiml.VoiceResponse();
  voiceResponse.reject({ reason: 'rejected' });
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

/**
 * Runs after the <Reject> TwiML has already been sent back to Twilio, so the
 * caller isn't kept ringing/on-hold while we look up the salon, create the
 * conversation, and send the (potentially 30s-polling) WhatsApp/SMS follow-up.
 */
async function processMissedCall(params: {
  callerRaw: string | null;
  calledRaw: string | null;
  callSid: string | null;
  fromNumber: string;
  toNumber: string | null;
  statusCallbackUrl: string;
}) {
  const { callerRaw, calledRaw, callSid, fromNumber, toNumber, statusCallbackUrl } = params;

  console.log(`[voice] looking up salon for toNumber: ${toNumber}`);
  const salon = toNumber ? await getSalonBySmsNumber(toNumber) : await getDefaultSalon();

  if (!salon) {
    console.warn(`[voice] ✗ no salon found for toNumber: ${toNumber}`);
    await log({
      type: 'error',
      level: 'error',
      category: 'sms',
      event: 'voice_webhook_missing_salon',
      from: callerRaw,
      to: calledRaw,
      call_sid: callSid,
    });
    return;
  }

  console.log(`[voice] salon found — id: ${salon.id}, name: ${(salon as any).name}`);

  const smsBody = renderMissedCallSms(salon);

  console.log(`[voice] getting or creating conversation — salonId: ${salon.id}, from: ${fromNumber}`);
  // Created as 'sms' by default; retagged below once we know which channel
  // actually delivered (WhatsApp template attempt happens first).
  const conversation = await getOrCreateConversation(salon.id, fromNumber);
  console.log(`[voice] conversation ready — id: ${conversation.id}, status: ${conversation.status}`);

  // Tag the rest of the background follow-up (WhatsApp template, delivery
  // poll, SMS fallback) with the tenant and session.
  setRequestContext({ tenant_id: salon.id, session_id: conversation.id });

  const profileTwilioNumber = normalizeE164Candidate((salon as any)?.twilio_number || null);
  const senderNumber = profileTwilioNumber || toNumber || undefined;

  console.log(`[voice] sender resolution — profile twilio_number: ${profileTwilioNumber}, toNumber: ${toNumber}, using: ${senderNumber}`);

  if (profileTwilioNumber && profileTwilioNumber !== toNumber) {
    console.warn(`[voice] ⚠ twilio number mismatch — profile: ${profileTwilioNumber}, inbound to: ${toNumber}`);
    await log({
      type: 'integration',
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
  const { channel: deliveredChannel, message: outboundMessage, messageType } = await sendMissedCallFollowup({
    salon,
    fromNumber,
    sessionId: conversation.id,
    smsBody,
    smsFromNumber: senderNumber,
    statusCallbackUrl,
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

  // Human-readable transcript row + sms_messages ledger entry, so this send
  // shows up in spend/pricing tracking like every other outbound message
  // (auto-reply, initiation) — this path previously recorded neither.
  const assistantMessage = await saveMessage(
    conversation.id,
    'assistant',
    deliveredChannel === 'whatsapp' ? '[WhatsApp template sent]' : smsBody
  );
  const outboundMetadata = {
    twilioMessageSid: outboundMessage.sid,
    direction: 'outbound' as const,
    ...smsMetadataFromTwilioMessage(outboundMessage),
  };
  await upsertSmsMessage({
    ...outboundMetadata,
    channel: deliveredChannel,
    messageType,
    sessionId: conversation.id,
    transcriptId: assistantMessage?.id ?? null,
    salonId: salon.id,
    rawPayload: outboundMessage,
  });
  console.log(`[voice] ✓ sms_messages ledger row recorded (type: ${messageType})`);

  await log({
    type: 'integration',
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
}

export async function POST(req: NextRequest) {
  const xmlHeaders = { 'Content-Type': 'text/xml' };

  console.log('[voice] ▶ webhook received');

  // Correlates the TwiML response with the background follow-up work, which
  // finishes long after this handler returns.
  return withRequestContext({ path: '/api/twilio/voice' }, async () => {
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
        type: 'integration',
        level: 'warning',
        category: 'sms',
        event: 'voice_webhook_invalid_caller',
        from: callerRaw,
        to: calledRaw,
        call_sid: callSid,
      });
      return new NextResponse(buildVoiceTwiML(), { status: 200, headers: xmlHeaders });
    }

    const statusCallbackUrl =
      process.env.TWILIO_STATUS_CALLBACK_URL || new URL('/api/twilio/status', req.url).toString();

    // Reject immediately — everything else (salon lookup, conversation,
    // WhatsApp/SMS follow-up) runs in the background via waitUntil(), so the
    // caller isn't kept ringing while we do DB/API work (including the
    // up-to-30s WhatsApp delivery confirmation poll), but the serverless
    // invocation is kept alive until the background work actually finishes.
    waitUntil(
      processMissedCall({ callerRaw, calledRaw, callSid, fromNumber, toNumber, statusCallbackUrl }).catch((error: any) => {
        logError('sms', 'voice_background_processing_failed', error, {
          source: 'api.twilio.voice',
          path: '/api/twilio/voice',
          method: 'POST',
          call_sid: callSid,
        });
      })
    );

    return new NextResponse(buildVoiceTwiML(), { status: 200, headers: xmlHeaders });
  } catch (error: any) {
    logError('sms', 'voice_webhook_error', error, {
      source: 'api.twilio.voice',
      path: '/api/twilio/voice',
      method: 'POST',
    });
    return new NextResponse(buildVoiceTwiML(), { status: 200, headers: xmlHeaders });
  }
  });
}
