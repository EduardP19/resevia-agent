import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// Returns new assistant messages since a given timestamp.
// Used by /test page to pick up approved drafts and manual dashboard messages.
// NOTE: user messages are excluded — they are always added locally by the test page.
export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get('sessionId');
  const since = req.nextUrl.searchParams.get('since');

  if (!sessionId) return NextResponse.json({ messages: [] });

  let query = supabase
    .from('transcripts')
    .select('id, role, content, created_at')
    .eq('session_id', sessionId)
    .eq('role', 'assistant')   // only assistant — user messages are handled client-side
    .order('created_at', { ascending: true });

  if (since) {
    query = query.gt('created_at', since);
  }

  const { data } = await query;
  return NextResponse.json({ messages: data || [] });
}
