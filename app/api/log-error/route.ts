import { NextRequest, NextResponse } from 'next/server';
import { logAppError } from '@/lib/error-logger';

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json();

    await logAppError({
      source: typeof payload?.source === 'string' ? payload.source : 'client',
      level: payload?.level === 'warn' ? 'warn' : payload?.level === 'info' ? 'info' : 'error',
      message: typeof payload?.message === 'string' ? payload.message : 'Client error',
      stack: typeof payload?.stack === 'string' ? payload.stack : undefined,
      context: payload?.context && typeof payload.context === 'object' ? payload.context : {},
      path: typeof payload?.path === 'string' ? payload.path : req.nextUrl.pathname,
      method: req.method,
      session_id: typeof payload?.session_id === 'string' ? payload.session_id : undefined,
      salon_id: typeof payload?.salon_id === 'string' ? payload.salon_id : undefined,
      client_identifier: typeof payload?.client_identifier === 'string' ? payload.client_identifier : undefined,
      user_agent: req.headers.get('user-agent') || undefined,
      runtime: 'client',
    });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
