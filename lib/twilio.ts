import twilio from 'twilio';
import { log } from '@/lib/logger';
import { supabase } from '@/lib/supabase';
import { logAppError, toErrorLogPayload } from '@/lib/error-logger';
import { decrypt } from '@/lib/crypto';

const globalAccountSid = process.env.TWILIO_ACCOUNT_SID;
const globalAuthToken = process.env.TWILIO_AUTH_TOKEN;
const fallbackFromNumber = process.env.TWILIO_PHONE_NUMBER || process.env.TWILIO_PHONE;
const fallbackWhatsAppNumber = process.env.TWILIO_WHATSAPP_NUMBER || null;
const whatsAppTemplateSid = process.env.TWILIO_WHATSAPP_TEMPLATE_SID || null;

const globalClient = (globalAccountSid && globalAuthToken) ? twilio(globalAccountSid, globalAuthToken) : null;

export type MessageChannel = 'sms' | 'whatsapp';

type SMSLogContext = {
  tenant_id?: string;
  session_id?: string;
  fromNumber?: string;
};

type BusinessTwilioCredentials = {
  twilio_number?: string | null;
  whatsapp_number?: string | null;
  twilio_account_sid?: string | null;
  twilio_auth_token?: string | null;
};

const WHATSAPP_PREFIX = 'whatsapp:';

/** Ensure a number carries the `whatsapp:` channel prefix Twilio requires. */
export function toWhatsAppAddress(number: string): string {
  const trimmed = (number || '').trim();
  return trimmed.startsWith(WHATSAPP_PREFIX) ? trimmed : `${WHATSAPP_PREFIX}${trimmed}`;
}

/** Strip the `whatsapp:` prefix Twilio adds to inbound From/To values. */
export function stripWhatsAppPrefix(number: string): string {
  const trimmed = (number || '').trim();
  return trimmed.startsWith(WHATSAPP_PREFIX) ? trimmed.slice(WHATSAPP_PREFIX.length) : trimmed;
}

function getClientForCredentials(creds: BusinessTwilioCredentials): ReturnType<typeof twilio> | null {
  if (creds.twilio_account_sid && creds.twilio_auth_token) {
    let authToken: string;
    try {
      authToken = decrypt(creds.twilio_auth_token);
    } catch {
      // Not encrypted (legacy plain value) — use as-is
      authToken = creds.twilio_auth_token;
    }
    return twilio(creds.twilio_account_sid, authToken);
  }
  return null;
}

async function resolveClientAndFromNumber(
  context: SMSLogContext,
  channel: MessageChannel = 'sms'
): Promise<{ client: ReturnType<typeof twilio> | null; fromNumber: string | null }> {
  const fallbackSender = channel === 'whatsapp' ? fallbackWhatsAppNumber : fallbackFromNumber;

  if (context.fromNumber && !context.tenant_id) {
    return { client: globalClient, fromNumber: context.fromNumber };
  }

  if (context.tenant_id) {
    const { data } = await supabase
      .from('business_profiles')
      .select('twilio_number, whatsapp_number, twilio_account_sid, twilio_auth_token')
      .eq('id', context.tenant_id)
      .maybeSingle();

    const perBusinessClient = data ? getClientForCredentials(data) : null;
    const tenantSender = channel === 'whatsapp' ? data?.whatsapp_number : data?.twilio_number;
    const fromNumber = context.fromNumber || tenantSender || fallbackSender || null;
    return { client: perBusinessClient ?? globalClient, fromNumber };
  }

  return { client: globalClient, fromNumber: context.fromNumber || fallbackSender || null };
}

