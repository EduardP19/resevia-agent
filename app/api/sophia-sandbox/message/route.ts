import { NextRequest, NextResponse } from 'next/server';
import { createTestUiResponse } from '@/lib/sophia-sandbox';
import { logAppError, toErrorLogPayload } from '@/lib/error-logger';
import { safeLog } from '@/lib/logger';

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
    const payload = toErrorLogPayload(error, 'Test UI message error');
    safeLog({
      level: 'error',
      category: 'system',
      event: 'webhook_error',
      error: payload.message,
      stack: payload.stack || undefined,
      source: 'sophia-sandbox-message',
    });
    await logAppError({
      source: 'api.sophia-sandbox.message',
      message: payload.message,
      stack: payload.stack || undefined,
      path: '/api/sophia-sandbox/message',
      method: 'POST',
      runtime: 'server',
    });
    console.error('[Test UI Message Error]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
