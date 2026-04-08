import { NextRequest, NextResponse } from 'next/server';
import { approveTestUiDraft } from '@/lib/sophia-sandbox';

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json();
    const sessionId =
      typeof payload?.sessionId === 'string' ? payload.sessionId.trim() : '';
    const content =
      typeof payload?.content === 'string' ? payload.content.trim() : '';
    const p =
      typeof payload?.p === 'string' && payload.p.trim().length > 0
        ? payload.p.trim()
        : undefined;

    if (!sessionId || !content) {
      return NextResponse.json(
        { error: 'sessionId and content are required' },
        { status: 400 }
      );
    }

    await approveTestUiDraft(sessionId, content, p);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[Test UI Approve Error]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
