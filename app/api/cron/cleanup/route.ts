import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { logError, logJob } from '@/lib/logger';

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

  const startedAt = Date.now();
  // Previously this job logged only on failure, so a successful run and a run
  // that never fired were indistinguishable.
  logJob('cleanup_started', { source: 'api.cron.cleanup' });

  try {
    const { data, error } = await supabase.rpc('expire_inactive_sessions_and_holds');
    if (error) {
      throw error;
    }

    logJob('cleanup_finished', {
      source: 'api.cron.cleanup',
      duration_ms: Date.now() - startedAt,
      expired: (data as any)?.expired ?? 0,
      holds_expired: (data as any)?.holdsExpired ?? 0,
    });

    return NextResponse.json(data || { expired: 0, holdsExpired: 0 });
  } catch (err: any) {
    logError('system', 'cleanup_failed', err, {
      source: 'api.cron.cleanup',
      duration_ms: Date.now() - startedAt,
      query_description: 'Cron cleanup failed',
    });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
