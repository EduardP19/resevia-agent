import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { safeLog } from '@/lib/logger';

export const dynamic = 'force-dynamic';

function isCronAuthorized(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return true;

  const authHeader = req.headers.get('authorization') || '';
  return authHeader === `Bearer ${cronSecret}`;
}

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { data, error } = await supabase.rpc('expire_inactive_sessions_and_holds');
    if (error) {
      throw error;
    }

    return NextResponse.json(data || { expired: 0, holdsExpired: 0 });
  } catch (err: any) {
    safeLog({
      level: 'error',
      category: 'system',
      event: 'db_error',
      error: err?.message || String(err),
      stack: err?.stack,
      query_description: 'Cron cleanup failed',
    });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
