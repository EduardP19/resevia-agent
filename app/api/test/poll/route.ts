import { NextRequest, NextResponse } from 'next/server';
import { unstable_noStore as noStore } from 'next/cache';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Returns user/assistant messages for a session.
// If 'since' is provided, returns only messages newer than that.
// If 'since' is missing, returns the latest 50 messages to sync recent history.
export async function GET(req: NextRequest) {
  noStore();

  const sessionId = req.nextUrl.searchParams.get('sessionId');
  const since = req.nextUrl.searchParams.get('since');

  if (!sessionId) return NextResponse.json({ messages: [] });

  const baseQuery = supabase
    .from('transcripts')
    .select('id, role, content, created_at')
    .eq('session_id', sessionId)
    .in('role', ['user', 'assistant']);

  const { data: rawMessages, error } = since
    ? await baseQuery
        // Greater than or equal to avoid missing messages created in the same millisecond.
        // deduplication is handled by ID on the client.
        .gte('created_at', since)
        .order('created_at', { ascending: true })
    : await baseQuery
        // On first load, grab recent context, then restore chronological order.
        .order('created_at', { ascending: false })
        .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

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

  return NextResponse.json({ 
    messages, 
    status: session?.status || 'active',
    hasDraft: (draftCount || 0) > 0
  });
}
