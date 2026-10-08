/**
 * The test report of the CLI `input test` and the UI server's `/input/test` (SPEC 10.2, 10.3): a signed `inCall` for
 * 30 seconds from the sender `Busy Light test`, sent to the running plugin on 127.0.0.1. The key signs the request
 * and never crosses even the loopback interface.
 */
import { signedAuthorization } from './status-api.js';

export const TEST_SENDER = 'Busy Light test';
export const TEST_TTL_SECONDS = 30;

export type TestResult =
  | { ok: true; status: number; body: Record<string, unknown> }
  | { ok: false; error: 'notListening' | 'unauthorized' | 'other'; status: number | null; message: string };

export interface TestDeps {
  now?: () => number;
  fetch?: typeof fetch;
}

/** Sends the test report and says how it went. Never throws. */
export async function sendTestReport(port: number, key: string, deps: TestDeps = {}): Promise<TestResult> {
  const body = JSON.stringify({ sender: TEST_SENDER, status: 'inCall', ttlSeconds: TEST_TTL_SECONDS });
  const ts = (deps.now ?? Date.now)();
  let res: Response;
  try {
    res = await (deps.fetch ?? fetch)(`http://127.0.0.1:${port}/v1/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: signedAuthorization(key, 'POST', '/v1/status', ts, body) },
      body,
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    const code = (err as { cause?: { code?: string } }).cause?.code;
    if (code === 'ECONNREFUSED') {
      return { ok: false, error: 'notListening', status: null, message: `Nothing is listening on port ${port}.` };
    }
    return { ok: false, error: 'other', status: null, message: code ?? (err as Error).message };
  }
  let answer: Record<string, unknown> = {};
  try {
    answer = await res.json() as Record<string, unknown>;
  } catch {
    // An answer that is not JSON is described by its status below.
  }
  if (res.ok) {
    return { ok: true, status: res.status, body: answer };
  }
  const message = typeof answer.message === 'string' ? answer.message : `HTTP ${res.status}`;
  if (res.status === 401 && answer.error === 'unauthorized') {
    return { ok: false, error: 'unauthorized', status: res.status, message };
  }
  return { ok: false, error: 'other', status: res.status, message };
}
