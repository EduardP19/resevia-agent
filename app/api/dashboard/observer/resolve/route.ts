import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { safeLog } from '@/lib/logger';
import { requireDashboardSessionFromRequest } from '@/lib/dashboard-auth';

/**
 * Marks an observer finding as addressed so it drops off the dashboard.
 *
 * `observer_flags.resolved` already existed and was never written — the home
 * page has always filtered on it, so nothing could ever leave the list.
 */
export async function POST(req: NextRequest) {
  const auth = requireDashboardSessionFromRequest(req);
  if (auth.response) return auth.response;

  try {
    const { id } = await req.json();
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    // Scoped to the tenant in the update itself, so one salon can't resolve
    // another's findings by guessing an id.
    const { data, error } = await supabase
      .from('observer_flags')
      .update({ resolved: true, resolved_at: new Date().toISOString() })
      .eq('id', id)
      .eq('salon_id', auth.session.tenantId)
      .select('id')
      .maybeSingle();

    if (error) throw error;
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    safeLog({
      type: 'audit',
      level: 'info',
      category: 'observer',
      event: 'observer_flag_resolved',
      tenant_id: auth.session.tenantId,
      user_id: auth.session.email,
      flag_id: id,
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    safeLog({
      type: 'error',
      level: 'error',
      category: 'observer',
      event: 'observer_flag_resolve_failed',
      tenant_id: auth.session.tenantId,
      error: err?.message || String(err),
      stack: err?.stack,
    });
    return NextResponse.json({ error: 'Could not update flag' }, { status: 500 });
  }
}
