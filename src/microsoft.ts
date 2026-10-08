/**
 * Microsoft 365 sign-in (SPEC 4.3, 4.3.1 and 4.4): the device code flow for a public client, the token file, and
 * refresh. Tokens and device codes are never logged; the short user code is the one value shown, so the person can
 * sign in.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { MicrosoftSourceConfig } from './config.js';
import { SourceError } from './errors.js';
import { hostOf, send } from './http.js';
import type { Log } from './log.js';
import { ADMIN_HELP_URL, microsoftCode, microsoftDone, microsoftGaveUp, microsoftRefused } from './messages.js';
import { readJson, writeFileAtomic } from './files.js';

export const LOGIN_HOST = 'https://login.microsoftonline.com';
/** Codes issued before the flow stops (SPEC 4.3 item 5). */
export const MAX_CODES = 3;
/** The access token is used until this long before it expires (SPEC 4.4 item 1). */
export const EXPIRY_MARGIN_MS = 120_000;
/** A failed device code request is tried again after these delays, staying at the last. */
const START_RETRY_MS = [60_000, 120_000, 300_000, 900_000];

/** Plain-language reasons for a refused sign-in, by AADSTS code (SPEC 4.3.1). */
const REASONS: [string[], string][] = [
  [['AADSTS700016', 'AADSTS90002', 'AADSTS900023'], 'the Directory (tenant) ID or Application (client) ID was not recognised'],
  [['AADSTS7000218', 'AADSTS70002'], 'the app registration does not allow public client flows'],
  [['AADSTS65001', 'AADSTS90094', 'AADSTS90099', 'AADSTS650051', 'AADSTS650057'], 'your organization has not approved the permissions'],
  [['AADSTS53003', 'AADSTS530033', 'AADSTS50105', 'AADSTS50158'], 'your organization\'s sign-in policy blocked it'],
  [['AADSTS50020', 'AADSTS50059'], 'that account does not belong to this organization'],
];

/** The reason given when Graph answers 403: the token lacks a permission. */
export const CONSENT_REASON = 'your organization has not approved the permissions';

/** An OAuth error answer from Microsoft's sign-in endpoints. */
export interface OAuthError {
  error?: unknown;
  error_description?: unknown;
  error_codes?: unknown;
}

/** Every AADSTS code in the answer: the one starting `error_description`, then those in `error_codes`. */
export function aadstsCodes(body: OAuthError): string[] {
  const codes: string[] = [];
  if (typeof body.error_description === 'string') {
    const m = /^\s*(AADSTS\d+)/.exec(body.error_description);
    if (m) {
      codes.push(m[1]);
    }
  }
  if (Array.isArray(body.error_codes)) {
    for (const c of body.error_codes) {
      if (typeof c === 'number' || (typeof c === 'string' && /^\d+$/.test(c))) {
        codes.push(`AADSTS${c}`);
      }
    }
  }
  return [...new Set(codes)];
}

/** The reason shown for a refused sign-in. */
export function refusalReason(body: OAuthError): string {
  const codes = aadstsCodes(body);
  for (const code of codes) {
    const hit = REASONS.find(([list]) => list.includes(code));
    if (hit) {
      return hit[1];
    }
  }
  const error = typeof body.error === 'string' && body.error ? body.error : 'an error';
  return `Microsoft answered ${codes[0] ?? error}`;
}

/** The scope for a source: offline_access, plus Presence.Read and Calendars.Read as used. */
export function scopeFor(source: Pick<MicrosoftSourceConfig, 'useTeamsStatus' | 'useCalendar'>): string {
  const scopes = ['offline_access'];
  if (source.useTeamsStatus) {
    scopes.push('Presence.Read');
  }
  if (source.useCalendar) {
    scopes.push('Calendars.Read');
  }
  return scopes.join(' ');
}

/** `busy-light/microsoft-{id}.json`. */
export function tokenFile(storageDir: string, id: string): string {
  return path.join(storageDir, `microsoft-${id}.json`);
}

