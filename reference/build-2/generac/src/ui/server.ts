/**
 * The settings page's server side (SPEC section 10). Started by the Homebridge UI as a child process through
 * homebridge-ui/server.js; the platform never loads this module. It answers /status from credentials.json and
 * the platform's state.json, runs the Connect flow (the only time the UI process talks to Generac), writes
 * credentials.json with the platform's atomic writer, and deletes it on Disconnect.
 *
 * The password and the MFA code pass through `connectStart` and `connectCode` once each and are never logged or
 * stored. The pending login is a single in-memory record; a second Connect replaces it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { HomebridgePluginUiServer } from '@homebridge/plugin-ui-utils';
import { readCredentials, writeCredentials } from '../api.js';
import { AuthError, login as realLogin, type LoginOptions, type LoginResult, type MfaType } from '../auth.js';
import { credentialCandidates, dataDir, PLATFORM_NAME, pluginVersion, primaryCredentialsPath, RESET_MARKER, statePath } from '../settings.js';
import { buildStateFile, readStateFile, writeStateFile, type AccountSnapshot, type GeneratorSnapshot } from '../state.js';
import type { StoredCredentials } from '../types.js';

/** A pending Connect expires this long after Sign in (SPEC section 10). */
export const PENDING_LOGIN_TTL_MS = 5 * 60 * 1000;
/** Three rejected codes end the sign-in (SPEC section 4.1). */
export const MAX_CODE_ATTEMPTS = 3;

export type LoginFn = (email: string, password: string, opts: LoginOptions) => Promise<LoginResult>;

export type StartError = 'wrong_password' | 'unknown_email' | 'unsupported_factor' | 'network';
export type CodeError = 'wrong_code' | 'too_many' | 'expired';
export type StartResponse = { step: 'code'; method: MfaType } | { step: 'done' } | { error: StartError };
export type CodeResponse = { step: 'done' } | { error: CodeError };

export interface StatusAccount extends Omit<AccountSnapshot, 'state'> {
  state: AccountSnapshot['state'] | 'checking';
}

export interface StatusResponse {
  account: StatusAccount;
  generators: GeneratorSnapshot[];
  others: Array<{ type: number; name: string }>;
  /** The installed package version, for the page footer. */
  version: string;
}

export interface UiServerOptions {
  storagePath: string;
  /** config.json, read only for `credentialsPath` (SPEC section 4.4). */
  configPath?: string;
  login?: LoginFn;
  now?: () => number;
  version?: string;
}

type Handler = (payload: unknown) => Promise<unknown>;

/** A promise with its settlers, settled at most once. */
class Deferred<T> {
  readonly promise: Promise<T>;
  private settle!: (value: T) => void;
  private done = false;

  constructor() {
    this.promise = new Promise<T>((resolve) => {
      this.settle = resolve;
    });
  }

  resolve(value: T): void {
    if (!this.done) {
      this.done = true;
      this.settle(value);
    }
  }
}

class CancelledError extends Error {
  constructor(reason: 'cancelled' | 'expired' | 'replaced') {
    super(`sign-in ${reason}`);
    this.name = 'CancelledError';
  }
}

interface PendingLogin {
  email: string;
  startedAt: number;
  /** Which request is waiting on the login's next step: the error mapping differs. */
  phase: 'start' | 'code';
  waiter: Deferred<StartResponse | CodeResponse> | null;
  /** The login's `mfaPrompt`, waiting for the next /connect/code. */
  prompt: { type: MfaType; resolve(code: string): void; reject(err: Error): void } | null;
  attempts: number;
  cancelled: boolean;
  expiry: NodeJS.Timeout | null;
}

/** Maps a failed login to the page's error codes (SPEC section 10). */
export function mapError(err: unknown, phase: 'start' | 'code'): StartResponse | CodeResponse {
  if (phase === 'code') {
    if (err instanceof AuthError && /three rejected codes/.test(err.message)) {
      return { error: 'too_many' };
    }
    return { error: 'expired' };
  }
  if (err instanceof AuthError) {
    switch (err.step) {
    case 'password':
      return { error: 'wrong_password' };
    case 'identifier':
      return { error: 'unknown_email' };
    case 'mfa':
      return { error: 'unsupported_factor' };
    }
  }
  return { error: 'network' };
}

function text(payload: unknown, key: string): string {
  const value = payload !== null && typeof payload === 'object' ? (payload as Record<string, unknown>)[key] : undefined;
  return typeof value === 'string' ? value.trim() : '';
}

export class GeneracUiHandlers {
  private readonly login: LoginFn;
  private readonly now: () => number;
  private readonly version: string;
  private pending: PendingLogin | null = null;