export async function sendSMS(
  to: string,
  body: string,
  statusCallbackUrl?: string,
  context: SMSLogContext = {}
): Promise<any> {
  const { client, fromNumber } = await resolveClientAndFromNumber(context);

  if (!client) {
    throw new Error('[Twilio] Not configured. Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN.');
  }

  if (!fromNumber) {
    throw new Error('[Twilio] Missing sender number. Set business_profiles.twilio_number for tenant or TWILIO_PHONE_NUMBER fallback.');
  }

  try {
    const message = await client.messages.create({
      body: body,
      from: fromNumber,
      to: to,
      ...(statusCallbackUrl ? { statusCallback: statusCallbackUrl } : {})
    });
    console.log(`[Twilio] SMS sent to ${to}: ${message.sid}`);
    await log({
      level: 'info',
      category: 'sms',
      event: 'sms_sent',
      to,
      body,
      tenant_id: context.tenant_id,
      session_id: context.session_id,
      twilio_message_sid: message.sid,
      sms_status: message.status || null,
    });
    return message;
  } catch (error: any) {
    console.error(`[Twilio Error] Failed to send SMS to ${to}:`, error.message);
    await log({
      level: 'error',
      category: 'sms',
      event: 'sms_failed',
      to,
      body,
      tenant_id: context.tenant_id,
      session_id: context.session_id,
      error: error?.message || String(error),
      stack: error?.stack,
      code: error?.code || null,
      status: error?.status || null,
    });
    const payload = toErrorLogPayload(error, 'Twilio SMS send failed');
    await logAppError({
      source: 'lib.twilio.sendSMS',
      message: payload.message,
      level: 'error',
      stack: payload.stack || undefined,
      session_id: context.session_id,
      salon_id: context.tenant_id,
      context: {
        to,
        fromNumber,
        statusCallbackUrl: statusCallbackUrl || null,
        twilio_code: error?.code || null,
        twilio_status: error?.status || null,
      },
      runtime: 'server',
    });
    throw error;
  }
}

/**
 * Send a free-form WhatsApp message. Only valid inside the 24h customer-service
 * window (i.e. after the customer has messaged us). For business-initiated
 * outreach use {@link sendWhatsAppTemplate} instead.
 */
export async function sendWhatsAppMessage(
  to: string,
  body: string,
  statusCallbackUrl?: string,
  context: SMSLogContext = {}
): Promise<any> {
  const { client, fromNumber } = await resolveClientAndFromNumber(context, 'whatsapp');

  if (!client) {
    throw new Error('[Twilio] Not configured. Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN.');
  }
  if (!fromNumber) {
    throw new Error('[Twilio] Missing WhatsApp sender. Set business_profiles.whatsapp_number for tenant or TWILIO_WHATSAPP_NUMBER fallback.');
  }

  try {
    const message = await client.messages.create({
      body,
      from: toWhatsAppAddress(fromNumber),
      to: toWhatsAppAddress(to),
      ...(statusCallbackUrl ? { statusCallback: statusCallbackUrl } : {}),
    });
    await log({
      level: 'info',
      category: 'sms',
      event: 'whatsapp_sent',
      to,
      body,
      tenant_id: context.tenant_id,
      session_id: context.session_id,
      twilio_message_sid: message.sid,
      sms_status: message.status || null,
    });
    return message;
  } catch (error: any) {
    await log({
      level: 'error',
      category: 'sms',
      event: 'whatsapp_failed',
      to,
      body,
      tenant_id: context.tenant_id,
      session_id: context.session_id,
      error: error?.message || String(error),
      stack: error?.stack,
      code: error?.code || null,
    });
    const payload = toErrorLogPayload(error, 'Twilio WhatsApp send failed');
    await logAppError({
      source: 'lib.twilio.sendWhatsAppMessage',
      message: payload.message,
      level: 'error',
      stack: payload.stack || undefined,
      session_id: context.session_id,
      salon_id: context.tenant_id,
      context: { to, fromNumber, twilio_code: error?.code || null, twilio_status: error?.status || null },
      runtime: 'server',
    });
    throw error;
  }
}

/**
 * Send a business-initiated WhatsApp message using a pre-approved Content
 * template. Required for outreach outside the 24h window. `contentSid` falls
 * back to the TWILIO_WHATSAPP_TEMPLATE_SID env var (single-template MVP).
 */
