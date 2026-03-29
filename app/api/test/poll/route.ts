import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// Lightweight poll endpoint: returns the latest assistant message for a session
// Used by /test page to detect when a draft has been approved and sent
export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get('sessionId');
  if (!sessionId) return NextResponse.json({ message: null });

  const { data } = await supabase
    .from('transcripts')
    .select('content, role, created_at')
    .eq('session_id', sessionId)
    .eq('role', 'assistant')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  return NextResponse.json({ message: data || null });
}
