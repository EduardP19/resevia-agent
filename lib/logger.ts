import { Logging } from '@google-cloud/logging';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createClient } from '@supabase/supabase-js';

/**
 * Unified application logger.
 *
 * Every app-side log lands in a single `app_logs` row, classified by `type`
 * (what kind of thing happened) with `category` as the subsystem sub-axis.
 * This replaces the old event_logs / system_logs / error_logs split, which
 * divided logs by severity — an axis nothing ever queried — and wrote the same
 * dashboard clickstream into two tables at once.
 *
 * Website analytics live in `public.logs` and belong to the marketing site.
 * Nothing here writes to that table.
 *
 * Log the event and its timing, never the state. Delivery status and price
 * belong in `sms_messages`, token spend in `token_usage`, message content in
 * `transcripts`, bookings in `bookings`.
 */

export type LogType =
  /** Something failed. */
  | 'error'
  /** An external call exceeded its threshold (may still have succeeded). */
  | 'timeout'
  /** A person did something in the dashboard. */
  | 'interaction'
  /** An outbound call to Gemini / Cal.com / Twilio, with duration + outcome. */
  | 'integration'
  /** A scheduled job started or finished. */
  | 'job'
  /** A state or config change worth attributing. */
  | 'audit';

export type LogLevel = 'info' | 'warning' | 'error';

export type LogCategory =
  | 'sms'
  | 'ai'
  | 'tool'
  | 'session'
  | 'dashboard'
  | 'auth'
  | 'billing'
  | 'observer'
  | 'system';

export interface LogEntry {
  type: LogType;
  category: LogCategory;
  /** Stable machine name for grouping, e.g. `sms_send_failed`. Never the error text. */
  event: string;
  level?: LogLevel;
  /** Human-readable detail for this occurrence, e.g. the exception message. */
  message?: string;
  /** Origin identifier, e.g. `lib.twilio.sendSMS`. */
  source?: string;
  tenant_id?: string;
  /** Customer CONVERSATION id (FK to public.sessions), not a dashboard sitting. */
  session_id?: string;
  /** Dashboard user (email). Derive from the session cookie, never from a request body. */
  user_id?: string;
  /** Groups one dashboard browsing sitting. Client-minted — see lib/client-events.ts. */
  user_session_id?: string;
  request_id?: string;
  duration_ms?: number;
  runtime?: 'server' | 'client' | string;
  path?: string;
  method?: string;
  stack?: string;
  /** Anything else is folded into the `metadata` jsonb column. */
  [key: string]: any;
}

/** Calls slower than this are typed `timeout` even when they eventually return. */
const SLOW_CALL_MS = Number(process.env.LOG_SLOW_CALL_MS || 5000);

let loggingClient: Logging | null = null;
let supabaseClient: ReturnType<typeof createClient> | null = null;

// ---------------------------------------------------------------------------
// Request correlation
// ---------------------------------------------------------------------------

interface RequestContext {
  request_id: string;
  tenant_id?: string;
  session_id?: string;
  path?: string;
}

const requestStore = new AsyncLocalStorage<RequestContext>();

/**
 * Runs `fn` with a correlation id attached to every log emitted inside it, so
 * one inbound message's rows (`sms_received` → `ai_call` → `tool_called` →
 * `sms_sent`) can be pulled back as an ordered turn instead of four unrelated
 * rows. Ids set explicitly on a call always win over the ambient ones.
 */
export function withRequestContext<T>(context: Partial<RequestContext>, fn: () => T): T {
  return requestStore.run(
    {
      request_id: context.request_id || newRequestId(),
      tenant_id: context.tenant_id,
      session_id: context.session_id,
      path: context.path,
    },
    fn
  );
}

