import { NextRequest, NextResponse } from 'next/server';
import { requireDashboardSessionFromRequest } from '@/lib/dashboard-auth';
import { isTestUiSession, supabase } from '@/lib/supabase';
import { cancelDeferredNotification } from '@/lib/deferred-notifications';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = requireDashboardSessionFromRequest(req);
  if (auth.response) return auth.response;
  const sessionId = req.nextUrl.searchParams.get('sessionId');
  const since = req.nextUrl.searchParams.get('since');
  if (!z.string().uuid().safeParse(sessionId).success || (since && Number.isNaN(Date.parse(since)))) {
    return NextResponse.json({ error: 'Invalid session or timestamp' }, { status: 400 });
  }
  const { data: session, error } = await supabase.from('sessions').select('status, channel, metadata')
    .eq('id', sessionId).eq('salon_id', auth.session.tenantId).maybeSingle();
  if (error) return NextResponse.json({ error: 'Could not load conversation' }, { status: 503 });
  if (!session || isTestUiSession(session)) return NextResponse.json({ error: 'Session not found' }, { status: 404 });

  let query = supabase.from('transcripts').select('*').eq('session_id', sessionId)
    .in('role', ['user', 'assistant', 'draft']).order('created_at', { ascending: true }).order('id', { ascending: true });
  if (since) query = query.gte('created_at', since);
  const [{ data: rows, error: transcriptError }, { count, error: draftError }] = await Promise.all([
    query,
    supabase.from('transcripts').select('id', { count: 'exact', head: true }).eq('session_id', sessionId).eq('role', 'draft'),
  ]);
  if (transcriptError || draftError) return NextResponse.json({ error: 'Could not refresh conversation' }, { status: 503 });
  void cancelDeferredNotification(sessionId).catch(() => {});
  return NextResponse.json({
    messages: (rows || []).map(({ id, role, content, created_at, channel }) => ({ id, role, content, created_at, channel })),
    status: session.status, channel: session.channel, hasDraft: (count || 0) > 0,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
