import { NextRequest, NextResponse } from 'next/server';
import {
  DASHBOARD_REMEMBER_COOKIE,
  DASHBOARD_SESSION_COOKIE,
  createDashboardSession,
  dashboardRememberCookieOptions,
  dashboardSessionCookieOptions,
  findDashboardCredential,
  sanitizeDashboardRedirect,
} from '@/lib/dashboard-auth';
import { getSalonById } from '@/lib/supabase';
import { safeLog } from '@/lib/logger';

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const email = String(formData.get('email') || '');
  const password = String(formData.get('password') || '');
  const remember = String(formData.get('remember') || '').toLowerCase() === 'on';
  const next = sanitizeDashboardRedirect(String(formData.get('next') || '/dashboard/home'));

  const credential = await findDashboardCredential(email, password);
  if (!credential) {
    return NextResponse.redirect(new URL(`/login?error=invalid&next=${encodeURIComponent(next)}`, req.url), {
      status: 303,
    });
  }

  const salon = await getSalonById(credential.tenantId);
  if (!salon) {
    safeLog({
      level: 'error',
      category: 'auth',
      event: 'login_failed',
      tenant_id: credential.tenantId,
      user_id: credential.email,
      error: 'Configured tenant was not found in business_profiles.',
    });
    return NextResponse.redirect(new URL(`/login?error=tenant&next=${encodeURIComponent(next)}`, req.url), {
      status: 303,
    });
  }

  const response = NextResponse.redirect(new URL(next, req.url), { status: 303 });
  response.cookies.set(
    DASHBOARD_SESSION_COOKIE,
    createDashboardSession(credential.tenantId, credential.email, remember),
    dashboardSessionCookieOptions(remember)
  );
  response.cookies.set(DASHBOARD_REMEMBER_COOKIE, remember ? '1' : '', dashboardRememberCookieOptions(remember));

  safeLog({
    level: 'info',
    category: 'auth',
    event: 'login_succeeded',
    tenant_id: credential.tenantId,
    user_id: credential.email,
  });

  return response;
}
