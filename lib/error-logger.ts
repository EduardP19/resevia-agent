import { supabase } from './supabase';

type LogLevel = 'error' | 'warn' | 'info';

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

export async function logAppError(input: AppErrorLogInput) {
  try {
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

    await supabase.from('app_error_logs').insert(payload);
  } catch (logError) {
    console.error('[App Error Logger Failed]', logError);
  }
}
