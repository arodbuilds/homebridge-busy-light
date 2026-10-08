/**
 * The status API of SPEC section 18 (18.3 to 18.8): a Node `http` server on the local network that lets any app
 * report a status. Node built-ins only. The request handler is a plain function of a request and a response, so the
 * tests call it directly and no test opens a socket.
 *
 * Checks run in the order of 18.4 item 8: local address, rate limit, path and method, size, media type,
 * authentication (a signature over the raw body bytes, before any parsing), JSON, fields, the replay rule, the sender
 * count. The key is never logged, never written anywhere but config.json, and never returned.
 */
import crypto from 'node:crypto';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import type { IncomingHttpHeaders } from 'node:http';
import type { StatusInputConfig } from './config.js';
import type { Clock, ReportResult } from './engine.js';
import { readJson, writeFileAtomic } from './files.js';
import type { Auth, NewReport, SenderEntry } from './inputs.js';
import type { Log } from './log.js';
import { inputClockOff, inputFailed, inputNotLocal, inputPlainKeyOff, inputStarted, inputWrongKey } from './messages.js';
import type { Status } from './model.js';
import { INPUT_STATUSES } from './status.js';
import type { InputStatus, Reason } from './status.js';

export const API_VERSION = 1;
export const MAX_BODY_BYTES = 2048;
export const RATE_LIMIT = 60;
export const RATE_WINDOW_MS = 60_000;
/** The signature window (SPEC 18.8 item 6). */
export const SKEW_MS = 300_000;
export const DEFAULT_TTL_SECONDS = 180;
export const MIN_TTL_SECONDS = 30;
export const MAX_TTL_SECONDS = 43_200;
/** Failed requests are logged once per remote address per hour (SPEC 18.8 item 3). */
export const LOG_EVERY_MS = 3_600_000;
/** Above this many remote addresses, the rate and log maps drop the ones that no longer matter. */
const PRUNE_ABOVE = 256;
/** A server's timeouts are checked this often; Node's default of 30 seconds would let a 10-second timeout run to 40. */
const TIMEOUT_CHECK_MS = 1_000;
export const SIGNED_SCHEME = 'BusyLight-HMAC-SHA256';

// ---------------------------------------------------------------------------
// Signing (SPEC 18.8 items 4 and 5; the test vector of docs/status-input.md 2.4 is normative)
// ---------------------------------------------------------------------------

export function sha256Hex(body: Buffer | string): string {
  return crypto.createHash('sha256').update(body).digest('hex');
}

/** `v1` LF method LF path LF ts LF body hash. */
export function stringToSign(method: string, pathname: string, ts: string, body: Buffer | string): string {
  return ['v1', method.toUpperCase(), pathname, ts, sha256Hex(body)].join('\n');
}

/** The lowercase hex HMAC-SHA256 of the string to sign, keyed with the UTF-8 bytes of the key. */
export function signature(key: string, method: string, pathname: string, ts: string, body: Buffer | string): string {
  return crypto.createHmac('sha256', Buffer.from(key, 'utf8')).update(stringToSign(method, pathname, ts, body)).digest('hex');
}

/** The Authorization header of a signed request. */
export function signedAuthorization(key: string, method: string, pathname: string, ts: number, body: Buffer | string): string {
  return `${SIGNED_SCHEME} ts=${ts}, sig=${signature(key, method, pathname, String(ts), body)}`;
}

/** Constant-time comparison of two strings of any length: their SHA-256 digests are compared with timingSafeEqual. */
export function safeEqual(a: string, b: string, equal: (x: Buffer, y: Buffer) => boolean = crypto.timingSafeEqual): boolean {
  const x = crypto.createHash('sha256').update(a, 'utf8').digest();
  const y = crypto.createHash('sha256').update(b, 'utf8').digest();
  return equal(x, y);
}

type ParsedAuth =
  | { kind: 'signed'; ts: string; sig: string }
  | { kind: 'plain'; key: string }
  | { kind: 'malformed' }
  | { kind: 'missing' };

