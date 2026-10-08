/**
 * Shared test doubles. Nothing here touches the network: tests that need HTTP install a fake `fetch` that answers
 * from routes and throws on anything else.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// Fixtures live next to the TS source; tests run from build-test/, so walk up.
export const fixturesDir = path.resolve(here, '..', '..', 'test', 'fixtures');

export function fixture(name: string): string {
  return fs.readFileSync(path.join(fixturesDir, name), 'utf8');
}

/** Every SUMMARY in the iCalendar fixtures: none of these may ever reach a log line or the state file. */
export function fixtureTitles(): string[] {
  const titles = new Set<string>();
  for (const name of fs.readdirSync(fixturesDir, { recursive: true }) as string[]) {
    const file = path.join(fixturesDir, name);
    if (!fs.statSync(file).isFile()) {
      continue;
    }
    for (const m of fs.readFileSync(file, 'utf8').matchAll(/^SUMMARY[^:\r\n]*:(.+?)(?:&#13;)?\r?$/gm)) {
      const title = m[1].trim();
      titles.add(file.endsWith('.xml') ? title.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&') : title);
    }
  }
  return [...titles];
}

export function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

export function text(body: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers });
}

export function redirect(location: string, status = 302): Response {
  return new Response(null, { status, headers: { location } });
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
      const body = typeof init.body === 'string' ? init.body : init.body instanceof URLSearchParams ? init.body.toString() : null;
      const call: Call = { url, init, method: (init.method ?? 'GET').toUpperCase(), headers, body };
      this.calls.push(call);
      const bare = url.split('?')[0];
      const hit = this.routes.filter(([prefix]) => bare.startsWith(prefix)).sort((a, b) => b[0].length - a[0].length)[0];
      if (!hit) {
        throw new Error(`unexpected fetch ${call.method} ${url}`);
      }
      const index = this.calls.filter((c) => c.url.split('?')[0].startsWith(hit[0])).length - 1;
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

/** A fetch that fails the way undici does when the network is unreachable. */
export function networkError(code: string): never {
  const err = new TypeError('fetch failed') as TypeError & { cause: { code: string } };
  err.cause = { code };
  throw err;
}