  constructor(private readonly opts: UiServerOptions) {
    this.login = opts.login ?? realLogin;
    this.now = opts.now ?? Date.now;
    this.version = opts.version ?? pluginVersion();
  }

  /** The request paths of SPEC section 10 and their handlers, for HomebridgePluginUiServer.onRequest. */
  routes(): Record<string, Handler> {
    return {
      '/status': () => this.status(),
      '/connect/start': (payload) => this.connectStart(payload),
      '/connect/code': (payload) => this.connectCode(payload),
      '/connect/cancel': () => this.connectCancel(),
      '/disconnect': () => this.disconnect(),
      '/reset': () => this.reset(),
    };
  }

  // ---------------------------------------------------------------------------
  // /status
  // ---------------------------------------------------------------------------

  async status(): Promise<StatusResponse> {
    const creds = this.findCredentials();
    const state = readStateFile(statePath(this.opts.storagePath));
    let account: StatusAccount;
    if (!creds) {
      account = { state: 'not_connected' };
    } else if (this.stateNewerThan(state, creds.creds)) {
      account = { state: state!.account.state, email: creds.creds.email, lastChecked: state!.account.lastChecked };
    } else {
      // Credentials exist but the platform has not polled with them yet (SPEC section 10).
      account = { state: 'checking', email: creds.creds.email };
    }
    return {
      account,
      generators: state?.generators ?? [],
      others: (state?.others ?? []).map((o) => ({ type: o.type, name: o.name })),
      version: this.version,
    };
  }

  /** True when the state file's account entry was written after these credentials were created. */
  private stateNewerThan(state: ReturnType<typeof readStateFile>, creds: StoredCredentials): boolean {
    if (!state || state.account.state === 'not_connected') {
      return false;
    }
    const updated = Date.parse(state.updatedAt);
    const created = Date.parse(creds.created_at);
    if (Number.isNaN(updated)) {
      return false;
    }
    return Number.isNaN(created) || updated > created;
  }

  // ---------------------------------------------------------------------------
  // Connect flow (SPEC section 10)
  // ---------------------------------------------------------------------------

  async connectStart(payload: unknown): Promise<StartResponse> {
    const email = text(payload, 'email');
    const password = text(payload, 'password');
    if (!email || !password) {
      return { error: 'network' };
    }
    this.discardPending('replaced');

    const pending: PendingLogin = {
      email, startedAt: this.now(), phase: 'start', waiter: new Deferred(), prompt: null, attempts: 0, cancelled: false, expiry: null,
    };
    this.pending = pending;
    pending.expiry = setTimeout(() => this.expire(pending), PENDING_LOGIN_TTL_MS);
    pending.expiry.unref();

    const mfaPrompt = (type: MfaType, attempt: number): Promise<string> =>
      new Promise<string>((resolve, reject) => {
        if (pending.cancelled) {
          reject(new CancelledError('cancelled'));
          return;
        }
        pending.prompt = { type, resolve, reject };
        // A second or third prompt means Auth0 rejected the previous code.
        this.settle(pending, attempt > 1 ? { error: 'wrong_code' } : { step: 'code', method: type });
      });

    // The password lives in this call's frames only; nothing here keeps a reference to it.
    this.login(email, password, { mfaPrompt }).then(
      (result) => {
        if (pending.cancelled) {
          return;
        }
        this.writeCredentials(email, result);
        this.finish(pending);
        this.settle(pending, { step: 'done' });
      },
      (err: unknown) => {
        if (pending.cancelled) {
          return;
        }
        this.finish(pending);
        this.settle(pending, mapError(err, pending.phase));
      },
    );
    return pending.waiter!.promise as Promise<StartResponse>;
  }

  async connectCode(payload: unknown): Promise<CodeResponse> {
    const code = text(payload, 'code');
    const pending = this.pending;
    if (!pending || !pending.prompt || !code) {
      return { error: 'expired' };
    }
    if (this.now() - pending.startedAt >= PENDING_LOGIN_TTL_MS) {
      this.expire(pending);
      return { error: 'expired' };
    }
    if (pending.attempts >= MAX_CODE_ATTEMPTS) {
      return { error: 'too_many' };
    }
    pending.attempts++;
    pending.phase = 'code';
    pending.waiter = new Deferred();
    const prompt = pending.prompt;
    pending.prompt = null;
    prompt.resolve(code);
    return pending.waiter.promise as Promise<CodeResponse>;
  }

  async connectCancel(): Promise<{ ok: true }> {
    this.discardPending('cancelled');
    return { ok: true };
  }

  /** Whether a Connect is in progress (for tests). */
  get hasPending(): boolean {
    return this.pending !== null;
  }

  private settle(pending: PendingLogin, response: StartResponse | CodeResponse): void {
    const waiter = pending.waiter;
    pending.waiter = null;
    waiter?.resolve(response);
  }