/** The Authorization header (SPEC 18.8 items 4, 8 and 9). The scheme is matched without regard to case. */
export function parseAuthorization(header: string | undefined): ParsedAuth {
  if (header === undefined || header === '') {
    return { kind: 'missing' };
  }
  const bearer = /^Bearer +(\S+)$/i.exec(header);
  if (bearer) {
    return { kind: 'plain', key: bearer[1] };
  }
  const signed = new RegExp(`^${SIGNED_SCHEME} +(.*)$`, 'i').exec(header);
  if (!signed) {
    return { kind: 'malformed' };
  }
  const params = new Map<string, string>();
  for (const part of signed[1].split(',')) {
    const m = /^ *([a-z]+)=([^ ,]*) *$/.exec(part);
    if (!m || params.has(m[1]) || (m[1] !== 'ts' && m[1] !== 'sig')) {
      return { kind: 'malformed' };
    }
    params.set(m[1], m[2]);
  }
  const ts = params.get('ts');
  const sig = params.get('sig');
  if (!ts || !sig || !/^\d{1,16}$/.test(ts) || !/^[0-9a-f]{64}$/.test(sig)) {
    return { kind: 'malformed' };
  }
  return { kind: 'signed', ts, sig };
}

// ---------------------------------------------------------------------------
// Local addresses (SPEC 18.5), the text rule (18.4 item 3)
// ---------------------------------------------------------------------------

const LOCAL = new net.BlockList();
for (const [address, prefix] of [['10.0.0.0', 8], ['172.16.0.0', 12], ['192.168.0.0', 16], ['127.0.0.0', 8], ['169.254.0.0', 16]] as const) {
  LOCAL.addSubnet(address, prefix, 'ipv4');
}
LOCAL.addAddress('::1', 'ipv6');
LOCAL.addSubnet('fc00::', 7, 'ipv6');
LOCAL.addSubnet('fe80::', 10, 'ipv6');

/** The remote address with an IPv4-mapped IPv6 address unwrapped and any zone dropped. */
export function plainAddress(address: string): string {
  const unzoned = address.replace(/%.*$/, '');
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(unzoned);
  return mapped ? mapped[1] : unzoned;
}

export function isLocalAddress(address: string): boolean {
  const a = plainAddress(address);
  if (net.isIPv4(a)) {
    return LOCAL.check(a, 'ipv4');
  }
  return net.isIPv6(a) && LOCAL.check(a, 'ipv6');
}

/**
 * `sender` and `app` (SPEC 18.4 item 3): a string, normalized to NFC, of 1 to 64 code points, with no leading or
 * trailing white space, no control characters, no U+2028 or U+2029, and no bidirectional formatting characters.
 * Returns the NFC form, or null when the rule is broken. Nothing is trimmed or rewritten silently.
 */
export function checkText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const nfc = value.normalize('NFC');
  const points = [...nfc];
  if (points.length < 1 || points.length > 64 || /^\s|\s$/u.test(nfc)) {
    return null;
  }
  for (const ch of points) {
    const c = ch.codePointAt(0)!;
    if (c < 0x20 || (c >= 0x7f && c <= 0x9f) || c === 0x2028 || c === 0x2029 || (c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069)) {
      return null;
    }
  }
  return nfc;
}

// ---------------------------------------------------------------------------
// Errors (SPEC 18.4 item 6, docs/status-input.md 2.6)
// ---------------------------------------------------------------------------

export type ErrorKey =
  | 'invalid_json' | 'unknown_field' | 'invalid_sender' | 'invalid_status' | 'invalid_app' | 'invalid_ttl'
  | 'unauthorized' | 'clock_skew' | 'replayed' | 'plain_key_off' | 'not_local' | 'not_found' | 'method_not_allowed'
  | 'too_many_senders' | 'too_large' | 'unsupported_media_type' | 'rate_limited';

const CODES: Record<ErrorKey, number> = {
  invalid_json: 400, unknown_field: 400, invalid_sender: 400, invalid_status: 400, invalid_app: 400, invalid_ttl: 400,
  unauthorized: 401, clock_skew: 401, replayed: 401, plain_key_off: 401, not_local: 403, not_found: 404, method_not_allowed: 405,
  too_many_senders: 409, too_large: 413, unsupported_media_type: 415, rate_limited: 429,
};

