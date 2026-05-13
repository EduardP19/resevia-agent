import { NextResponse } from 'next/server';
import { NextRequest } from 'next/server';
import { supabase, isTestUiSession } from '@/lib/supabase';
import { safeLog } from '@/lib/logger';
import { requireDashboardSessionFromRequest } from '@/lib/dashboard-auth';

export async function GET(req: NextRequest) {
  const auth = requireDashboardSessionFromRequest(req);
  if (auth.response) return auth.response;

  const { data, error } = await supabase
    .from('sessions')
    .select('id, metadata')
    .eq('salon_id', auth.session.tenantId)
    .in('status', ['handed_over', 'review']);

  if (error) {
    safeLog({
      level: 'error',
      category: 'system',
      event: 'db_error',
      error: error?.message || String(error),
      stack: error?.stack,
      query_description: 'Fetch dashboard inbox count',
      tenant_id: auth.session.tenantId,
      code: error?.code,
    });
    return NextResponse.json({ count: 0 });
  }
  return NextResponse.json({
    count: (data || []).filter((session: any) => !isTestUiSession(session)).length,
  });
}
