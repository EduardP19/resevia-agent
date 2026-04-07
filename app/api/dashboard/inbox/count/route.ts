import { NextResponse } from 'next/server';
import { supabase, isTestUiSession } from '@/lib/supabase';

export async function GET() {
  const { data, error } = await supabase
    .from('sessions')
    .select('id, metadata')
    .in('status', ['handed_over', 'review']);

  if (error) return NextResponse.json({ count: 0 });
  return NextResponse.json({
    count: (data || []).filter((session: any) => !isTestUiSession(session)).length,
  });
}
