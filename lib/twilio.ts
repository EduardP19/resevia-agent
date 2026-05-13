import twilio from 'twilio';
import { safeLog } from '@/lib/logger';
import { supabase } from '@/lib/supabase';

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const fallbackFromNumber = process.env.TWILIO_PHONE_NUMBER || process.env.TWILIO_PHONE;

const client = (accountSid && authToken) ? twilio(accountSid, authToken) : null;

type SMSLogContext = {
  tenant_id?: string;
  session_id?: string;
  fromNumber?: string;
};

async function resolveFromNumber(context: SMSLogContext): Promise<string | null> {
  if (context.fromNumber) {
    return context.fromNumber;
  }

  if (context.tenant_id) {
    const { data } = await supabase
      .from('business_profiles')
      .select('twilio_number')
      .eq('id', context.tenant_id)
      .maybeSingle();

    if (data?.twilio_number) {
      return data.twilio_number;
    }
  }

  return fallbackFromNumber || null;
}

export async function sendSMS(
  to: string,
  body: string,
  statusCallbackUrl?: string,
  context: SMSLogContext = {}
): Promise<any> {
  if (!client) {
    throw new Error('[Twilio] Not configured. Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN.');
  }

  const fromNumber = await resolveFromNumber(context);
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
    safeLog({
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
    safeLog({
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
    throw error;
  }
}

export async function getSMSMessage(messageSid: string): Promise<any> {
  if (!client) {
    throw new Error('[Twilio] Not configured. Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN.');
  }

  return client.messages(messageSid).fetch();
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
