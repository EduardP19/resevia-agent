import { NextRequest, NextResponse } from 'next/server';
import { expireSessionById, isTestUiSession, supabase } from '@/lib/supabase';
import { safeLog } from '@/lib/logger';

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json();
    const sessionId =
      typeof payload?.sessionId === 'string' ? payload.sessionId.trim() : '';
    const from = typeof payload?.from === 'string' ? payload.from.trim() : '';

    if (!sessionId || !from) {
      return NextResponse.json(
        { error: 'sessionId and from are required' },
        { status: 400 }
      );
    }

    const { data: session, error } = await supabase
      .from('sessions')
      .select('id, client_identifier, metadata')
      .eq('id', sessionId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!session || isTestUiSession(session) || session.client_identifier !== from) {
      return NextResponse.json({ error: 'Test session not found' }, { status: 404 });
    }

    await expireSessionById(sessionId, { expired_by: 'ui-timeout' });
    safeLog({
      level: 'info',
      category: 'session',
      event: 'session_closed',
      session_id: sessionId,
      reason: 'timeout',
    });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[Test Expire Error]', error);
    safeLog({
      level: 'error',
      category: 'system',
      event: 'db_error',
      error: error?.message || String(error),
      stack: error?.stack,
      query_description: 'Expire test session',
    });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
