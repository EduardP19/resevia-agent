import twilio from 'twilio';

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const fromNumber = process.env.TWILIO_PHONE_NUMBER || process.env.TWILIO_PHONE;

const client = (accountSid && authToken) ? twilio(accountSid, authToken) : null;

export async function sendSMS(to: string, body: string, statusCallbackUrl?: string): Promise<any> {
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
    return message;
  } catch (error: any) {
    console.error(`[Twilio Error] Failed to send SMS to ${to}:`, error.message);
    throw error;
  }
}
