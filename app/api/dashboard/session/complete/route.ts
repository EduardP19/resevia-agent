import { NextRequest, NextResponse } from 'next/server';
import { refreshSessionSummary, supabase } from '@/lib/supabase';
import { safeLog } from '@/lib/logger';
import { requireDashboardSessionFromRequest } from '@/lib/dashboard-auth';

export async function POST(req: NextRequest) {
  const auth = requireDashboardSessionFromRequest(req);
  if (auth.response) return auth.response;

  try {
    const { sessionId } = await req.json();
    if (!sessionId || typeof sessionId !== 'string') {
      return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
    }

    const { data: session, error: sessionError } = await supabase
      .from('sessions')
      .select('id, salon_id, status')
      .eq('id', sessionId)
      .eq('salon_id', auth.session.tenantId)
      .single();

    if (sessionError || !session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    if (session.status === 'completed' || session.status === 'expired') {
      return NextResponse.json({ success: true, status: session.status });
    }

    const { error: updateError } = await supabase
      .from('sessions')
      .update({
        status: 'completed',
        updated_at: new Date().toISOString(),
      })
      .eq('id', sessionId)
      .eq('salon_id', auth.session.tenantId);

    if (updateError) throw updateError;

    await refreshSessionSummary(sessionId, 'completed').catch(() => {});

    safeLog({
      type: 'audit',
      level: 'info',
      category: 'session',
      event: 'session_completed_manually',
      tenant_id: auth.session.tenantId,
      session_id: sessionId,
      user_id: auth.session.email,
    });

    return NextResponse.json({ success: true, status: 'completed' });
  } catch (error: any) {
    safeLog({
      type: 'error',
      level: 'error',
      category: 'system',
      event: 'db_error',
      error: error?.message || String(error),
      stack: error?.stack,
      query_description: 'Manual dashboard session completion',
      tenant_id: auth.session.tenantId,
    });
    return NextResponse.json({ error: error?.message || 'Failed to complete session' }, { status: 500 });
  }
}
