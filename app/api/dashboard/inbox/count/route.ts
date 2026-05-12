import { NextResponse } from 'next/server';
import { supabase, isTestUiSession } from '@/lib/supabase';
import { safeLog } from '@/lib/logger';

export async function GET() {
  const { data, error } = await supabase
    .from('sessions')
    .select('id, metadata')
    .in('status', ['handed_over', 'review']);

  if (error) {
    safeLog({
      level: 'error',
      category: 'system',
      event: 'db_error',
      error: error?.message || String(error),
      stack: error?.stack,
      query_description: 'Fetch dashboard inbox count',
      code: error?.code,
    });
    return NextResponse.json({ count: 0 });
  }
  return NextResponse.json({
    count: (data || []).filter((session: any) => !isTestUiSession(session)).length,
  });
}
