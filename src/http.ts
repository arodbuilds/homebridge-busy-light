/**
 * HTTP with the built-in fetch (SPEC 5): a 20 second timeout, short reasons that name only the host, Retry-After,
 * and bodies read with a size limit.
 */
import { SourceError } from './errors.js';

export const HTTP_TIMEOUT_MS = 20_000;

/** The host name of an address, for log lines and errors. Never the path or query. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host || 'the server';
  } catch {
    return 'the server';
  }
}

interface ErrorWithCause {
  name?: string;
  code?: string;
  cause?: ErrorWithCause;
}

/** A short reason for a failed request that names the host only. */
export function describeNetworkError(err: unknown, host: string): string {
  const e = (err ?? {}) as ErrorWithCause;
  if (e.name === 'TimeoutError' || e.name === 'AbortError') {
    return `no answer from ${host} within ${HTTP_TIMEOUT_MS / 1000} seconds`;
  }
  const code = e.cause?.code ?? e.code ?? '';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return `${host} could not be found`;
  }
  if (code === 'ECONNREFUSED') {
    return `${host} refused the connection`;
  }
  if (/CERT|SSL|TLS|SELF_SIGNED|UNABLE_TO_VERIFY/i.test(code)) {
    return `${host} has a certificate problem`;
  }
  return `could not connect to ${host}`;
}

/** Retry-After as milliseconds, from seconds or an HTTP date. Null when absent or unreadable. */
export function retryAfterMs(header: string | null, now: number): number | null {
  if (!header) {
    return null;
  }
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed) * 1000;
  }
  const at = Date.parse(trimmed);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}

/** fetch with the timeout. A network failure becomes a "notReachable" SourceError naming the host. */
export async function send(url: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
  } catch (err) {
    throw new SourceError('notReachable', describeNetworkError(err, hostOf(url)));
  }
}

/** The body as text, refusing anything over `limit` bytes whether or not Content-Length says so. */
export async function readLimited(res: Response, limit: number, tooLarge: string): Promise<string> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) {
    await res.body?.cancel().catch(() => undefined);
    throw new SourceError('notReachable', tooLarge);
  }
  if (!res.body) {
    return '';
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      throw new SourceError('notReachable', tooLarge);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}
