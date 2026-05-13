import { NextRequest, NextResponse } from 'next/server';
import { supabase, updateSalonProfile } from '@/lib/supabase';
import { safeLog } from '@/lib/logger';
import { requireDashboardSessionFromRequest } from '@/lib/dashboard-auth';

const allowedProfileFields = new Set([
  'name',
  'industry',
  'opening_hours',
  'tone_of_voice',
  'services',
  'twilio_number',
  'approval_mode',
]);

export async function GET(req: NextRequest) {
  const auth = requireDashboardSessionFromRequest(req);
  if (auth.response) return auth.response;

  const { data } = await supabase
    .from('business_profiles')
    .select('id, name, approval_mode')
    .eq('id', auth.session.tenantId)
    .single();
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
    const data = await updateSalonProfile(auth.session.tenantId, safeUpdates);
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
