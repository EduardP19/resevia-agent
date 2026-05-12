import { NextRequest, NextResponse } from 'next/server';
import { supabase, updateSalonProfile } from '@/lib/supabase';
import { safeLog } from '@/lib/logger';

export async function GET() {
  const { data } = await supabase.from('business_profiles').select('id, approval_mode').limit(1).single();
  return NextResponse.json(data ?? {});
}

export async function PATCH(req: NextRequest) {
  try {
    const { id, ...updates } = await req.json();
    const data = await updateSalonProfile(id, updates);
    safeLog({
      level: 'info',
      category: 'dashboard',
      event: 'settings_updated',
      tenant_id: id,
      user_id: req.headers.get('x-user-id') || undefined,
      fields_changed: Object.keys(updates),
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
    });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
