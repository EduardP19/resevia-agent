import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// Returns assistant messages for a session.
// If 'since' is provided, returns only messages newer than that.
// If 'since' is missing, returns the latest 20 assistant messages to sync history.
export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get('sessionId');
  const since = req.nextUrl.searchParams.get('since');

  if (!sessionId) return NextResponse.json({ messages: [] });

  let query = supabase
    .from('transcripts')
    .select('id, role, content, created_at')
    .eq('session_id', sessionId)
    .in('role', ['user', 'assistant'])
    .order('created_at', { ascending: true });

  if (since) {
    // Greater than or equal to avoid missing messages created in the same millisecond.
    // deduplication is handled by ID on the client.
    query = query.gte('created_at', since);
  } else {
    // On first load, grab recent context
    query = query.limit(50);
  }

  const { data: messages, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

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
