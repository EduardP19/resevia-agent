import twilio from 'twilio';
import { safeLog } from '@/lib/logger';

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const fromNumber = process.env.TWILIO_PHONE_NUMBER || process.env.TWILIO_PHONE;

const client = (accountSid && authToken) ? twilio(accountSid, authToken) : null;

type SMSLogContext = {
  tenant_id?: string;
  session_id?: string;
};

export async function sendSMS(
  to: string,
  body: string,
  statusCallbackUrl?: string,
  context: SMSLogContext = {}
): Promise<any> {
  if (!client) {
    throw new Error('[Twilio] Not configured. Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN.');
  }
  if (!fromNumber) {
    throw new Error('[Twilio] Missing TWILIO_PHONE_NUMBER (or TWILIO_PHONE). Cannot send SMS.');
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
