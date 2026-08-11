import { logError } from './lib/logger';

let registered = false;

export async function register() {
  if (registered || typeof process === 'undefined') return;
  registered = true;

  process.on('unhandledRejection', (reason) => {
    logError('system', 'unhandled_rejection', reason, {
      source: 'process.unhandledRejection',
      reason_type: typeof reason,
    });
  });

  process.on('uncaughtException', (error) => {
    logError('system', 'uncaught_exception', error, {
      source: 'process.uncaughtException',
    });
  });
}
