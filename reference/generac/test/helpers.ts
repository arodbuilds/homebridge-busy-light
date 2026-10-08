/**
 * Shared test doubles. Nothing here touches the network: every test installs
 * a fake `fetch` that answers from these routes and throws on anything else.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RawApparatusDetail, StoredCredentials } from '../src/types.js';
import { DPoPKey } from '../src/auth.js';

export const TOKEN_URL = 'https://auth.ecobee.com/oauth/token';
export const API_BASE = 'https://app.mobilelinkgen.com/api/v5';

const here = path.dirname(fileURLToPath(import.meta.url));
// Fixtures live next to the TS source; tests run from build-test/, so walk up.
export const fixturesDir = path.resolve(here, '..', '..', 'test', 'fixtures');

export function loadFixture(name: string): RawApparatusDetail {
  return JSON.parse(fs.readFileSync(path.join(fixturesDir, name), 'utf8')) as RawApparatusDetail;
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

export function redirect(location: string, setCookie?: string[]): Response {
  const headers = new Headers({ location });
  for (const c of setCookie ?? []) {
    headers.append('set-cookie', c);
  }
  return new Response(null, { status: 302, headers });
}

export function html(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/html' } });
}

export interface Call {
  url: string;
  init: RequestInit;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

export type Route = (call: Call, index: number) => Response | Promise<Response>;

/** Install a fake fetch. Routes are matched by URL prefix (without query string), longest prefix first. */
export class FakeFetch {
  readonly calls: Call[] = [];
  private readonly routes: [string, Route][] = [];
  private readonly original = globalThis.fetch;

  constructor() {
    globalThis.fetch = (async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const headers: Record<string, string> = {};
      for (const [k, v] of new Headers(init.headers ?? {})) {
        headers[k.toLowerCase()] = v;
      }
      const call: Call = { url, init, method: (init.method ?? 'GET').toUpperCase(), headers, body: typeof init.body === 'string' ? init.body : null };
      this.calls.push(call);
      const bare = url.split('?')[0];
      // Longest matching prefix wins, so /authorize/resume beats /authorize.
      const hit = this.routes.filter(([prefix]) => bare.startsWith(prefix)).sort((a, b) => b[0].length - a[0].length)[0];
      if (!hit) {
        throw new Error(`unexpected fetch ${call.method} ${url}`);
      }
      const index = this.calls.filter((c) => c.url.split('?')[0] === bare).length - 1;
      return hit[1](call, index);
    }) as typeof fetch;
  }

  on(prefix: string, route: Route): this {
    this.routes.unshift([prefix, route]);
    return this;
  }

  callsTo(prefix: string): Call[] {
    return this.calls.filter((c) => c.url.split('?')[0].startsWith(prefix));
  }

  restore(): void {
    globalThis.fetch = this.original;
  }
}

/** A token endpoint that always succeeds. */
export function tokenRoute(fetcher: FakeFetch, opts: { expiresIn?: number; delayMs?: number } = {}): void {
  fetcher.on(TOKEN_URL, async (_call, index) => {
    if (opts.delayMs) {
      await new Promise((r) => setTimeout(r, opts.delayMs));
    }
    return json({ access_token: `access-${index}`, expires_in: opts.expiresIn ?? 7200, token_type: 'Bearer' });
  });
}

export function makeCredentials(overrides: Partial<StoredCredentials> = {}): StoredCredentials {
  return {
    email: 'you@example.com',
    refresh_token: 'refresh-token-value',
    dpop_private_key_pem: DPoPKey.generate().toPem(),
    created_at: '2026-09-15T15:22:34Z',
    ...overrides,
  };
}

export function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
}

export interface LogLine {
  level: string;
  msg: string;
}

/** A Homebridge-shaped logger that records every line. */
export function fakeLogger(): { log: LogLine[]; logger: import('homebridge').Logger; lines: (level: string) => string[] } {
  const log: LogLine[] = [];
  const make = (level: string) => (msg: string) => {
    log.push({ level, msg });
  };
  const logger = Object.assign(make('log'), {
    prefix: 'Generac',
    info: make('info'),
    success: make('success'),
    warn: make('warn'),
    error: make('error'),
    debug: make('debug'),
    log: (level: string, msg: string) => log.push({ level, msg }),
  }) as unknown as import('homebridge').Logger;
  return { log, logger, lines: (level) => log.filter((l) => l.level === level).map((l) => l.msg) };
}

/**
 * Values a failed sign-in page can carry that must never reach a terminal, a log or a debug file (SPEC section 12).
 * Shared by test/cli-auth0-stub.ts, which serves the page, and the CLI tests that look for them.
 */
export const PAGE_SECRETS = {
  state: 'hKFo2SBxU2VjcmV0U3RhdGVWYWx1ZUZvclRlc3Q',
  code: 'Qm9ndXNDb2RlVmFsdWVGb3JUZXN0MTIzNDU2',
  token: 'eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.c2lnbmF0dXJlVmFsdWU',
};

/** An Auth0 password page answering a wrong password, with the state, a code and a token in it. */
export function failedPasswordPage(): string {
  const { state, code, token } = PAGE_SECRETS;
  return [
    '<!DOCTYPE html><html><body>',
    `<form method="POST" action="/u/login/password?state=${state}">`,
    `<input type="hidden" name="state" value="${state}">`,
    '<input type="text" name="username" value="you@example.com">',
    '<span class="ulp-input-error-message" data-error-code="wrong-credentials">Wrong email or password</span>',
    `<a href="/authorize/resume?client_id=c&amp;code=${code}">Continue</a>`,
    `<script>window.__cfg = {"state":"${state}","access_token":"${token}"};</script>`,
    '</form></body></html>',
  ].join('\n');
}
