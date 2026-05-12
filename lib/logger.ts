import { Logging } from '@google-cloud/logging';

type LogLevel = 'info' | 'warning' | 'error';

type LogCategory =
  | 'sms'
  | 'ai'
  | 'tool'
  | 'session'
  | 'dashboard'
  | 'auth'
  | 'system';

export interface LogEvent {
  level: LogLevel;
  category: LogCategory;
  event: string;
  tenant_id?: string;
  session_id?: string;
  error?: string;
  stack?: string;
  [key: string]: any;
}

let loggingClient: Logging | null = null;

const SENSITIVE_KEY_PATTERN = /token|secret|password|authorization|auth|credential|private[_-]?key|api[_-]?key/i;

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

function sanitizeForLogs(value: any, key = ''): any {
  if (SENSITIVE_KEY_PATTERN.test(key)) return '[redacted]';

  if (key === 'body' && process.env.NODE_ENV === 'production') {
    const length = typeof value === 'string' ? value.length : 0;
    return `[redacted:${length}]`;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForLogs(item));
  }

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

export async function log(data: LogEvent) {
  try {
    const payload = sanitizeForLogs({
      ...data,
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV,
    });

    console.log(JSON.stringify(payload));

    await sendToGCP(payload);
  } catch (err) {
    console.error('Logger failed:', err);
  }
}

export function safeLog(data: LogEvent) {
  try {
    void log(data).catch((err) => console.error('Log call failed:', err));
  } catch (err) {
    console.error('Log call failed:', err);
  }
}

async function sendToGCP(payload: LogEvent & { timestamp: string; environment: string | undefined }) {
  const client = getLoggingClient();
  if (!client) return;

  const gcpLog = client.log('resevia-logs');
  const severity = payload.level === 'error' ? 'ERROR' : payload.level === 'warning' ? 'WARNING' : 'INFO';
  const entry = gcpLog.entry(
    { severity, labels: { category: payload.category, environment: payload.environment || 'unknown' } },
    payload
  );
  await gcpLog.write(entry);
}
