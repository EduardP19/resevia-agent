import { NextRequest, NextResponse } from 'next/server';
import { logAppError } from '@/lib/error-logger';
import { safeLog } from '@/lib/logger';

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json();
    const mappedLevel = payload?.level === 'warn' ? 'warn' : payload?.level === 'info' ? 'info' : 'error';
    const mappedLogLevel = payload?.level === 'warn' ? 'warning' : payload?.level === 'info' ? 'info' : 'error';
    const hasEvent = typeof payload?.event === 'string' && payload.event.length > 0;

    // Persist only warn/error client issues in system error logs.
    if (mappedLevel !== 'info') {
      await logAppError({
        source: typeof payload?.source === 'string' ? payload.source : 'client',
        level: mappedLevel,
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
    }

    safeLog({
      level: mappedLogLevel,
      category: typeof payload?.category === 'string' ? payload.category : 'dashboard',
      event: hasEvent ? payload.event : 'client_error',
      tenant_id: typeof payload?.salon_id === 'string' ? payload.salon_id : undefined,
      session_id: typeof payload?.session_id === 'string' ? payload.session_id : undefined,
      error: typeof payload?.message === 'string' ? payload.message : undefined,
      stack: typeof payload?.stack === 'string' ? payload.stack : undefined,
      path: typeof payload?.path === 'string' ? payload.path : req.nextUrl.pathname,
      metadata: payload?.metadata && typeof payload.metadata === 'object' ? payload.metadata : undefined,
      source: typeof payload?.source === 'string' ? payload.source : 'client',
    });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
