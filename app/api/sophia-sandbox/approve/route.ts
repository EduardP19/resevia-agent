import { NextRequest, NextResponse } from 'next/server';
import { approveTestUiDraft } from '@/lib/sophia-sandbox';
import { logAppError, toErrorLogPayload } from '@/lib/error-logger';
import { safeLog } from '@/lib/logger';

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json();
    const sessionId =
      typeof payload?.sessionId === 'string' ? payload.sessionId.trim() : '';
    const content =
      typeof payload?.content === 'string' ? payload.content.trim() : '';
    const t =
      typeof payload?.t === 'string' && payload.t.trim().length > 0
        ? payload.t.trim()
        : undefined;

    if (!sessionId || !content) {
      return NextResponse.json(
        { error: 'sessionId and content are required' },
        { status: 400 }
      );
    }

    await approveTestUiDraft(sessionId, content, t);
    safeLog({
      level: 'info',
      category: 'dashboard',
      event: 'message_approved',
      session_id: sessionId,
      user_id: req.headers.get('x-user-id') || undefined,
      source: 'sophia-sandbox',
    });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    const payload = toErrorLogPayload(error, 'Test UI approve error');
    safeLog({
      level: 'error',
      category: 'system',
      event: 'db_error',
      error: payload.message,
      stack: payload.stack || undefined,
      query_description: 'Approve agent sandbox draft',
    });
    await logAppError({
      source: 'api.sophia-sandbox.approve',
      message: payload.message,
      stack: payload.stack || undefined,
      path: '/api/sophia-sandbox/approve',
      method: 'POST',
      runtime: 'server',
    });
    console.error('[Test UI Approve Error]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
