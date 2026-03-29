import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// Returns all new transcript messages since a given timestamp.
// Used by /test page to stay in sync with what the dashboard sends.
export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get('sessionId');
  const since = req.nextUrl.searchParams.get('since'); // ISO timestamp

  if (!sessionId) return NextResponse.json({ messages: [] });

  let query = supabase
    .from('transcripts')
    .select('id, role, content, created_at')
    .eq('session_id', sessionId)
    .in('role', ['user', 'assistant'])  // exclude system/draft noise
    .order('created_at', { ascending: true });

  if (since) {
    query = query.gt('created_at', since);
  }

  const { data } = await query;
  return NextResponse.json({ messages: data || [] });
}
