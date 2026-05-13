import { NextRequest, NextResponse } from 'next/server';
import { unstable_noStore as noStore } from 'next/cache';
import { supabase, TEST_UI_TRANSCRIPTS_TABLE } from '@/lib/supabase';
import { logAppError } from '@/lib/error-logger';
import { safeLog } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: NextRequest) {
  noStore();

  const sessionId = req.nextUrl.searchParams.get('sessionId');
  const since = req.nextUrl.searchParams.get('since');

  if (!sessionId) {
    return NextResponse.json({
      messages: [],
      status: 'active',
      hasDraft: false,
      draft: null,
      reviewMessages: [],
    });
  }

  const baseQuery = supabase
    .from(TEST_UI_TRANSCRIPTS_TABLE)
    .select('id, role, content, created_at')
    .eq('session_id', sessionId)
    .in('role', ['user', 'assistant']);

  const { data: rawMessages, error } = since
    ? await baseQuery.gte('created_at', since).order('created_at', { ascending: true })
    : await baseQuery.order('created_at', { ascending: false }).limit(50);

  if (error) {
    safeLog({
      level: 'error',
      category: 'system',
      event: 'db_error',
      session_id: sessionId,
      error: error?.message || String(error),
      stack: error?.stack,
      query_description: 'Poll Sophia sandbox transcript messages',
      code: error?.code,
    });
    await logAppError({
      source: 'api.sophia-sandbox.poll',
      message: error.message || 'Poll query failed',
      context: { code: error.code, details: error.details, hint: error.hint },
      path: '/api/sophia-sandbox/poll',
      method: 'GET',
      runtime: 'server',
    });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { data: session } = await supabase
    .from('sessions')
    .select('status')
    .eq('id', sessionId)
    .contains('metadata', { source: 'sophia-sandbox' })
    .maybeSingle();

  const { data: draftMessages } = await supabase
    .from(TEST_UI_TRANSCRIPTS_TABLE)
    .select('id, role, content, created_at')
    .eq('session_id', sessionId)
    .eq('role', 'draft')
    .order('created_at', { ascending: false })
    .limit(1);

  const { data: reviewMessages } = await supabase
    .from(TEST_UI_TRANSCRIPTS_TABLE)
    .select('id, role, content, created_at')
    .eq('session_id', sessionId)
    .in('role', ['user', 'assistant', 'draft'])
    .order('created_at', { ascending: false })
    .limit(10);

  const draft = draftMessages?.[0] || null;
  const hasDraft = Boolean(draft);
  const status = hasDraft
    ? session?.status || 'needs_approval'
    : session?.status === 'needs_approval'
      ? 'active'
      : session?.status || 'active';

  return NextResponse.json({
    messages: since ? rawMessages || [] : (rawMessages || []).reverse(),
    status,
    hasDraft,
    draft,
    reviewMessages: (reviewMessages || []).reverse(),
  });
}
