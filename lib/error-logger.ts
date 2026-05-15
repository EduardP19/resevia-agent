import { supabase } from './supabase';
import { log } from './logger';

type LogLevel = 'error' | 'warn' | 'info';
type SystemLogLevel = 'info' | 'warning' | 'error' | 'critical';
type SystemLogSource = 'edge_function' | 'sms_webhook' | 'ai_call' | 'auth' | 'billing' | 'cron';

export type AppErrorLogInput = {
  source: string;
  message?: string;
  level?: LogLevel;
  stack?: string;
  context?: Record<string, any> | null;
  path?: string;
  method?: string;
  session_id?: string;
  salon_id?: string;
  client_identifier?: string;
  user_agent?: string;
  runtime?: 'server' | 'client' | string;
};

function truncate(value: string, max = 4000) {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function mapSystemLogLevel(level?: LogLevel): SystemLogLevel {
  if (level === 'warn') return 'warning';
  if (level === 'info') return 'info';
  return 'error';
}

function mapSystemLogSource(source: string): SystemLogSource {
  const normalized = source.toLowerCase();
  if (normalized.includes('sms-webhook') || normalized.includes('sms_webhook')) return 'sms_webhook';
  if (normalized.includes('cron')) return 'cron';
  if (normalized.includes('billing')) return 'billing';
  if (normalized.includes('auth')) return 'auth';
  if (normalized.includes('ai') || normalized.includes('agent')) return 'ai_call';
  return 'edge_function';
}

export function toErrorLogPayload(error: unknown, fallbackMessage = 'Unknown error') {
  if (error instanceof Error) {
    return {
      message: error.message || fallbackMessage,
      stack: error.stack || null,
    };
  }

  if (typeof error === 'string') {
    return { message: error || fallbackMessage, stack: null };
  }

  try {
    return { message: JSON.stringify(error) || fallbackMessage, stack: null };
  } catch {
    return { message: fallbackMessage, stack: null };
  }
}

export async function logDashboardEvent(payload: {
  event: string;
  category?: string;
  level?: LogLevel;
  tenant_id?: string;
  session_id?: string;
  path?: string;
  [key: string]: any;
}) {
  try {
    await supabase.from('system_logs').insert({
      tenant_id: payload.tenant_id || null,
      level: payload.level === 'warn' ? 'warning' : payload.level === 'error' ? 'error' : 'info',
      source: 'dashboard_event',
      message: payload.event,
      session_id: payload.session_id || null,
      metadata: {
        category: payload.category || 'dashboard',
        path: payload.path || null,
        ...Object.fromEntries(
          Object.entries(payload).filter(([k]) =>
            !['event', 'category', 'level', 'tenant_id', 'session_id', 'path'].includes(k)
          )
        ),
      },
    });
  } catch (e) {
    console.error('[Dashboard Event Logger Failed]', e);
  }
}

export async function logAppError(input: AppErrorLogInput) {
  try {
    // Mirror to GCP + event_logs via the unified log() path
    void log({
      level: input.level === 'warn' ? 'warning' : (input.level as any) || 'error',
      category: 'system',
      event: input.source,
      tenant_id: input.salon_id,
      session_id: input.session_id,
      error: input.message,
      stack: input.stack,
      path: input.path,
      method: input.method,
      runtime: input.runtime,
      ...(input.context || {}),
    }).catch((err) => console.error('logAppError GCP mirror failed:', err));

    const systemPayload = {
      tenant_id: input.salon_id || null,
      level: mapSystemLogLevel(input.level),
      source: mapSystemLogSource(input.source || 'unknown'),
      message: truncate(input.message || 'Unknown error'),
      session_id: input.session_id || null,
      metadata: {
        stack: input.stack ? truncate(input.stack, 12000) : null,
        context: input.context || {},
        path: input.path || null,
        method: input.method || null,
        client_identifier: input.client_identifier || null,
        user_agent: input.user_agent || null,
        runtime: input.runtime || 'server',
        original_source: truncate(input.source || 'unknown', 255),
      },
    };

    await supabase.from('system_logs').insert(systemPayload);

    const payload = {
      level: input.level || 'error',
      source: truncate(input.source || 'unknown', 255),
      message: truncate(input.message || 'Unknown error'),
      stack: input.stack ? truncate(input.stack, 12000) : null,
      context: input.context || {},
      path: input.path || null,
      method: input.method || null,
      session_id: input.session_id || null,
      salon_id: input.salon_id || null,
      client_identifier: input.client_identifier || null,
      user_agent: input.user_agent || null,
      runtime: input.runtime || 'server',
    };

    // Canonical durable error table.
    await supabase.from('error_logs').insert(payload);

    // Keep legacy logs for now while parts of the app still look at app_error_logs.
    await supabase.from('app_error_logs').insert(payload);
  } catch (logError) {
    console.error('[App Error Logger Failed]', logError);
  }
}
