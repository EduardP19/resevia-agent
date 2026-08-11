import { NextRequest, NextResponse } from 'next/server';
import { searchSessionsByPhone } from '@/lib/supabase';
import { safeLog } from '@/lib/logger';
import { requireDashboardSessionFromRequest } from '@/lib/dashboard-auth';

export async function GET(req: NextRequest) {
  const auth = requireDashboardSessionFromRequest(req);
  if (auth.response) return auth.response;

  const phone = req.nextUrl.searchParams.get('phone');
  if (!phone) return NextResponse.json({ error: 'Phone number required' }, { status: 400 });

  try {
    const results = await searchSessionsByPhone(phone, auth.session.tenantId);
    return NextResponse.json(results);
  } catch (err: any) {
    safeLog({
      type: 'error',
      level: 'error',
      category: 'system',
      event: 'db_error',
      error: err?.message || String(err),
      stack: err?.stack,
      query_description: 'Dashboard search sessions by phone',
      tenant_id: auth.session.tenantId,
    });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
