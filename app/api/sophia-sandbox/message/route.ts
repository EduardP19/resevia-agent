import { NextRequest, NextResponse } from 'next/server';
import { createTestUiResponse } from '@/lib/sophia-sandbox';
import { logError } from '@/lib/logger';

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json();
    const message =
      typeof payload?.message === 'string' ? payload.message.trim() : '';
    const sessionId =
      typeof payload?.id === 'string' && payload.id.length > 0 ? payload.id : undefined;
    const t =
      typeof payload?.t === 'string' && payload.t.trim().length > 0
        ? payload.t.trim()
        : undefined;
    const manualApproval = payload?.manualApproval !== false;

    if (!message) {
      return NextResponse.json({ error: 'message is required' }, { status: 400 });
    }

    const result = await createTestUiResponse({
      message,
      sessionId,
      manualApproval,
      t,
    });

    return NextResponse.json(result);
  } catch (error: any) {
    logError('system', 'sandbox_message_failed', error, {
      source: 'api.sophia-sandbox.message',
      path: '/api/sophia-sandbox/message',
      method: 'POST',
    });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
