import { NextRequest, NextResponse } from 'next/server';
import { unstable_noStore as noStore } from 'next/cache';
import { isTestUiSession, supabase } from '@/lib/supabase';
import { requireDashboardSessionFromRequest } from '@/lib/dashboard-auth';
import { safeLog } from '@/lib/logger';
import { cancelDeferredNotification } from '@/lib/deferred-notifications';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function isMissingTranscriptChannelColumnError(error: any) {
  const message = typeof error?.message === 'string' ? error.message : '';
  const details = typeof error?.details === 'string' ? error.details : '';
  const code = typeof error?.code === 'string' ? error.code : '';

  return (
    code === 'PGRST204' ||
    message.includes("Could not find the 'channel' column") ||
    details.includes("Could not find the 'channel' column")
  );
}

// Returns user/assistant messages for a session.
// If 'since' is provided, returns only messages newer than that.
// If 'since' is missing, returns the latest 50 messages to sync recent history.
export async function GET(req: NextRequest) {
  noStore();

  const sessionId = req.nextUrl.searchParams.get('sessionId');
  const since = req.nextUrl.searchParams.get('since');

  if (!sessionId) return NextResponse.json({ messages: [] });

  const { data: pollSession } = await supabase.from('sessions').select('salon_id, metadata').eq('id', sessionId).maybeSingle();
  if (!pollSession) return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  if (!isTestUiSession(pollSession)) {
    const auth = requireDashboardSessionFromRequest(req);
    if (auth.response) return auth.response;
    if (pollSession.salon_id !== auth.session.tenantId) return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  // Cancel any pending deferred notification — the owner has the session open.
  void cancelDeferredNotification(sessionId).catch(() => {});

  const buildMessagesQuery = (includeChannel: boolean) => supabase
    .from('transcripts')
    .select(includeChannel ? 'id, role, content, created_at, channel' : 'id, role, content, created_at')
    .eq('session_id', sessionId)
    .in('role', ['user', 'assistant']);

  let rawMessages: any[] | null = null;
  let error: any = null;

  const loadMessages = async (includeChannel: boolean) => since
    ? await buildMessagesQuery(includeChannel)
        // Greater than or equal to avoid missing messages created in the same millisecond.
        // deduplication is handled by ID on the client.
        .gte('created_at', since)
        .order('created_at', { ascending: true })
    : await buildMessagesQuery(includeChannel)
        // On first load, grab recent context, then restore chronological order.
        .order('created_at', { ascending: false })
        .limit(50);

  ({ data: rawMessages, error } = await loadMessages(true));

  if (error && isMissingTranscriptChannelColumnError(error)) {
    ({ data: rawMessages, error } = await loadMessages(false));
  }

  if (error) {
    safeLog({
      type: 'error',
      level: 'error',
      category: 'system',
      event: 'db_error',
      session_id: sessionId,
      error: error?.message || String(error),
      stack: error?.stack,
      query_description: 'Poll test transcript messages',
      code: error?.code,
    });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const messages = since ? (rawMessages || []) : (rawMessages || []).reverse();

  // Fetch current session status and draft flag
  const { data: session } = await supabase
    .from('sessions')
    .select('status')
    .eq('id', sessionId)
    .single();

  const { count: draftCount } = await supabase
    .from('transcripts')
    .select('*', { count: 'exact', head: true })
    .eq('session_id', sessionId)
    .eq('role', 'draft');

  const { data: draftMessages } = await supabase
    .from('transcripts')
    .select('id, role, content, created_at, channel')
    .eq('session_id', sessionId)
    .eq('role', 'draft')
    .order('created_at', { ascending: false })
    .limit(1);

  const { data: reviewMessages } = await supabase
    .from('transcripts')
    .select('id, role, content, created_at, channel')
    .eq('session_id', sessionId)
    .in('role', ['user', 'assistant', 'draft', 'system'])
    .order('created_at', { ascending: false })
    .limit(8);

  const latestDraft = draftMessages?.[0] || null;

  return NextResponse.json({ 
    messages, 
    status: session?.status || 'active',
    hasDraft: (draftCount || 0) > 0,
    draft: latestDraft,
    reviewMessages: (reviewMessages || []).reverse()
  });
}
