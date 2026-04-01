import { NextRequest, NextResponse } from 'next/server';
import { unstable_noStore as noStore } from 'next/cache';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Returns the active/review session for a phone number.
// Used by /test page to resume a conversation.
export async function GET(req: NextRequest) {
  noStore();

  const phone = req.nextUrl.searchParams.get('phone');
  if (!phone) return NextResponse.json({ sessionId: null });

  const { data: liveSession } = await supabase
    .from('sessions')
    .select('id, status')
    .eq('client_identifier', phone)
    .in('status', ['active', 'review', 'handed_over'])
    .order('updated_at', { ascending: false })
    .limit(1)
    .single();

  if (liveSession?.id) {
    return NextResponse.json({ sessionId: liveSession.id });
  }

  const { data: lastCompletedSession } = await supabase
    .from('sessions')
    .select('id')
    .eq('client_identifier', phone)
    .eq('status', 'completed')
    .order('updated_at', { ascending: false })
    .limit(1)
    .single();

  return NextResponse.json({ sessionId: lastCompletedSession?.id || null });
}