/** What the token file holds, and nothing else (SPEC 4.4 item 5). */
export interface StoredToken {
  refreshToken: string;
  accessToken: string;
  /** ISO time. */
  expiresAt: string;
}

/** The token file, with its modification time remembered so a sign-in by the CLI is noticed (SPEC 4.4 item 6). */
export class TokenStore {
  private seenMtime: string | null = null;

  constructor(readonly file: string) {}

  /**
   * The file's modification time and inode. File times come from the kernel's coarse clock, so two writes a few
   * milliseconds apart can share one; every write renames a new file into place, so the inode tells them apart.
   */
  private mtime(): string | null {
    try {
      const stat = fs.statSync(this.file);
      return `${stat.mtimeMs}:${stat.ino}`;
    } catch {
      return null;
    }
  }

  /** True when the file was written, replaced or deleted by someone else since it was last read or written here. */
  changed(): boolean {
    return this.mtime() !== this.seenMtime;
  }

  read(): StoredToken | null {
    this.seenMtime = this.mtime();
    const raw = readJson(this.file) as Partial<StoredToken> | null;
    if (!raw || typeof raw.refreshToken !== 'string' || !raw.refreshToken) {
      return null;
    }
    return {
      refreshToken: raw.refreshToken,
      accessToken: typeof raw.accessToken === 'string' ? raw.accessToken : '',
      expiresAt: typeof raw.expiresAt === 'string' ? raw.expiresAt : new Date(0).toISOString(),
    };
  }

  write(token: StoredToken): void {
    const data: StoredToken = { refreshToken: token.refreshToken, accessToken: token.accessToken, expiresAt: token.expiresAt };
    writeFileAtomic(this.file, `${JSON.stringify(data, null, 2)}\n`, 0o600);
    this.seenMtime = this.mtime();
  }

  delete(): void {
    try {
      fs.unlinkSync(this.file);
    } catch {
      // nothing stored
    }
    this.seenMtime = null;
  }
}

/** A code waiting to be entered (SPEC 10.1 item 2a). */
export interface SignInCode {
  verificationUri: string;
  userCode: string;
  /** Epoch milliseconds. */
  expiresAt: number;
}

export type SignInResult = 'signedIn' | 'refused' | 'gaveUp' | 'stopped';

export interface MicrosoftAuthOptions {
  source: MicrosoftSourceConfig;
  store: TokenStore;
  log: Log;
  now?: () => number;
  /** Waits, ending early (without throwing) when the signal aborts. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  /** Called whenever the sign-in state changes, so the state file can be written. */
  onChange?: () => void;
  /** False for the CLI `check`: a lost sign-in never starts the device code flow by itself. */
  autoSignIn?: boolean;
}

/** An answer from Microsoft's sign-in endpoints: the status and the JSON body, or null when it was not JSON. */
export interface FormAnswer {
  status: number;
  body: (OAuthError & Record<string, unknown>) | null;
}

