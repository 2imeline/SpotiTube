// Sends UI errors to the persistent diagnostics log (Settings → About → Copy diagnostics).
import { call, isTauri } from '../api/transport';

let sent = 0;
let windowStart = 0;
let last = '';

export function logError(where: string, e: unknown) {
  const msg = e instanceof Error ? `${e.message}${e.stack ? '\n' + e.stack.split('\n').slice(1, 6).join('\n') : ''}` : String(e);
  const line = `${where}: ${msg}`;
  if (line === last) return;
  last = line;
  const now = Date.now();
  if (now - windowStart > 60_000) {
    windowStart = now;
    sent = 0;
  }
  if (++sent > 20 || !isTauri) return;
  call('log_error', { message: line }).catch(() => {});
}

export function installErrorLogging() {
  window.addEventListener('error', (e) => logError('error', e.error ?? e.message));
  window.addEventListener('unhandledrejection', (e) => logError('unhandled', e.reason));
}
