import { NextRequest, NextResponse } from 'next/server';
import { handleInboundMessage } from '@/lib/inbound-handler';
import { logError, withRequestContext } from '@/lib/logger';

// Twilio WhatsApp inbound webhook. Register this URL on the WhatsApp sender in
// the Twilio console. Payload shape matches the SMS webhook; the shared handler
// strips the `whatsapp:` address prefix and routes the conversation on WA.
export async function POST(req: NextRequest) {
  return withRequestContext({ path: '/api/whatsapp-webhook' }, async () => {
    try {
      return await handleInboundMessage(req, 'whatsapp');
    } catch (error: any) {
      logError('sms', 'webhook_error', error, {
        source: 'api.whatsapp-webhook',
        path: '/api/whatsapp-webhook',
        method: 'POST',
        channel: 'whatsapp',
      });
      return new NextResponse('<Response></Response>', {
        status: 200,
        headers: { 'Content-Type': 'text/xml' },
      });
    }
  });
}
