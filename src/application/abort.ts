// Derives a signal that also fires after `ms`, so a stalled model call cannot hang a
// task forever. Callers tell a timeout apart from a user abort by checking `parent.aborted`.
export function withTimeout(parent: AbortSignal, ms: number): AbortSignal {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  const forward = () => { clearTimeout(timer); controller.abort(); };
  if (parent.aborted) forward(); else parent.addEventListener('abort', forward, { once: true });
  controller.signal.addEventListener('abort', () => { clearTimeout(timer); parent.removeEventListener('abort', forward); }, { once: true });
  return controller.signal;
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

export const structuredCallTimeoutMs = 90_000;