/** POSTs a form to `https://login.microsoftonline.com/{tenantId}/oauth2/v2.0/{endpoint}`. A network failure throws a SourceError. */
export async function postForm(tenantId: string, endpoint: 'devicecode' | 'token', form: Record<string, string>): Promise<FormAnswer> {
  const res = await send(`${LOGIN_HOST}/${encodeURIComponent(tenantId)}/oauth2/v2.0/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
    body: new URLSearchParams(form).toString(),
  });
  let body: FormAnswer['body'] = null;
  try {
    const parsed = (await res.json()) as unknown;
    body = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as FormAnswer['body'] : null;
  } catch {
    // not JSON
  }
  return { status: res.status, body };
}

/** A device code answer (SPEC 4.3 items 1 to 4), or null when it is not one. Intervals and lifetimes in milliseconds. */
export interface DeviceCode {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresInMs: number;
  intervalMs: number;
}

export function readDeviceCode(answer: FormAnswer): DeviceCode | null {
  const body = answer.body;
  if (answer.status !== 200 || !body) {
    return null;
  }
  const deviceCode = typeof body.device_code === 'string' ? body.device_code : '';
  const userCode = typeof body.user_code === 'string' ? body.user_code : '';
  const verificationUri = typeof body.verification_uri === 'string' ? body.verification_uri
    : typeof body.verification_url === 'string' ? body.verification_url : '';
  if (!deviceCode || !userCode || !verificationUri) {
    return null;
  }
  return {
    deviceCode, userCode, verificationUri,
    expiresInMs: (Number(body.expires_in) > 0 ? Number(body.expires_in) : 900) * 1000,
    intervalMs: (Number(body.interval) > 0 ? Number(body.interval) : 5) * 1000,
  };
}

/** The token file's content from a token answer (SPEC 4.4 item 5). Without a new refresh token, `fallbackRefresh` is kept. */
export function storedToken(body: Record<string, unknown>, now: number, fallbackRefresh = ''): StoredToken {
  const refreshToken = typeof body.refresh_token === 'string' && body.refresh_token ? body.refresh_token : fallbackRefresh;
  const expiresIn = Number(body.expires_in) > 0 ? Number(body.expires_in) : 3600;
  return { refreshToken, accessToken: String(body.access_token), expiresAt: new Date(now + expiresIn * 1000).toISOString() };
}

function realSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    let timer: NodeJS.Timeout | undefined = undefined;
    const done = (): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    timer = setTimeout(done, ms);
    signal.addEventListener('abort', done);
  });
}

export class MicrosoftAuth {
  readonly scope: string;
  /** The code waiting to be entered, or null. */
  code: SignInCode | null = null;
  /** The plain-language reason Microsoft refused, or null. */
  refusedReason: string | null = null;
  /** All codes went unused; the flow will not start again by itself. */
  gaveUp = false;

  private token: StoredToken | null;
  private refreshing: Promise<string> | null = null;
  private flow: Promise<SignInResult> | null = null;
  private loggedRefusal: string | null = null;
  /** The Graph reads that answered 403, so the refusal clears only when the same read works again. */
  private readonly refusedParts = new Set<string>();
  private readonly abort = new AbortController();
  private readonly now: () => number;
  private readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>;

  constructor(private readonly options: MicrosoftAuthOptions) {
    this.scope = scopeFor(options.source);
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? realSleep;
    this.token = options.store.read();
  }

  private get name(): string {
    return this.options.source.name;
  }

  private changed(): void {
    this.options.onChange?.();
  }

  /** Picks up a token written by someone else (the CLI), or notices that it was deleted. */
  private syncFromDisk(): void {
    if (!this.options.store.changed()) {
      return;
    }
    const hadToken = this.token !== null;
    this.token = this.options.store.read();
    if (this.token && !hadToken) {
      this.signedIn();
    }
  }

  private clearRefusal(): void {
    this.refusedReason = null;
    this.loggedRefusal = null;
    this.refusedParts.clear();
  }

  private signedIn(): void {
    this.code = null;
    this.gaveUp = false;
    this.clearRefusal();
    this.options.log.info(microsoftDone(this.name));
    this.changed();
  }

  /** True when a refresh token is stored. */
  hasToken(): boolean {
    this.syncFromDisk();
    return this.token !== null;
  }

  /**
   * Marks the source refused, writing the "Microsoft refused" line once per reason. `part` names the Graph read
   * that was refused (a 403), if it was one.
   */
  refuse(reason: string, part?: string): SourceError {
    if (part) {
      this.refusedParts.add(part);
    }
    this.refusedReason = reason;
    if (this.loggedRefusal !== reason) {
      this.loggedRefusal = reason;
      this.options.log.warn(microsoftRefused(this.name, reason));
    }
    this.changed();
    return new SourceError('signInNeeded', reason, { refused: true, help: ADMIN_HELP_URL });
  }

  /** A Graph read answered normally, so a refusal of that read (a Graph 403) is over once no other read is refused. */
  accepted(part: string): void {
    if (this.refusedParts.delete(part) && this.refusedParts.size === 0 && this.refusedReason !== null) {
      this.clearRefusal();
      this.changed();
    }
  }

  /** The error to report while there is no token. Cheap to retry: it only looks at the token file. */
  notSignedIn(): SourceError {
    if (this.refusedReason) {
      return new SourceError('signInNeeded', this.refusedReason, { refused: true, help: ADMIN_HELP_URL, noToken: true });
    }
    const message = this.code ? 'waiting for sign-in' : this.gaveUp ? 'the sign-in code was not used' : 'not signed in';
    return new SourceError('signInNeeded', message, { noToken: true });
  }

  /** Forgets the cached access token, so the next call refreshes (a Graph 401, SPEC 4.4 item 4). */
  invalidate(): void {
    if (this.token) {
      this.token = { ...this.token, accessToken: '', expiresAt: new Date(0).toISOString() };
    }
  }

  /** A valid access token, refreshing when needed. Concurrent callers share one refresh. */
  async getAccessToken(): Promise<string> {
    this.syncFromDisk();
    if (!this.token) {
      throw this.notSignedIn();
    }
    if (this.token.accessToken && Date.parse(this.token.expiresAt) - EXPIRY_MARGIN_MS > this.now()) {
      return this.token.accessToken;
    }
    this.refreshing ??= this.refresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private postForm(endpoint: 'devicecode' | 'token', form: Record<string, string>): Promise<FormAnswer> {
    return postForm(this.options.source.tenantId, endpoint, form);
  }

  /** Keeps the new tokens, and writes them to the token file. A file that cannot be written keeps them in memory. */
  private save(body: Record<string, unknown>): void {
    this.token = storedToken(body, this.now(), this.token?.refreshToken ?? '');
    try {
      this.options.store.write(this.token);
    } catch (err) {
      this.options.log.debug(`${this.name}: could not save the Microsoft sign-in (${(err as NodeJS.ErrnoException).code ?? 'write failed'}).`);
    }
  }

  private async refresh(): Promise<string> {
    // A sign-in completed by the CLI may already have written a fresh token.
    if (this.options.store.changed()) {
      this.syncFromDisk();
      if (!this.token) {
        throw this.notSignedIn();
      }
      if (this.token.accessToken && Date.parse(this.token.expiresAt) - EXPIRY_MARGIN_MS > this.now()) {
        return this.token.accessToken;
      }
    }
    const current = this.token;
    if (!current) {
      throw this.notSignedIn();
    }
    const answer = await this.postForm('token', {
      grant_type: 'refresh_token',
      client_id: this.options.source.clientId,
      refresh_token: current.refreshToken,
      scope: this.scope,
    });
    const body = answer.body;
    if (answer.status === 200 && body && typeof body.access_token === 'string') {
      this.save(body);
      if (this.refusedParts.size === 0 && this.refusedReason !== null) {
        this.clearRefusal();
        this.changed();
      }
      return this.token!.accessToken;
    }
    const error = body && typeof body.error === 'string' ? body.error : '';
    if (error === 'invalid_grant' || error === 'interaction_required') {
      this.options.store.delete();
      this.token = null;
      this.clearRefusal();
      if (this.options.autoSignIn !== false) {
        this.startSignIn();
      }
      throw this.notSignedIn();
    }
    if (!error || answer.status >= 500 || error === 'temporarily_unavailable') {
      throw new SourceError('notReachable', `${hostOf(LOGIN_HOST)} answered HTTP ${answer.status}`);
    }
    throw this.refuse(refusalReason(body ?? {}));
  }

  /**
   * Starts the device code flow in the background, once: not while one is running, and not again after Microsoft
   * refused or every code went unused, until a sign-in succeeds (SPEC 4.3 item 5).
   */
  startSignIn(): void {
    if (this.flow || this.gaveUp || this.refusedReason || this.abort.signal.aborted) {
      return;
    }
    this.flow = this.signIn({ retryStart: true })
      .catch((err: unknown) => {
        this.options.log.debug(`${this.name}: the Microsoft sign-in stopped (${(err as Error).message}).`);
        return this.endFlow('stopped');
      })
      .finally(() => {
        this.flow = null;
      });
  }

  /** True while a device code flow is running. */
  get signingIn(): boolean {
    return this.flow !== null;
  }

  /** Ends any running flow (Homebridge is shutting down). */
  stop(): void {
    this.abort.abort();
  }

  /**
   * The device code flow: up to three codes, each polled at the interval Microsoft gives. With `retryStart`, a
   * device code request that fails for network reasons is tried again later; without it (the CLI), it throws.
   */
  async signIn(opts: { retryStart: boolean }): Promise<SignInResult> {
    const signal = this.abort.signal;
    // A token already held (the CLI signing in again) does not count; only a new one ends the flow.
    const held = this.token;
    let codes = 0;
    let startFailures = 0;
    this.gaveUp = false;
    this.clearRefusal();
    while (codes < MAX_CODES) {
      if (signal.aborted) {
        return this.endFlow('stopped');
      }
      let start: FormAnswer;
      try {
        start = await this.postForm('devicecode', { client_id: this.options.source.clientId, scope: this.scope });
        if (start.status >= 500 || !start.body) {
          throw new SourceError('notReachable', `${hostOf(LOGIN_HOST)} answered HTTP ${start.status}`);
        }
      } catch (err) {
        if (!opts.retryStart) {
          throw err;
        }
        const delay = START_RETRY_MS[Math.min(startFailures++, START_RETRY_MS.length - 1)];
        this.options.log.debug(`${this.name}: could not start the Microsoft sign-in (${(err as Error).message}).`);
        await this.sleep(delay, signal);
        continue;
      }
      const code = readDeviceCode(start);
      if (!code) {
        this.code = null;
        this.refuse(refusalReason(start.body ?? {}));
        return this.endFlow('refused');
      }
      const { deviceCode, userCode, verificationUri } = code;
      codes++;
      let interval = code.intervalMs;
      const expiresAt = this.now() + code.expiresInMs;
      this.code = { verificationUri, userCode, expiresAt };
      this.options.log.warn(microsoftCode(this.name, verificationUri, userCode));
      this.changed();

      for (;;) {
        await this.sleep(interval, signal);
        if (signal.aborted) {
          return this.endFlow('stopped');
        }
        // A sign-in by the CLI, noticed here or by any other caller in the meantime, ends the flow.
        this.syncFromDisk();
        if (this.token && this.token !== held) {
          return this.endFlow('signedIn');
        }
        if (this.now() >= expiresAt) {
          break;
        }
        let poll: FormAnswer;
        try {
          poll = await this.postForm('token', {
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
            client_id: this.options.source.clientId,
            device_code: deviceCode,
          });
        } catch {
          continue; // the network will be tried again at the next interval
        }
        const answer = poll.body;
        if (poll.status === 200 && answer && typeof answer.access_token === 'string') {
          this.save(answer);
          this.signedIn();
          return this.endFlow('signedIn');
        }
        const error = answer && typeof answer.error === 'string' ? answer.error : '';
        if (error === 'authorization_pending' || (!error && poll.status >= 500)) {
          continue;
        }
        if (error === 'slow_down') {
          interval += 5000;
          continue;
        }
        if (error === 'expired_token') {
          break;
        }
        this.code = null;
        this.refuse(refusalReason(answer ?? {}));
        return this.endFlow('refused');
      }
      this.code = null;
      this.changed();
    }
    this.gaveUp = true;
    this.options.log.warn(microsoftGaveUp(this.name));
    return this.endFlow('gaveUp');
  }

  private endFlow(result: SignInResult): SignInResult {
    this.code = null;
    this.changed();
    return result;
  }
}
