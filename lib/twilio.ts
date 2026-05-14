import twilio from 'twilio';
import { log } from '@/lib/logger';
import { supabase } from '@/lib/supabase';
import { logAppError, toErrorLogPayload } from '@/lib/error-logger';
import { decrypt } from '@/lib/crypto';

const globalAccountSid = process.env.TWILIO_ACCOUNT_SID;
const globalAuthToken = process.env.TWILIO_AUTH_TOKEN;
const fallbackFromNumber = process.env.TWILIO_PHONE_NUMBER || process.env.TWILIO_PHONE;

const globalClient = (globalAccountSid && globalAuthToken) ? twilio(globalAccountSid, globalAuthToken) : null;

type SMSLogContext = {
  tenant_id?: string;
  session_id?: string;
  fromNumber?: string;
};

type BusinessTwilioCredentials = {
  twilio_number?: string | null;
  twilio_account_sid?: string | null;
  twilio_auth_token?: string | null;
};

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
  context: SMSLogContext
): Promise<{ client: ReturnType<typeof twilio> | null; fromNumber: string | null }> {
  if (context.fromNumber && !context.tenant_id) {
    return { client: globalClient, fromNumber: context.fromNumber };
  }

  if (context.tenant_id) {
    const { data } = await supabase
      .from('business_profiles')
      .select('twilio_number, twilio_account_sid, twilio_auth_token')
      .eq('id', context.tenant_id)
      .maybeSingle();

    const perBusinessClient = data ? getClientForCredentials(data) : null;
    const fromNumber = context.fromNumber || data?.twilio_number || fallbackFromNumber || null;
    return { client: perBusinessClient ?? globalClient, fromNumber };
  }

  return { client: globalClient, fromNumber: context.fromNumber || fallbackFromNumber || null };
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

export async function getSMSMessage(messageSid: string): Promise<any> {
  if (!globalClient) {
    throw new Error('[Twilio] Not configured. Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN.');
  }

  return globalClient.messages(messageSid).fetch();
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
