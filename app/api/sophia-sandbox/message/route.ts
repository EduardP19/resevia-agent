import { NextRequest, NextResponse } from 'next/server';
import { createTestUiResponse } from '@/lib/sophia-sandbox';

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json();
    const message =
      typeof payload?.message === 'string' ? payload.message.trim() : '';
    const sessionId =
      typeof payload?.id === 'string' && payload.id.length > 0 ? payload.id : undefined;
    const p =
      typeof payload?.p === 'string' && payload.p.trim().length > 0
        ? payload.p.trim()
        : undefined;
    const manualApproval = payload?.manualApproval !== false;

    if (!message) {
      return NextResponse.json({ error: 'message is required' }, { status: 400 });
    }

    const result = await createTestUiResponse({
      message,
      sessionId,
      manualApproval,
      p,
    });

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[Test UI Message Error]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
