import { NextRequest, NextResponse } from 'next/server';

const DASHBOARD_SESSION_COOKIE = 'resevia_dashboard_session';

export function middleware(req: NextRequest) {
  if (!req.cookies.get(DASHBOARD_SESSION_COOKIE)?.value) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = `?next=${encodeURIComponent(req.nextUrl.pathname + req.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*'],
};
