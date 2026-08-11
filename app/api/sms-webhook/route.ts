import { NextRequest, NextResponse } from 'next/server';
import { handleInboundMessage } from '@/lib/inbound-handler';
import { logError, withRequestContext } from '@/lib/logger';

export async function POST(req: NextRequest) {
  // Every log emitted while handling this message shares one request_id, so the
  // whole turn (received → ai → tool → sent) can be pulled back in order.
  return withRequestContext({ path: '/api/sms-webhook' }, async () => {
    try {
      return await handleInboundMessage(req, 'sms');
    } catch (error: any) {
      logError('sms', 'webhook_error', error, {
        source: 'api.sms-webhook',
        path: '/api/sms-webhook',
        method: 'POST',
      });
      return new NextResponse('<Response></Response>', {
        status: 200,
        headers: { 'Content-Type': 'text/xml' },
      });
    }
  });
}
