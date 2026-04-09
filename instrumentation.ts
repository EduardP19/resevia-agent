import { logAppError, toErrorLogPayload } from './lib/error-logger';

let registered = false;

export async function register() {
  if (registered || typeof process === 'undefined') return;
  registered = true;

  process.on('unhandledRejection', (reason) => {
    const payload = toErrorLogPayload(reason, 'Unhandled rejection');
    void logAppError({
      source: 'process.unhandledRejection',
      message: payload.message,
      stack: payload.stack || undefined,
      context: { reasonType: typeof reason },
      runtime: 'server',
    });
  });

  process.on('uncaughtException', (error) => {
    const payload = toErrorLogPayload(error, 'Uncaught exception');
    void logAppError({
      source: 'process.uncaughtException',
      message: payload.message,
      stack: payload.stack || undefined,
      runtime: 'server',
    });
  });
}
