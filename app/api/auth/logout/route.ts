import { NextRequest, NextResponse } from 'next/server';
import {
  DASHBOARD_REMEMBER_COOKIE,
  DASHBOARD_SESSION_COOKIE,
  dashboardRememberCookieOptions,
  getDashboardSessionFromRequest,
} from '@/lib/dashboard-auth';
import { safeLog } from '@/lib/logger';

export async function POST(req: NextRequest) {
  const session = getDashboardSessionFromRequest(req);
  const response = NextResponse.redirect(new URL('/login', req.url), { status: 303 });
  response.cookies.set(DASHBOARD_SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });
  response.cookies.set(DASHBOARD_REMEMBER_COOKIE, '', dashboardRememberCookieOptions(false));

  if (session) {
    safeLog({
      type: 'audit',
      level: 'info',
      category: 'auth',
      event: 'logout',
      tenant_id: session.tenantId,
      user_id: session.email,
    });
  }

  return response;
}
