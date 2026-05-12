type ClientEventPayload = {
  event: string;
  category?: 'dashboard' | 'sms' | 'session' | 'system' | 'auth' | 'tool' | 'ai';
  level?: 'info' | 'warn' | 'error';
  tenant_id?: string;
  session_id?: string;
  [key: string]: any;
};

export function trackClientEvent(payload: ClientEventPayload) {
  try {
    const body = JSON.stringify({
      level: payload.level || 'info',
      category: payload.category || 'dashboard',
      event: payload.event,
      salon_id: payload.tenant_id,
      session_id: payload.session_id,
      path: typeof window !== 'undefined' ? window.location.pathname : null,
      runtime: 'client',
      ...payload,
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