export async function sendWhatsAppTemplate(
  to: string,
  options: { contentSid?: string; contentVariables?: Record<string, string>; statusCallbackUrl?: string } = {},
  context: SMSLogContext = {}
): Promise<any> {
  const contentSid = options.contentSid || whatsAppTemplateSid;
  if (!contentSid) {
    throw new Error('[Twilio] Missing WhatsApp template. Set TWILIO_WHATSAPP_TEMPLATE_SID or pass contentSid.');
  }

  const { client, fromNumber } = await resolveClientAndFromNumber(context, 'whatsapp');
  if (!client) {
    throw new Error('[Twilio] Not configured. Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN.');
  }
  if (!fromNumber) {
    throw new Error('[Twilio] Missing WhatsApp sender. Set business_profiles.whatsapp_number for tenant or TWILIO_WHATSAPP_NUMBER fallback.');
  }

  try {
    const message = await client.messages.create({
      from: toWhatsAppAddress(fromNumber),
      to: toWhatsAppAddress(to),
      contentSid,
      ...(options.contentVariables ? { contentVariables: JSON.stringify(options.contentVariables) } : {}),
      ...(options.statusCallbackUrl ? { statusCallback: options.statusCallbackUrl } : {}),
    });
    await log({
      level: 'info',
      category: 'sms',
      event: 'whatsapp_template_sent',
      to,
      tenant_id: context.tenant_id,
      session_id: context.session_id,
      twilio_message_sid: message.sid,
      sms_status: message.status || null,
      template_sid: contentSid,
    });
    return message;
  } catch (error: any) {
    await log({
      level: 'error',
      category: 'sms',
      event: 'whatsapp_template_failed',
      to,
      tenant_id: context.tenant_id,
      session_id: context.session_id,
      error: error?.message || String(error),
      stack: error?.stack,
      code: error?.code || null,
      template_sid: contentSid,
    });
    const payload = toErrorLogPayload(error, 'Twilio WhatsApp template send failed');
    await logAppError({
      source: 'lib.twilio.sendWhatsAppTemplate',
      message: payload.message,
      level: 'error',
      stack: payload.stack || undefined,
      session_id: context.session_id,
      salon_id: context.tenant_id,
      context: { to, fromNumber, contentSid, twilio_code: error?.code || null, twilio_status: error?.status || null },
      runtime: 'server',
    });
    throw error;
  }
}

/**
 * Channel dispatcher for free-form conversational replies (auto reply,
 * approved draft, manual takeover). Templates are NOT routed here — those go
 * through {@link sendWhatsAppTemplate} at initiation time only.
 */
export async function sendOnChannel(
  channel: MessageChannel,
  to: string,
  body: string,
  statusCallbackUrl?: string,
  context: SMSLogContext = {}
): Promise<any> {
  if (channel === 'whatsapp') {
    return sendWhatsAppMessage(to, body, statusCallbackUrl, context);
  }
  return sendSMS(to, body, statusCallbackUrl, context);
}

export async function getSMSMessage(messageSid: string): Promise<any> {
  if (!globalClient) {
    throw new Error('[Twilio] Not configured. Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN.');
  }

  return globalClient.messages(messageSid).fetch();
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const WHATSAPP_FAILURE_STATUSES = new Set(['failed', 'undelivered']);
// Twilio doesn't call these "confirmed" — but for our purposes, reaching any
// of these means the message actually left Twilio and reached (or was
// accepted by) the WhatsApp network rather than sitting queued or dying.
const WHATSAPP_CONFIRMED_STATUSES = new Set(['sent', 'delivered', 'read']);

/**
 * Poll a just-sent WhatsApp message's status for up to `timeoutMs`, resolving
 * true once it reaches a "confirmed" (sent/delivered/read) status, false if it
 * fails/is undelivered, or false if it's still queued/unresolved at timeout.
 * Used to decide whether to fall back to SMS for time-sensitive outreach.
 */
export async function waitForWhatsAppConfirmation(
  messageSid: string,
  timeoutMs = 30000,
  pollIntervalMs = 2000
): Promise<{ confirmed: boolean; status: string | null }> {
  if (!globalClient) {
    return { confirmed: false, status: null };
  }

  const deadline = Date.now() + timeoutMs;
  let lastStatus: string | null = null;

  while (Date.now() < deadline) {
    try {
      const message = await globalClient.messages(messageSid).fetch();
      lastStatus = message.status || null;
      if (lastStatus && WHATSAPP_CONFIRMED_STATUSES.has(lastStatus)) {
        return { confirmed: true, status: lastStatus };
      }
      if (lastStatus && WHATSAPP_FAILURE_STATUSES.has(lastStatus)) {
        return { confirmed: false, status: lastStatus };
      }
    } catch {
      // Transient fetch error — keep polling until the deadline.
    }
    await wait(pollIntervalMs);
  }

  return { confirmed: false, status: lastStatus };
}

export async function getSMSMessageWithPricing(messageSid: string): Promise<any> {
  const delays = [0, 1000, 2000];
  let message: any = null;

  for (const delay of delays) {
    if (delay > 0) await wait(delay);
    message = await getSMSMessage(messageSid);
    if (message?.price !== null && message?.price !== undefined && message?.price !== '') {
      return message;
    }
  }

  return message;
}