/** The plain sentence of each error. None carries the key or anything from the request but the clock difference. */
export const ERROR_MESSAGES: Record<Exclude<ErrorKey, 'clock_skew'>, string> = {
  invalid_json: 'The body is not a JSON object.',
  unknown_field: 'Only sender, status, app and ttlSeconds are allowed.',
  invalid_sender: 'sender must be 1 to 64 characters, with no control characters and no spaces at either end.',
  invalid_status: 'status must be outOfOffice, doNotDisturb, inCall, inMeeting, busy, away, available, offline or clear.',
  invalid_app: 'app must be 1 to 64 characters, with no control characters and no spaces at either end.',
  invalid_ttl: 'ttlSeconds must be a whole number from 30 to 43200.',
  unauthorized: 'Missing or wrong key, a wrong signature, or a malformed Authorization header.',
  replayed: 'The signed ts is not greater than the last one accepted from this sender.',
  plain_key_off: 'The plain key is turned off in Busy Light. Sign the request.',
  not_local: 'Busy Light takes requests from the local network only.',
  not_found: 'There is nothing at this path.',
  method_not_allowed: 'This path does not take that method.',
  too_many_senders: '20 senders are already active. Wait for one to expire, or clear one.',
  too_large: 'The body is over 2048 bytes.',
  unsupported_media_type: 'The body must be application/json.',
  rate_limited: 'More than 60 requests in a minute from this address.',
};

export function clockSkewMessage(seconds: number): string {
  return `The signed ts is ${seconds} seconds from Busy Light's clock.`;
}

// ---------------------------------------------------------------------------
// The handler
// ---------------------------------------------------------------------------

/** What the handler reads of a request: Node's IncomingMessage has all of it. */
export interface ApiRequest {
  method?: string;
  url?: string;
  headers: IncomingHttpHeaders;
  socket: { remoteAddress?: string };
  on(event: 'data', listener: (chunk: Buffer | string) => void): unknown;
  on(event: 'end', listener: () => void): unknown;
  on(event: 'error', listener: (err: Error) => void): unknown;
  pause?(): unknown;
}

/** What the handler writes to: Node's ServerResponse has all of it. */
export interface ApiResponse {
  writeHead(status: number, headers: Record<string, string>): unknown;
  end(body?: string): unknown;
}

/** What the API reads from and reports to: the engine, in the plugin. */
export interface ApiEngine {
  readonly status: Status | null;
  readonly reason: Reason | null;
  readonly inputs: {
    replayFloor(sender: string, now: number): number | null;
    list(now: number): SenderEntry[];
  };
  report(r: NewReport): Promise<ReportResult>;
  clearInput(sender: string, auth: Auth | null, ts?: number | null): Promise<Status>;
}

export interface ApiOptions {
  config: StatusInputConfig;
  engine: ApiEngine;
  log: Log;
  version: string;
  id: string;
  now?: () => number;
  /** The comparison of digests (tests check that both forms use it). */
  equal?: (a: Buffer, b: Buffer) => boolean;
}

const ROUTES: Record<string, string[]> = { '/v1/ping': ['GET'], '/v1/status': ['GET', 'POST'] };
const FIELDS = new Set(['sender', 'status', 'app', 'ttlSeconds']);

class Refusal {
  constructor(readonly key: ErrorKey, readonly message: string, readonly headers: Record<string, string> = {},
    readonly extra: Record<string, string> = {}) {}
}

function refuse(key: Exclude<ErrorKey, 'clock_skew'>, headers: Record<string, string> = {}, extra: Record<string, string> = {}): Refusal {
  return new Refusal(key, ERROR_MESSAGES[key], headers, extra);
}

function header(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/** Reads the body, up to the limit; a body over it is not read further. */
function readBody(req: ApiRequest, limit: number): Promise<{ body: Buffer; tooLarge: boolean }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    req.on('data', (chunk) => {
      if (done) {
        return;
      }
      const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      size += buf.length;
      if (size > limit) {
        done = true;
        req.pause?.();
        resolve({ body: Buffer.alloc(0), tooLarge: true });
        return;
      }
      chunks.push(buf);
    });
    req.on('end', () => {
      if (!done) {
        done = true;
        resolve({ body: Buffer.concat(chunks), tooLarge: false });
      }
    });
    req.on('error', (err) => {
      if (!done) {
        done = true;
        reject(err);
      }
    });
  });
}

export class StatusApi {
  private readonly hits = new Map<string, number[]>();
  private readonly logged = new Map<string, number>();
  private readonly now: () => number;
  private readonly equal: (a: Buffer, b: Buffer) => boolean;

  constructor(private readonly opts: ApiOptions) {
    this.now = opts.now ?? Date.now;
    this.equal = opts.equal ?? crypto.timingSafeEqual;
  }

