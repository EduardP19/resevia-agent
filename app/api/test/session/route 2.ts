import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// Returns the active/review session for a phone number.
// Used by /test page to resume a conversation.
export async function GET(req: NextRequest) {
  const phone = req.nextUrl.searchParams.get('phone');
  if (!phone) return NextResponse.json({ sessionId: null });

  const { data } = await supabase
    .from('sessions')
    .select('id, status')
    .eq('client_identifier', phone)
    .in('status', ['active', 'review', 'handed_over', 'completed'])
    .order('status', { ascending: true }) // 'active'/'review' come before 'completed' in alpha or custom order
    .order('updated_at', { ascending: false })
    .limit(1)
    .single();

  return NextResponse.json({ sessionId: data?.id || null });
}