export function newRequestId(): string {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function getRequestContext(): RequestContext | undefined {
  return requestStore.getStore();
}

/**
 * Attaches ids to the current request context once they're known.
 *
 * Inbound webhooks can't supply a tenant up front — the salon is only resolved
 * after parsing the payload. Calling this straight after that lookup means
 * every later log in the request (AI call, tool call, Twilio send) carries the
 * tenant without each one having to be passed it by hand.
 */
export function setRequestContext(context: Partial<Omit<RequestContext, 'request_id'>>): void {
  const store = requestStore.getStore();
  if (!store) return;
  if (context.tenant_id) store.tenant_id = context.tenant_id;
  if (context.session_id) store.session_id = context.session_id;
  if (context.path) store.path = context.path;
}

export function getRequestId(): string | undefined {
  return requestStore.getStore()?.request_id;
}

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

const SENSITIVE_KEY_PATTERN =
  /token|secret|password|authorization|auth|credential|private[_-]?key|api[_-]?key/i;

/**
 * Customer phone numbers are personal data and were previously landing in logs
 * unredacted across 15 event types — including dashboard `page_view` rows,
 * because the client route path is `/dashboard/client/[phone]`.
 *
 * Numbers are masked rather than dropped: the last four digits are kept so a
 * conversation can still be matched up during support, without storing the
 * full number. Requires a leading `+` (or its URL-encoded form) so that plain
 * 13-digit values like `Date.now()` are left alone.
 */
const PHONE_PATTERN = /(\+|%2B)\d{7,15}/gi;

function maskPhoneNumbers(value: string): string {
  return value.replace(PHONE_PATTERN, (match) => {
    const digits = match.replace(/^(\+|%2B)/i, '');
    if (digits.length <= 4) return `+${'*'.repeat(digits.length)}`;
    return `+${'*'.repeat(digits.length - 4)}${digits.slice(-4)}`;
  });
}

function sanitizeForLogs(value: any, key = ''): any {
  if (SENSITIVE_KEY_PATTERN.test(key)) return '[redacted]';

  if (key === 'body' && process.env.NODE_ENV === 'production') {
    const length = typeof value === 'string' ? value.length : 0;
    return `[redacted:${length}]`;
  }

  if (typeof value === 'string') return maskPhoneNumbers(value);

  if (Array.isArray(value)) return value.map((item) => sanitizeForLogs(item));

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        sanitizeForLogs(entryValue, entryKey),
      ])
    );
  }

  return value;
}

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

function getLoggingClient(): Logging | null {
  if (!process.env.GCP_LOGGING_CREDENTIALS || !process.env.GCP_PROJECT_ID) return null;
  if (!loggingClient) {
    try {
      const credentials = JSON.parse(process.env.GCP_LOGGING_CREDENTIALS);
      loggingClient = new Logging({ projectId: process.env.GCP_PROJECT_ID, credentials });
    } catch (e) {
      console.error('GCP logger init failed:', e);
      return null;
    }
  }
  return loggingClient;
}

function getSupabaseClient(): ReturnType<typeof createClient> | null {
  if (
    !process.env.SUPABASE_URL ||
    (!process.env.SUPABASE_SERVICE_ROLE_KEY && !process.env.SUPABASE_ANON_KEY)
  ) {
    return null;
  }
  if (!supabaseClient) {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY!;
    supabaseClient = createClient(process.env.SUPABASE_URL, key);
  }
  return supabaseClient;
}

// ---------------------------------------------------------------------------
// Core write path
// ---------------------------------------------------------------------------

/** Columns on `app_logs`. Everything else on a LogEntry falls through to metadata. */
const COLUMN_KEYS = new Set([
  'type',
  'category',
  'level',
  'event',
  'message',
  'source',
  'tenant_id',
  'session_id',
  'user_id',
  'user_session_id',
  'request_id',
  'duration_ms',
  'environment',
  'runtime',
  'path',
  'method',
  'stack',
]);

export async function log(entry: LogEntry): Promise<void> {
  try {
    const ambient = requestStore.getStore();

    const resolved = sanitizeForLogs({
      ...entry,
      level: entry.level || (entry.type === 'error' ? 'error' : 'info'),
      tenant_id: entry.tenant_id || ambient?.tenant_id,
      session_id: entry.session_id || ambient?.session_id,
      request_id: entry.request_id || ambient?.request_id,
      path: entry.path || ambient?.path,
      runtime: entry.runtime || 'server',
      environment: process.env.NODE_ENV,
      timestamp: new Date().toISOString(),
    });

    console.log(JSON.stringify(resolved));

    await Promise.allSettled([sendToGCP(resolved), sendToSupabase(resolved)]);
  } catch (err) {
    console.error('Logger failed:', err);
  }
}

/** Fire-and-forget. Use this everywhere except where the write must complete. */
export function safeLog(entry: LogEntry): void {
  try {
    void log(entry).catch((err) => console.error('Log call failed:', err));
  } catch (err) {
    console.error('Log call failed:', err);
  }
}

async function sendToGCP(payload: Record<string, any>): Promise<void> {
  const client = getLoggingClient();
  if (!client) return;

  const gcpLog = client.log('resevia-logs');
  const severity =
    payload.level === 'error' ? 'ERROR' : payload.level === 'warning' ? 'WARNING' : 'INFO';

  const entry = gcpLog.entry(
    {
      severity,
      labels: {
        type: payload.type || 'unknown',
        category: payload.category || 'system',
        environment: payload.environment || 'unknown',
      },
    },
    payload
  );
  await gcpLog.write(entry);
}