  /** The request handler. It never throws: every outcome is a JSON answer. */
  handle = async (req: ApiRequest, res: ApiResponse): Promise<void> => {
    let status = 200;
    let body: Record<string, unknown>;
    let headers: Record<string, string> = {};
    try {
      body = await this.route(req);
    } catch (err) {
      if (!(err instanceof Refusal)) {
        throw err;
      }
      status = CODES[err.key];
      headers = err.headers;
      body = { error: err.key, message: err.message, ...err.extra };
    }
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
    res.end(`${JSON.stringify(body)}\n`);
  };

  private async route(req: ApiRequest): Promise<Record<string, unknown>> {
    const now = this.now();
    const ip = plainAddress(req.socket.remoteAddress ?? '');
    // 1. Local address (SPEC 18.5), before anything else is read.
    if (!isLocalAddress(ip)) {
      this.logOnce('local', ip, () => inputNotLocal(ip));
      throw refuse('not_local', { Connection: 'close' });
    }
    // 2. Rate limit (18.6): every request counts, refused ones included. Only the last 61 times matter, so no more are kept.
    const recent = (this.hits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
    recent.push(now);
    this.hits.set(ip, recent.slice(-(RATE_LIMIT + 1)));
    this.pruneHits(now);
    if (recent.length > RATE_LIMIT) {
      // The next request is allowed once the 60th most recent before it has left the window.
      const retry = Math.max(1, Math.ceil((recent[recent.length - RATE_LIMIT] + RATE_WINDOW_MS - now) / 1000));
      throw refuse('rate_limited', { 'Retry-After': String(retry) });
    }
    // 3. Path and method.
    const method = (req.method ?? 'GET').toUpperCase();
    const pathname = (req.url ?? '/').split('?')[0];
    const allowed = ROUTES[pathname];
    if (!allowed) {
      throw refuse('not_found');
    }
    if (!allowed.includes(method)) {
      throw refuse('method_not_allowed', { Allow: allowed.join(', ') });
    }
    // 4. Size.
    const length = Number(header(req.headers, 'content-length') ?? '0');
    if (length > MAX_BODY_BYTES) {
      throw refuse('too_large', { Connection: 'close' });
    }
    const { body, tooLarge } = await readBody(req, MAX_BODY_BYTES);
    if (tooLarge) {
      throw refuse('too_large', { Connection: 'close' });
    }
    // 5. Media type, for a request that carries a body.
    if (method === 'POST') {
      const type = (header(req.headers, 'content-type') ?? '').split(';')[0].trim().toLowerCase();
      if (type !== 'application/json') {
        throw refuse('unsupported_media_type');
      }
    }
    if (pathname === '/v1/ping') {
      return { service: 'busy-light', apiVersion: API_VERSION, version: this.opts.version, id: this.opts.id };
    }
    // 6. Authentication, over the raw body bytes, before any parsing.
    const auth = this.authenticate(header(req.headers, 'authorization'), method, pathname, body, ip, now);
    if (method === 'GET') {
      return this.statusAnswer(now);
    }
    // 7 and 8. JSON and fields.
    const report = this.fields(body);
    // 9. The replay rule, for a signed report (18.8 item 7).
    const ts = auth.kind === 'signed' ? Number(auth.ts) : null;
    if (ts !== null) {
      const floor = this.opts.engine.inputs.replayFloor(report.sender, now);
      if (floor !== null && ts <= floor) {
        throw refuse('replayed', {}, { lastTs: String(floor) });
      }
    }
    const via = auth.kind === 'signed' ? 'signed' : 'plain';
    if (report.status === 'clear') {
      const overall = await this.opts.engine.clearInput(report.sender, via, ts);
      return { accepted: true, expiresAt: null, status: overall };
    }
    // 10. The sender count, in the engine (18.7 item 2).
    const result = await this.opts.engine.report({
      sender: report.sender, status: report.status, app: report.app, via: 'api', auth: via, ttlMs: report.ttlSeconds * 1000, ts,
    });
    if (!result.ok) {
      throw refuse('too_many_senders');
    }
    return { accepted: true, expiresAt: result.expiresAt === null ? null : new Date(result.expiresAt).toISOString(), status: result.status };
  }

  /** SPEC 18.8: the plain key while it is allowed, or a signature over the request, within the window. */
  private authenticate(value: string | undefined, method: string, pathname: string, body: Buffer, ip: string,
    now: number): Extract<ParsedAuth, { kind: 'signed' | 'plain' }> {
    const key = this.opts.config.key;
    const auth = parseAuthorization(value);
    if (auth.kind === 'plain') {
      if (!this.opts.config.allowPlainKey) {
        // Refused before the key is compared, and the key is not looked at (18.8 item 9).
        this.logOnce('plain', ip, () => inputPlainKeyOff(ip));
        throw refuse('plain_key_off');
      }
      if (safeEqual(auth.key, key, this.equal)) {
        return auth;
      }
    } else if (auth.kind === 'signed') {
      if (safeEqual(auth.sig, signature(key, method, pathname, auth.ts, body), this.equal)) {
        const skew = Number(auth.ts) - now;
        if (Math.abs(skew) > SKEW_MS) {
          const seconds = Math.ceil(Math.abs(skew) / 1000);
          this.logOnce('clock', ip, () => inputClockOff(ip, seconds));
          throw new Refusal('clock_skew', clockSkewMessage(seconds));
        }
        return auth;
      }
    }
    this.logOnce('key', ip, () => inputWrongKey(ip));
    throw refuse('unauthorized');
  }

  private fields(body: Buffer): { sender: string; status: InputStatus | 'clear'; app: string | null; ttlSeconds: number } {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body.toString('utf8'));
    } catch {
      throw refuse('invalid_json');
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw refuse('invalid_json');
    }
    const raw = parsed as Record<string, unknown>;
    if (Object.keys(raw).some((k) => !FIELDS.has(k))) {
      throw refuse('unknown_field');
    }
    const sender = checkText(raw.sender);
    if (sender === null) {
      throw refuse('invalid_sender');
    }
    const status = raw.status;
    if (typeof status !== 'string' || !(status === 'clear' || (INPUT_STATUSES as readonly string[]).includes(status))) {
      throw refuse('invalid_status');
    }
    let app: string | null = null;
    if (raw.app !== undefined && raw.app !== null) {
      app = checkText(raw.app);
      if (app === null) {
        throw refuse('invalid_app');
      }
    }
    let ttlSeconds = DEFAULT_TTL_SECONDS;
    if (raw.ttlSeconds !== undefined && raw.ttlSeconds !== null) {
      const t = raw.ttlSeconds;
      if (typeof t !== 'number' || !Number.isInteger(t) || t < MIN_TTL_SECONDS || t > MAX_TTL_SECONDS) {
        throw refuse('invalid_ttl');
      }
      ttlSeconds = t;
    }
    return { sender, status: status as InputStatus | 'clear', app, ttlSeconds };
  }

  /**
   * `GET /v1/status` (18.4): the overall status, its reason, and the active senders. A sender learns nothing about
   * calendars or events (18.10 item 3), so the reason names a source only when it is one of the active senders, whose
   * names the answer lists anyway, and `until` (an event's time) is always null.
   */
  private statusAnswer(now: number): Record<string, unknown> {
    const engine = this.opts.engine;
    const status = engine.status ?? 'unknown';
    const senders = engine.inputs.list(now).filter((e) => e.active).map((e) => ({
      sender: e.sender, status: e.status, app: e.app, expiresAt: e.expiresAt === null ? null : new Date(e.expiresAt).toISOString(),
    }));
    const source = engine.reason?.source ?? null;
    const reason = status !== 'unknown' && engine.reason
      ? { source: source !== null && senders.some((e) => e.sender === source) ? source : null, until: null }
      : null;
    return { status, reason, senders };
  }

  /** A refused request is logged once per remote address per hour, per kind of refusal (SPEC 18.8 item 3). */
  private logOnce(kind: string, ip: string, line: () => string): void {
    const now = this.now();
    const k = `${kind}|${ip}`;
    const last = this.logged.get(k);
    if (last !== undefined && now - last < LOG_EVERY_MS) {
      return;
    }
    this.logged.set(k, now);
    if (this.logged.size > PRUNE_ABOVE) {
      for (const [key, at] of this.logged) {
        if (now - at >= LOG_EVERY_MS) {
          this.logged.delete(key);
        }
      }
    }
    this.opts.log.warn(line());
  }

  /** Drops the addresses with no request in the rate window, once there are many. */
  private pruneHits(now: number): void {
    if (this.hits.size <= PRUNE_ABOVE) {
      return;
    }
    for (const [ip, times] of this.hits) {
      if (now - times[times.length - 1] >= RATE_WINDOW_MS) {
        this.hits.delete(ip);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// The instance id (SPEC 18.3 item 4) and the server (18.3)
// ---------------------------------------------------------------------------

export function instanceFile(storageDir: string): string {
  return path.join(storageDir, 'instance.json');
}

/** The instance id from `instance.json`, or null when there is none yet. */
export function readInstanceId(storageDir: string): string | null {
  const raw = readJson(instanceFile(storageDir)) as { id?: unknown } | null;
  return raw && typeof raw.id === 'string' && /^[A-Za-z0-9_-]{16}$/.test(raw.id) ? raw.id : null;
}

/** The instance id, created the first time: 12 random bytes, base64url without padding (16 characters). */
export function ensureInstanceId(storageDir: string): string {
  const existing = readInstanceId(storageDir);
  if (existing) {
    return existing;
  }
  const id = crypto.randomBytes(12).toString('base64url');
  writeFileAtomic(instanceFile(storageDir), `${JSON.stringify({ id }, null, 2)}\n`, 0o600);
  return id;
}

/** The server's state for the state file (SPEC 10.1). */
export interface InputServerState {
  listening: boolean;
  /** A short reason when the port could not be opened, else null. */
  error: string | null;
}

/** A server as `http.createServer` makes it; replaced in tests so no socket is opened. */
export interface ServerLike {
  listen(options: { port: number; host?: string; ipv6Only?: boolean }, listener: () => void): unknown;
  once(event: 'error', listener: (err: NodeJS.ErrnoException) => void): unknown;
  removeAllListeners(event: 'error'): unknown;
  on(event: 'error', listener: (err: Error) => void): unknown;
  close(): unknown;
  closeAllConnections?(): void;
  requestTimeout?: number;
  headersTimeout?: number;
}

export interface InputServerOptions extends Omit<ApiOptions, 'id'> {
  storageDir: string;
  clock?: Pick<Clock, 'now'>;
  createServer?: (handler: (req: http.IncomingMessage, res: http.ServerResponse) => void) => ServerLike;
}

export class StatusInputServer {
  readonly state: InputServerState = { listening: false, error: null };
  api: StatusApi | null = null;
  private server: ServerLike | null = null;

  constructor(private readonly opts: InputServerOptions) {}

  /**
   * Starts listening on every IPv4 and IPv6 address (SPEC 18.3 item 1). A port that cannot be opened is logged once
   * and leaves the input off until the next restart (item 2). Never throws.
   */
  async start(): Promise<void> {
    const { config, log } = this.opts;
    let id: string;
    try {
      id = ensureInstanceId(this.opts.storageDir);
    } catch (err) {
      this.fail(config.port, err as NodeJS.ErrnoException);
      return;
    }
    const api = new StatusApi({ ...this.opts, id });
    this.api = api;
    const make = this.opts.createServer
      ?? ((handler) => http.createServer({ connectionsCheckingInterval: TIMEOUT_CHECK_MS }, handler) as unknown as ServerLike);
    const server = make((req, res) => {
      void api.handle(req, res).catch(() => {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end();
      });
    });
    server.requestTimeout = 10_000;
    server.headersTimeout = 10_000;
    this.server = server;
    const listen = (host: string, ipv6Only?: boolean) => new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen({ port: config.port, host, ...(ipv6Only === undefined ? {} : { ipv6Only }) }, () => {
        server.removeAllListeners('error');
        resolve();
      });
    });
    try {
      try {
        await listen('::', false);
      } catch (err) {
        // A host without IPv6 cannot bind '::'; IPv4 alone is still every address it has.
        if ((err as NodeJS.ErrnoException).code !== 'EAFNOSUPPORT' && (err as NodeJS.ErrnoException).code !== 'EADDRNOTAVAIL') {
          throw err;
        }
        await listen('0.0.0.0');
      }
    } catch (err) {
      this.server = null;
      this.fail(config.port, err as NodeJS.ErrnoException);
      return;
    }
    server.on('error', (err) => log.debug(`Status input: ${err.message}`));
    this.state.listening = true;
    this.state.error = null;
    log.info(inputStarted(config.port));
  }

  stop(): void {
    if (this.server) {
      this.server.close();
      this.server.closeAllConnections?.();
      this.server = null;
    }
    this.state.listening = false;
  }

  private fail(port: number, err: NodeJS.ErrnoException): void {
    const reason = err.code === 'EADDRINUSE' ? null : (err.code ?? err.message);
    this.state.listening = false;
    this.state.error = reason === null ? `port ${port} is already in use` : reason;
    this.opts.log.error(inputFailed(port, reason));
  }
}