  /** The login ended (success or failure): forget it. */
  private finish(pending: PendingLogin): void {
    if (pending.expiry) {
      clearTimeout(pending.expiry);
      pending.expiry = null;
    }
    if (this.pending === pending) {
      this.pending = null;
    }
  }

  /** Cancel, replace or expire: the login is abandoned, its result (if it ever arrives) ignored, its prompt rejected. */
  private discardPending(reason: 'cancelled' | 'expired' | 'replaced'): void {
    const pending = this.pending;
    if (!pending) {
      return;
    }
    pending.cancelled = true;
    this.finish(pending);
    const prompt = pending.prompt;
    pending.prompt = null;
    prompt?.reject(new CancelledError(reason));
    // A request still waiting (Sign in in flight, or a code in flight) is answered so the page never hangs.
    this.settle(pending, pending.phase === 'start' ? { error: 'network' } : { error: 'expired' });
  }

  private expire(pending: PendingLogin): void {
    if (this.pending === pending) {
      this.discardPending('expired');
    }
  }

  private writeCredentials(email: string, result: LoginResult): void {
    writeCredentials(primaryCredentialsPath(this.opts.storagePath), {
      email,
      refresh_token: result.refreshToken,
      dpop_private_key_pem: result.key.toPem(),
      created_at: new Date(this.now()).toISOString(),
    });
  }

  // ---------------------------------------------------------------------------
  // /disconnect and /reset
  // ---------------------------------------------------------------------------

  async disconnect(): Promise<{ ok: true }> {
    this.discardPending('cancelled');
    this.deleteCredentials();
    this.clearAccountState();
    return { ok: true };
  }

  /**
   * The Reset dialog (SPEC section 11.3 E): sign out, forget the saved state, and leave a marker so the platform
   * removes every cached accessory on its next start. The page resets the platform block itself.
   */
  async reset(): Promise<{ ok: true }> {
    this.discardPending('cancelled');
    this.deleteCredentials();
    fs.rmSync(statePath(this.opts.storagePath), { force: true });
    fs.mkdirSync(dataDir(this.opts.storagePath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(dataDir(this.opts.storagePath), RESET_MARKER), new Date(this.now()).toISOString() + '\n', { mode: 0o600 });
    return { ok: true };
  }

  private deleteCredentials(): void {
    const files = new Set([primaryCredentialsPath(this.opts.storagePath)]);
    const found = this.findCredentials();
    if (found) {
      files.add(found.file);
    }
    for (const file of files) {
      fs.rmSync(file, { force: true });
    }
  }

  /** Clears the account section of state.json, keeping the last generator states for the page. */
  private clearAccountState(): void {
    const file = statePath(this.opts.storagePath);
    const state = readStateFile(file);
    writeStateFile(file, buildStateFile({ state: 'not_connected' }, state?.generators ?? [], state?.others ?? [], new Date(this.now())));
  }

  // ---------------------------------------------------------------------------
  // Credentials on disk (SPEC section 4.4)
  // ---------------------------------------------------------------------------

  private findCredentials(): { file: string; creds: StoredCredentials } | null {
    for (const file of credentialCandidates(this.opts.storagePath, this.configuredCredentialsPath())) {
      try {
        const creds = readCredentials(file);
        if (creds) {
          return { file, creds };
        }
      } catch {
        // Unreadable or malformed: the platform warns about it; the page shows not connected.
      }
    }
    return null;
  }

  /** `credentialsPath` from the platform block in config.json, when set. */
  private configuredCredentialsPath(): string | undefined {
    if (!this.opts.configPath) {
      return undefined;
    }
    try {
      const config = JSON.parse(fs.readFileSync(this.opts.configPath, 'utf8')) as { platforms?: Array<Record<string, unknown>> };
      const block = config.platforms?.find((p) => p && p.platform === PLATFORM_NAME);
      const value = block?.credentialsPath;
      return typeof value === 'string' && value.trim() ? value : undefined;
    } catch {
      return undefined;
    }
  }
}

/** The process the Homebridge UI starts (homebridge-ui/server.js). */
export class GeneracUiServer extends HomebridgePluginUiServer {
  constructor() {
    super();
    const storagePath = this.homebridgeStoragePath;
    if (!storagePath) {
      throw new Error('The Homebridge storage path is not available to the Generac settings UI server');
    }
    const handlers = new GeneracUiHandlers({ storagePath, configPath: this.homebridgeConfigPath });
    for (const [route, handler] of Object.entries(handlers.routes())) {
      this.onRequest(route, handler);
    }
    this.ready();
  }
}

export function startUiServer(): GeneracUiServer {
  return new GeneracUiServer();
}
