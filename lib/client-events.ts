/**
 * Client-side logging. Posts to /api/log-error, which writes one app_logs row.
 *
 * Prefer the typed helpers below over calling trackClientEvent directly — they
 * set `type` correctly, which is the axis the logs are queried on.
 */

export type ClientLogType = 'error' | 'timeout' | 'interaction' | 'audit';

export type ClientLogCategory =
  | 'dashboard'
  | 'sms'
  | 'session'
  | 'system'
  | 'auth'
  | 'tool'
  | 'ai'
  | 'billing'
  | 'observer';

type ClientEventPayload = {
  event: string;
  type?: ClientLogType;
  category?: ClientLogCategory;
  level?: 'info' | 'warn' | 'error';
  message?: string;
  stack?: string;
  tenant_id?: string;
  /** Customer CONVERSATION id, not the user's sitting — see user_session_id. */
  session_id?: string;
  duration_ms?: number;
  [key: string]: any;
};

/**
 * Browser-session ("sitting") identity for grouping interaction logs.
 *
 * Distinct from both the 8h/30d auth cookie and from `session_id`, which is the
 * customer conversation. This answers "what did this person do in one go?".
 *
 * Held in sessionStorage so it survives navigation within a tab but not a tab
 * close, and rolled over after IDLE_MS of no activity so an abandoned tab picked
 * up the next morning reads as a new sitting rather than a 12-hour one.
 */
const USER_SESSION_KEY = 'resevia_log_sitting';
const USER_SESSION_SEEN_KEY = 'resevia_log_sitting_seen';
const IDLE_MS = 30 * 60 * 1000;

function getUserSessionId(): string | undefined {
  if (typeof window === 'undefined' || typeof sessionStorage === 'undefined') return undefined;

  try {
    const now = Date.now();
    const existing = sessionStorage.getItem(USER_SESSION_KEY);
    const lastSeen = Number(sessionStorage.getItem(USER_SESSION_SEEN_KEY) || 0);

    if (existing && lastSeen && now - lastSeen < IDLE_MS) {
      sessionStorage.setItem(USER_SESSION_SEEN_KEY, String(now));
      return existing;
    }

    const minted = `sit_${now.toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    sessionStorage.setItem(USER_SESSION_KEY, minted);
    sessionStorage.setItem(USER_SESSION_SEEN_KEY, String(now));
    return minted;
  } catch {
    // Private mode / storage disabled — logging still works, just ungrouped.
    return undefined;
  }
}

export function trackClientEvent(payload: ClientEventPayload) {
  try {
    const { type, category, level, ...rest } = payload;
    const resolvedLevel = level || 'info';

    const body = JSON.stringify({
      ...rest,
      type: type || (resolvedLevel === 'error' ? 'error' : 'interaction'),
      category: category || 'dashboard',
      level: resolvedLevel,
      user_session_id: getUserSessionId(),
      path: typeof window !== 'undefined' ? window.location.pathname : undefined,
      runtime: 'client',
    });

    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const blob = new Blob([body], { type: 'application/json' });
      navigator.sendBeacon('/api/log-error', blob);
      return;
    }

    void fetch('/api/log-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    });
  } catch {
    // never break UI flow for telemetry
  }
}

/** A click, submit, navigation, or the result of one. */
export function trackInteraction(
  event: string,
  context: Omit<ClientEventPayload, 'event' | 'type'> = {}
) {
  trackClientEvent({ ...context, event, type: 'interaction' });
}

/** A failure the user hit in the browser. */
export function trackClientError(
  event: string,
  error: unknown,
  context: Omit<ClientEventPayload, 'event' | 'type' | 'level'> = {}
) {
  const message =
    error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown error';

  trackClientEvent({
    ...context,
    event,
    type: 'error',
    level: 'error',
    message,
    stack: error instanceof Error ? error.stack : undefined,
  });
}

/** A state or settings change made from the dashboard. */
export function trackAudit(
  event: string,
  context: Omit<ClientEventPayload, 'event' | 'type'> = {}
) {
  trackClientEvent({ ...context, event, type: 'audit' });
}
