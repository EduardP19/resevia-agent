import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { safeLog } from '@/lib/logger';
import { requireDashboardSessionFromRequest } from '@/lib/dashboard-auth';

/**
 * Set (or clear) a single chat's Manual/Auto override.
 *
 * Body: { sessionId: string, override: 'auto' | 'manual' | null }
 *   null    -> chat follows the salon's global approval_mode
 *   'manual'-> this chat always drafts for approval
 *   'auto'  -> this chat always sends automatically
 *
 * Only the override for this one session is changed; the global setting is untouched.
 */
export async function POST(req: NextRequest) {
  const auth = requireDashboardSessionFromRequest(req);
  if (auth.response) return auth.response;

  try {
    const { sessionId, override } = await req.json();

    if (!sessionId || typeof sessionId !== 'string') {
      return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
    }

    if (override !== null && override !== 'auto' && override !== 'manual') {
      return NextResponse.json({ error: "override must be 'auto', 'manual', or null" }, { status: 400 });
    }

    // Ensure the chat belongs to the authenticated salon before mutating it.
    const { data: session, error: sError } = await supabase
      .from('sessions')
      .select('id, salon_id')
      .eq('id', sessionId)
      .eq('salon_id', auth.session.tenantId)
      .single();

    if (!session || sError) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    const { data, error } = await supabase
      .from('sessions')
      .update({ response_mode_override: override, updated_at: new Date().toISOString() })
      .eq('id', sessionId)
      .select('id, response_mode_override')
      .single();

    if (error) throw error;

    safeLog({
      type: 'audit',
      level: 'info',
      category: 'dashboard',
      event: 'session_mode_override_set',
      tenant_id: auth.session.tenantId,
      session_id: sessionId,
      user_id: auth.session.email,
      override: override ?? 'inherit',
    });

    return NextResponse.json({ success: true, response_mode_override: data.response_mode_override });
  } catch (error: any) {
    safeLog({
      type: 'error',
      level: 'error',
      category: 'system',
      event: 'db_error',
      error: error?.message || String(error),
      stack: error?.stack,
      query_description: 'Set per-session response mode override',
      tenant_id: auth.session.tenantId,
    });
    return NextResponse.json({ error: error.message || 'Failed to update chat mode' }, { status: 500 });
  }
}
