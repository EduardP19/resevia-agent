import { NextRequest, NextResponse } from 'next/server';
import { supabase, updateSalonProfile } from '@/lib/supabase';
import { safeLog } from '@/lib/logger';
import { requireDashboardSessionFromRequest } from '@/lib/dashboard-auth';
import { encrypt } from '@/lib/crypto';
import { getCachedProfile, setCachedProfile, invalidateProfileCache } from '@/lib/profile-cache';

/**
 * Fields a tenant may change from their dashboard.
 *
 * Business identity — `name`, `twilio_number`, `whatsapp_number`, `opening_hours` —
 * is deliberately NOT here: it's provisioned by Resevia and read-only in Settings,
 * so it must be rejected server-side too, not just hidden in the UI.
 */
const allowedProfileFields = new Set([
  'agent_name',
  'industry',
  'tone_of_voice',
  'services',
  'twilio_account_sid',
  'twilio_auth_token',
  'notify_sms_to',
  'approval_mode',
]);

export async function GET(req: NextRequest) {
  const auth = requireDashboardSessionFromRequest(req);
  if (auth.response) return auth.response;

  const cached = getCachedProfile(auth.session.tenantId);
  if (cached) return NextResponse.json(cached);

  const { data } = await supabase
    .from('business_profiles')
    .select('id, name, agent_name, approval_mode')
    .eq('id', auth.session.tenantId)
    .single();

  if (data) setCachedProfile(auth.session.tenantId, data);
  return NextResponse.json(data ?? {});
}

export async function PATCH(req: NextRequest) {
  const auth = requireDashboardSessionFromRequest(req);
  if (auth.response) return auth.response;

  try {
    const { id, ...updates } = await req.json();
    const safeUpdates = Object.fromEntries(
      Object.entries(updates).filter(([key]) => allowedProfileFields.has(key))
    );

    if (typeof safeUpdates.twilio_auth_token === 'string' && safeUpdates.twilio_auth_token.length > 0) {
      safeUpdates.twilio_auth_token = encrypt(safeUpdates.twilio_auth_token);
    }

    if (typeof safeUpdates.agent_name === 'string') {
      safeUpdates.agent_name = safeUpdates.agent_name.trim() || null;
    }

    const data = await updateSalonProfile(auth.session.tenantId, safeUpdates);
    invalidateProfileCache(auth.session.tenantId);
    safeLog({
      level: 'info',
      category: 'dashboard',
      event: 'settings_updated',
      tenant_id: auth.session.tenantId,
      user_id: auth.session.email,
      fields_changed: Object.keys(safeUpdates),
    });
    return NextResponse.json(data);
  } catch (err: any) {
    safeLog({
      level: 'error',
      category: 'system',
      event: 'db_error',
      error: err?.message || String(err),
      stack: err?.stack,
      query_description: 'Update salon dashboard settings',
      tenant_id: auth.session.tenantId,
    });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
