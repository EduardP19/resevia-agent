import crypto from 'crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const DASHBOARD_SESSION_COOKIE = 'resevia_dashboard_session';
export const DASHBOARD_REMEMBER_COOKIE = 'resevia_dashboard_remember';

const DEFAULT_SESSION_TTL_SECONDS = 60 * 60 * 8;
const REMEMBER_SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

type DashboardSession = {
  tenantId: string;
  email: string;
  issuedAt: number;
  expiresAt: number;
};

type DashboardCredential = {
  email: string;
  tenantId?: string;
  salonId?: string;
  password?: string;
  passwordSha256?: string;
};

function base64UrlEncode(value: string) {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function getSessionSecret() {
  return (
    process.env.DASHBOARD_SESSION_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    ''
  );
}

function signPayload(payload: string) {
  const secret = getSessionSecret();
  if (!secret) {
    throw new Error('DASHBOARD_SESSION_SECRET is required for dashboard login sessions.');
  }

  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

function secureCompare(a: string, b: string) {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);

  if (aBuffer.length !== bBuffer.length) return false;
  return crypto.timingSafeEqual(aBuffer, bBuffer);
}

function sha256(value: string) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function parseCredentials(): DashboardCredential[] {
  const raw = process.env.DASHBOARD_TENANT_CREDENTIALS;
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);

    if (Array.isArray(parsed)) {
      return parsed;
    }

    if (parsed && typeof parsed === 'object') {
      return Object.entries(parsed).map(([email, value]) => ({
        email,
        ...(value && typeof value === 'object' ? value : {}),
      })) as DashboardCredential[];
    }
  } catch {
    return [];
  }

  return [];
}

export function createDashboardSession(tenantId: string, email: string, remember = false) {
  const now = Math.floor(Date.now() / 1000);
  const ttl = remember ? REMEMBER_SESSION_TTL_SECONDS : DEFAULT_SESSION_TTL_SECONDS;
  const session: DashboardSession = {
    tenantId,
    email,
    issuedAt: now,
    expiresAt: now + ttl,
  };
  const payload = base64UrlEncode(JSON.stringify(session));
  return `${payload}.${signPayload(payload)}`;
}

export function readDashboardSession(token?: string | null): DashboardSession | null {
  if (!token) return null;

  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;

  const expectedSignature = signPayload(payload);
  if (!secureCompare(signature, expectedSignature)) return null;

  try {
    const session = JSON.parse(base64UrlDecode(payload)) as DashboardSession;
    if (!session.tenantId || !session.email || !session.expiresAt) return null;
    if (session.expiresAt < Math.floor(Date.now() / 1000)) return null;
    return session;
  } catch {
    return null;
  }
}

export function getDashboardSession() {
  return readDashboardSession(cookies().get(DASHBOARD_SESSION_COOKIE)?.value);
}

export function getDashboardSessionFromRequest(req: NextRequest) {
  return readDashboardSession(req.cookies.get(DASHBOARD_SESSION_COOKIE)?.value);
}

export function requireDashboardSession() {
  const session = getDashboardSession();
  if (!session) redirect('/login?next=/dashboard/home');
  return session;
}

export function requireDashboardSessionFromRequest(req: NextRequest) {
  const session = getDashboardSessionFromRequest(req);
  if (!session) {
    return {
      session: null,
      response: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }),
    };
  }

  return { session, response: null };
}

function matchesStoredPassword(password: string, storedPassword: string) {
  const normalizedStored = storedPassword.trim();

  if (normalizedStored.startsWith('sha256:')) {
    return secureCompare(sha256(password), normalizedStored.slice('sha256:'.length));
  }

  if (/^[a-f0-9]{64}$/i.test(normalizedStored)) {
    return secureCompare(sha256(password), normalizedStored.toLowerCase());
  }

  return secureCompare(password, normalizedStored);
}

export async function findDashboardCredential(email: string, password: string) {
  const normalizedEmail = email.trim().toLowerCase();
  const { data: dbCredential } = await supabase
    .from('business_profiles')
    .select('id, email, password')
    .ilike('email', normalizedEmail)
    .maybeSingle();

  if (
    dbCredential?.id &&
    dbCredential?.email &&
    typeof dbCredential.password === 'string' &&
    matchesStoredPassword(password, dbCredential.password)
  ) {
    return { email: normalizedEmail, tenantId: dbCredential.id };
  }

  const credential = parseCredentials().find(item => item.email?.trim().toLowerCase() === normalizedEmail);
  const tenantId = credential?.tenantId || credential?.salonId;
  if (!credential || !tenantId) return null;

  if (credential.password && matchesStoredPassword(password, credential.password)) {
    return { email: normalizedEmail, tenantId };
  }

  if (credential.passwordSha256 && secureCompare(sha256(password), credential.passwordSha256)) {
    return { email: normalizedEmail, tenantId };
  }

  return null;
}

export function dashboardSessionCookieOptions(remember = false) {
  const maxAge = remember ? REMEMBER_SESSION_TTL_SECONDS : DEFAULT_SESSION_TTL_SECONDS;
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge,
  };
}

export function dashboardRememberCookieOptions(enabled: boolean) {
  return {
    httpOnly: false,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: enabled ? 60 * 60 * 24 * 365 : 0,
  };
}

export function sanitizeDashboardRedirect(value?: string | null) {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/dashboard/home';
  return value;
}
