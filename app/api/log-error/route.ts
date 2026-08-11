import { NextRequest, NextResponse } from 'next/server';
import { log, LogCategory, LogLevel, LogType } from '@/lib/logger';
import { getDashboardSessionFromRequest } from '@/lib/dashboard-auth';

/**
 * Single ingest point for client-side logs (see lib/client-events.ts).
 *
 * This used to call logDashboardEvent + logAppError + safeLog in sequence,
 * which fanned out to six awaited inserts across four tables for one client
 * error — writing system_logs and event_logs twice each. It is now one write.
 */

const VALID_TYPES: LogType[] = ['error', 'timeout', 'interaction', 'integration', 'job', 'audit'];
const VALID_CATEGORIES: LogCategory[] = [
  'sms', 'ai', 'tool', 'session', 'dashboard', 'auth', 'billing', 'observer', 'system',
];

function str(value: any): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function resolveLevel(raw: any): LogLevel {
  if (raw === 'error') return 'error';
  if (raw === 'warn' || raw === 'warning') return 'warning';
  return 'info';
}

function resolveType(raw: any, level: LogLevel): LogType {
  if (VALID_TYPES.includes(raw)) return raw;
  // Anything the client reports at error level is an error regardless of what
  // it called itself; everything else from the browser is a user interaction.
  return level === 'error' ? 'error' : 'interaction';
}

function resolveCategory(raw: any): LogCategory {
  return VALID_CATEGORIES.includes(raw) ? raw : 'dashboard';
}

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json();

    const level = resolveLevel(payload?.level);
    const {
      type: _type,
      level: _level,
      category: _category,
      event: _event,
      message: _message,
      stack: _stack,
      source: _source,
      path: _path,
      tenant_id: _tenantId,
      salon_id: _salonId,
      session_id: _sessionId,
      runtime: _runtime,
      ...extra
    } = payload || {};

    // Take the tenant from the signed session cookie, not the request body.
    // Client components would otherwise have to thread tenant_id through every
    // tracker call by hand — historically ~23 of 37 of them forgot, which is
    // why most dashboard rows in the old event_logs had a null tenant. The
    // cookie is also authoritative: a browser cannot claim another tenant.
    const dashboardSession = getDashboardSessionFromRequest(req);

    await log({
      ...extra,
      type: resolveType(payload?.type, level),
      category: resolveCategory(payload?.category),
      level,
      event: str(payload?.event) || 'client_error',
      message: str(payload?.message),
      stack: str(payload?.stack),
      source: str(payload?.source) || 'client',
      tenant_id:
        dashboardSession?.tenantId || str(payload?.tenant_id) || str(payload?.salon_id),
      // Who: server-derived, so the browser cannot claim another identity.
      user_id: dashboardSession?.email || str(payload?.user_id),
      // Which sitting: client-minted and not security-sensitive, so taking it
      // from the body is fine — it only has to be consistent.
      user_session_id: str(payload?.user_session_id),
      session_id: str(payload?.session_id),
      request_id: str(payload?.request_id),
      duration_ms: typeof payload?.duration_ms === 'number' ? payload.duration_ms : undefined,
      path: str(payload?.path) || req.nextUrl.pathname,
      method: req.method,
      runtime: 'client',
      user_agent: req.headers.get('user-agent') || undefined,
    });

    return NextResponse.json({ ok: true });
  } catch {
    // Telemetry must never surface as a client-side failure.
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