async function sendToSupabase(payload: Record<string, any>): Promise<void> {
  const client = getSupabaseClient();
  if (!client) return;

  const row: Record<string, any> = { metadata: {} };

  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined || key === 'timestamp') continue;
    if (COLUMN_KEYS.has(key)) row[key] = value;
    else row.metadata[key] = value;
  }

  // Ids are nullable FKs; empty strings would fail the uuid cast.
  row.tenant_id = row.tenant_id || null;
  row.session_id = row.session_id || null;

  const { error } = await (client as any).from('app_logs').insert(row);

  // A failed log write must never be silent — that is how the dead
  // app_error_logs write survived unnoticed for months.
  if (error) console.error('app_logs insert failed:', error.message, row.event);
}

// ---------------------------------------------------------------------------
// Typed helpers — prefer these over calling safeLog directly
// ---------------------------------------------------------------------------

type Context = Omit<LogEntry, 'type' | 'category' | 'event' | 'level'>;

export function logError(
  category: LogCategory,
  event: string,
  error: unknown,
  context: Context = {}
): void {
  const { message, stack } = describeError(error);
  safeLog({ ...context, type: 'error', level: 'error', category, event, message, stack });
}

export function logTimeout(
  category: LogCategory,
  event: string,
  duration_ms: number,
  context: Context = {}
): void {
  safeLog({
    ...context,
    type: 'timeout',
    level: 'warning',
    category,
    event,
    duration_ms,
    threshold_ms: SLOW_CALL_MS,
  });
}

export function logInteraction(event: string, context: Context & { category?: LogCategory } = {}): void {
  const { category = 'dashboard', ...rest } = context;
  safeLog({ ...rest, type: 'interaction', category, event });
}

export function logIntegration(
  category: LogCategory,
  event: string,
  context: Context = {}
): void {
  safeLog({ ...context, type: 'integration', category, event });
}

export function logJob(event: string, context: Context = {}): void {
  safeLog({ ...context, type: 'job', category: 'system', event });
}

export function logAudit(
  category: LogCategory,
  event: string,
  context: Context = {}
): void {
  safeLog({ ...context, type: 'audit', category, event });
}

export function describeError(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return { message: error.message || 'Unknown error', stack: error.stack };
  }
  if (typeof error === 'string') return { message: error || 'Unknown error' };
  try {
    return { message: JSON.stringify(error) || 'Unknown error' };
  } catch {
    return { message: 'Unknown error' };
  }
}

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------

interface TimedCall<T = any> extends Context {
  category: LogCategory;
  /** Stable name, e.g. `gemini_generate` or `cal_create_booking`. */
  event: string;
  /** Override the global slow-call threshold for calls known to be slow. */
  threshold_ms?: number;
  /**
   * Pulls fields off a successful result into the log — a message SID, a
   * booking uid, a token count. Keeps one log per call instead of a separate
   * success write alongside the timing one.
   */
  enrich?: (result: T) => Record<string, any>;
}

/**
 * Times an outbound call and logs the outcome.
 *
 * Emits `integration` on success, `timeout` when it ran past the threshold but
 * still returned, and `error` when it threw (with the elapsed time attached, so
 * a genuine hang is distinguishable from an instant rejection). The original
 * error is always rethrown — this only observes.
 *
 * Before this existed nothing in the app measured elapsed time anywhere, so a
 * slow external call was invisible until it failed outright.
 */
export async function withTiming<T>(spec: TimedCall<T>, fn: () => Promise<T>): Promise<T> {
  const { category, event, threshold_ms = SLOW_CALL_MS, enrich, ...context } = spec;
  const startedAt = Date.now();

  try {
    const result = await fn();
    const duration_ms = Date.now() - startedAt;

    let enriched: Record<string, any> = {};
    if (enrich) {
      // A broken enricher must not lose the log or fail the caller's call.
      try {
        enriched = enrich(result) || {};
      } catch (err) {
        enriched = { enrich_failed: describeError(err).message };
      }
    }

    if (duration_ms >= threshold_ms) {
      safeLog({
        ...context,
        ...enriched,
        type: 'timeout',
        level: 'warning',
        category,
        event,
        duration_ms,
        threshold_ms,
        outcome: 'slow_success',
      });
    } else {
      safeLog({
        ...context,
        ...enriched,
        type: 'integration',
        category,
        event,
        duration_ms,
        outcome: 'success',
      });
    }

    return result;
  } catch (error) {
    const duration_ms = Date.now() - startedAt;
    const { message, stack } = describeError(error);

    safeLog({
      ...context,
      type: duration_ms >= threshold_ms ? 'timeout' : 'error',
      level: 'error',
      category,
      event,
      message,
      stack,
      duration_ms,
      threshold_ms,
      outcome: 'failed',
    });

    throw error;
  }
}
