import { NextRequest, NextResponse } from 'next/server';
import { approveTestUiDraft } from '@/lib/sophia-sandbox';
import { logError, safeLog } from '@/lib/logger';

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
      type: 'audit',
      level: 'info',
      category: 'dashboard',
      event: 'message_approved',
      session_id: sessionId,
      user_id: req.headers.get('x-user-id') || undefined,
      source: 'sophia-sandbox',
    });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    logError('system', 'sandbox_approve_failed', error, {
      source: 'api.sophia-sandbox.approve',
      path: '/api/sophia-sandbox/approve',
      method: 'POST',
      query_description: 'Approve agent sandbox draft',
    });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
