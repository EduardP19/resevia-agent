import { NextRequest, NextResponse } from 'next/server';
import { handleInboundMessage } from '@/lib/inbound-handler';
import { logAppError, toErrorLogPayload } from '@/lib/error-logger';
import { safeLog } from '@/lib/logger';

// Twilio WhatsApp inbound webhook. Register this URL on the WhatsApp sender in
// the Twilio console. Payload shape matches the SMS webhook; the shared handler
// strips the `whatsapp:` address prefix and routes the conversation on WA.
export async function POST(req: NextRequest) {
  try {
    return await handleInboundMessage(req, 'whatsapp');
  } catch (error: any) {
    const payload = toErrorLogPayload(error, 'WhatsApp webhook error');
    safeLog({
      level: 'error',
      category: 'system',
      event: 'webhook_error',
      error: payload.message,
      stack: payload.stack || undefined,
    });
    await logAppError({
      source: 'api.whatsapp-webhook',
      message: payload.message,
      stack: payload.stack || undefined,
      path: '/api/whatsapp-webhook',
      method: 'POST',
      runtime: 'server',
    });
    return new NextResponse('<Response></Response>', { status: 200, headers: { 'Content-Type': 'text/xml' } });
  }
}
