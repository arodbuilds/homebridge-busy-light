/**
 * Shared test doubles. Nothing here touches the network: tests that need HTTP install a fake `fetch` that answers
 * from routes and throws on anything else.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MSG, header, parseHeader } from '../src/lifx.js';
import type { UdpSocket } from '../src/lifx.js';
import type { Log } from '../src/log.js';

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

export interface LogLine {
  level: 'info' | 'warn' | 'error' | 'debug';
  msg: string;
}

/** A logger that records every line. */
export function fakeLog(): { log: Log; entries: LogLine[]; lines: (level: LogLine['level']) => string[]; all: () => string[] } {
  const entries: LogLine[] = [];
  const make = (level: LogLine['level']) => (msg: string) => {
    entries.push({ level, msg });
  };
  return {
    log: { info: make('info'), warn: make('warn'), error: make('error'), debug: make('debug') },
    entries,
    lines: (level) => entries.filter((l) => l.level === level).map((l) => l.msg),
    all: () => entries.map((l) => l.msg),
  };
}

export interface FakeBulb {
  serial: string;
  label: string;
  host: string;
  answers: boolean;
}

export interface Sent {
  to: string;
  port: number;
  buf: Buffer;
}

/** A network of simulated bulbs. Nothing is sent anywhere: replies are delivered to the socket that asked. */
export class FakeNetwork {
  bulbs: FakeBulb[] = [];
  sent: Sent[] = [];
  /** When set, acknowledgements carry this sequence instead of the request's. */
  wrongSequence = false;
  sockets = 0;
  closed = 0;

  factory = (): UdpSocket => {
    let listener: ((msg: Buffer, from: string) => void) | null = null;
    this.sockets++;
    return {
      onMessage: (l) => {
        listener = l;
      },
      bind: async () => undefined,
      setBroadcast: () => undefined,
      send: async (buf, port, to) => {
        this.sent.push({ to, port, buf: Buffer.from(buf) });
        const h = parseHeader(buf)!;
        for (const bulb of this.bulbs) {
          const reaches = to === bulb.host || to === '255.255.255.255' || (to.endsWith('.255') && bulb.host.startsWith(to.slice(0, -3)));
          const addressed = h.tagged || h.serial === bulb.serial;
          if (!reaches || !addressed) {
            continue;
          }
          const reply = (msg: Buffer) => setImmediate(() => listener?.(msg, bulb.host));
          if (h.type === MSG.GetService) {
            const msg = header(41, MSG.StateService, { serial: bulb.serial, sequence: h.sequence, ackRequired: false });
            msg.writeUInt8(1, 36);
            msg.writeUInt32LE(56700, 37);
            reply(msg);
          } else if (h.type === MSG.GetLabel) {
            const msg = header(68, MSG.StateLabel, { serial: bulb.serial, sequence: h.sequence, ackRequired: false });
            Buffer.from(bulb.label, 'utf8').copy(msg, 36);
            reply(msg);
          } else if ((buf.readUInt8(22) & 2) && bulb.answers) {
            const sequence = this.wrongSequence ? (h.sequence + 128) & 0xff : h.sequence;
            reply(header(36, MSG.Acknowledgement, { serial: bulb.serial, sequence, ackRequired: false }));
          }
        }
      },
      close: () => {
        this.closed++;
      },
    };
  };

  typesTo(host: string): number[] {
    return this.sent.filter((s) => s.to === host).map((s) => parseHeader(s.buf)!.type);
  }
}

/** Lets pending promises and immediates run. */
export async function settle(rounds = 20): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise((r) => setImmediate(r));
  }
}

interface FakeTimer {
  id: number;
  at: number;
  every: number | null;
  fn: () => void;
}

/** A clock whose timers fire only when the test advances it. */
export class FakeClock {
  private timers: FakeTimer[] = [];
  private nextId = 1;

  constructor(public t: number) {}

  now = (): number => this.t;

  setTimeout = (fn: () => void, ms: number): unknown => {
    const id = this.nextId++;
    this.timers.push({ id, at: this.t + Math.max(0, ms), every: null, fn });
    return id;
  };

  setInterval = (fn: () => void, ms: number): unknown => {
    const id = this.nextId++;
    this.timers.push({ id, at: this.t + ms, every: ms, fn });
    return id;
  };

  clearTimeout = (id: unknown): void => {
    this.timers = this.timers.filter((t) => t.id !== id);
  };

  clearInterval = (id: unknown): void => {
    this.clearTimeout(id);
  };

  /** Timers due within `ms` from now, earliest first, without firing them. */
  pending(): { at: number; every: number | null }[] {
    return this.timers.map((t) => ({ at: t.at, every: t.every })).sort((a, b) => a.at - b.at);
  }

  /** Moves time forward, firing due timers in order and letting their async work settle. */
  async advance(ms: number): Promise<void> {
    const target = this.t + ms;
    for (;;) {
      const due = this.timers.filter((t) => t.at <= target).sort((a, b) => a.at - b.at)[0];
      if (!due) {
        break;
      }
      this.t = Math.max(this.t, due.at);
      if (due.every) {
        due.at += due.every;
      } else {
        this.timers = this.timers.filter((t) => t !== due);
      }
      due.fn();
      await settle();
    }
    this.t = target;
    await settle();
  }
}


/** A small calendar in UTC: each entry is [uid, start, end, extra lines]. */
export function icsOf(events: [string, number, number, string[]?][]): string {
  const stamp = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Busy Light tests//Synthetic//EN'];
  for (const [uid, start, end, extra] of events) {
    lines.push('BEGIN:VEVENT', `UID:${uid}`, `SUMMARY:Synthetic ${uid}`, `DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`, ...(extra ?? []), 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
