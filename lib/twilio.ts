import twilio from 'twilio';

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const fromNumber = process.env.TWILIO_PHONE_NUMBER;

const client = twilio(accountSid, authToken);

export async function sendSMS(to: string, body: string): Promise<void> {
  try {
    // Basic splitting logic for 160 char limit if necessary
    // For MVP, we'll just send it and let Twilio handle concatenation if possible
    await client.messages.create({
      body: body,
      from: fromNumber,
      to: to
    });
    console.log(`[Twilio] SMS sent to ${to}`);
  } catch (error: any) {
    console.error(`[Twilio Error] Failed to send SMS to ${to}:`, error.message);
  }
}
