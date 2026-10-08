/**
 * The settings page's server side (SPEC section 10.3). Started by the Homebridge UI as a child process through
 * homebridge-ui/server.js; the platform never loads this module. It reuses the plugin's own sources, token store,
 * discovery and state modules, so nothing is written twice.
 *
 * Every response is JSON; a failure is `{ error: key }`, never a thrown error. No response carries a password, a
 * token, a device code, a calendar address or anything about an event beyond a count. The server writes nothing to
 * config.json: the page changes the configuration through `updatePluginConfig()` and the host's Save.
 */
import fs from 'node:fs';
import path from 'node:path';
import { HomebridgePluginUiServer } from '@homebridge/plugin-ui-utils';
import type { MicrosoftSourceConfig } from '../config.js';
import { DEFAULT_OUT_OF_OFFICE_WORDS, isGuid, isHost, isSourceId, normalizeCalendarUrl, normalizeColor } from '../config.js';
import { SourceError } from '../errors.js';
import { ensureStorageDir, readJson } from '../files.js';
import { GRAPH, GraphClient } from '../graph.js';
import { hostOf } from '../http.js';
import { ICloudSource } from '../icloud.js';
import { LifxClient, normalizeSerial } from '../lifx.js';
import { matchesBulb } from '../light.js';
import type { Log } from '../log.js';
import { ADMIN_HELP_URL } from '../messages.js';
import { MicrosoftAuth, TokenStore, postForm, readDeviceCode, refusalReason, scopeFor, storedToken, tokenFile } from '../microsoft.js';
import { DEFAULT_COLORS } from '../model.js';
import { PLATFORM_NAME, RESET_MARKER, STORAGE_DIR, packageVersion } from '../names.js';
import { readState } from '../state.js';
import type { CalEvent } from '../status.js';
import { UrlSource } from '../url-source.js';

/** A pending Microsoft sign-in is dropped this long after /microsoft/start (SPEC 10.3 item 3). */
export const PENDING_SIGN_IN_MS = 15 * 60_000;
/** /lifx/test holds red and then green this long each (SPEC 10.3 item 5). */
export const TEST_HOLD_MS = 1000;
export const TEST_RED = '#FF0000';
export const TEST_GREEN = '#00FF00';

/** An iCloud calendar as /icloud/calendars lists it (SPEC 10.3). */
export interface ICloudCalendarEntry {
  id: string;
  name: string;
  shared: boolean;
  subscribed: boolean;
  eventsToday: number | null;
}

/** A Microsoft calendar as /microsoft/calendars lists it (SPEC 10.3). */
export interface MicrosoftCalendarEntry {
  id: string;
  name: string;
  isDefault: boolean;
  shared: boolean;
  eventsToday: number | null;
}

type Refused = { error: 'refused'; reason: string; help: string };

export type ICloudCalendarsResponse = { calendars: ICloudCalendarEntry[] } | { error: 'rejected' | 'network' | 'unexpected' };
export type UrlTestResponse =
  | { eventsToday: number }
  | { error: 'insecure' | 'notCalendar' | 'http' | 'network' | 'tooLarge'; host: string; code?: number };
export type MicrosoftStartResponse = { verificationUri: string; userCode: string; expiresAt: string } | Refused | { error: 'network' };
export type MicrosoftPollResponse = { state: 'waiting' | 'done' | 'expired' } | { state: 'refused'; reason: string; help: string };
export type MicrosoftCalendarsResponse = { calendars: MicrosoftCalendarEntry[] } | { error: 'notSignedIn' | 'network' } | Refused;

export interface UiServerOptions {
  /** The Homebridge storage path; everything the plugin writes is under `busy-light/` there. */
  storagePath: string;
  /** config.json, read only for the saved Available color that /lifx/test ends on. */
  configPath?: string;
  now?: () => number;
  version?: string;
  lifx?: LifxClient;
  /** Waits between the /lifx/test colors (tests replace it). */
  sleep?: (ms: number) => Promise<void>;
}

type Handler = (payload: unknown) => Promise<unknown>;

interface PendingSignIn {
  tenantId: string;
  clientId: string;
  deviceCode: string;
  startedAt: number;
  expiresAt: number;
  intervalMs: number;
  nextPollAt: number;
}

/** The UI server writes no log lines of its own: every outcome goes back to the page. */
const QUIET: Log = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined };

/**
 * The plugin's token file, read but never written or deleted. Listing calendars needs Calendars.Read only, so a
 * refresh made here gives a token without Presence.Read; it stays in memory, and the plugin keeps the token it has.
 */
class ListingTokenStore extends TokenStore {
  override write(): void {
    // In memory only.
  }

  override delete(): void {
    // The plugin's sign-in is the plugin's to end.
  }
}

function field(payload: unknown, key: string): unknown {
  return payload !== null && typeof payload === 'object' ? (payload as Record<string, unknown>)[key] : undefined;
}

function text(payload: unknown, key: string): string {
  const value = field(payload, key);
  return typeof value === 'string' ? value.trim() : '';
}

/** The host's local today, as epoch milliseconds: midnight to the next midnight. */
export function todayBounds(now: number): { from: number; to: number } {
  const d = new Date(now);
  return { from: new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(), to: new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime() };
}

/** `eventsToday` (SPEC 10.3): timed and all-day events overlapping today that are neither free nor cancelled. */
export function countToday(events: CalEvent[], from: number, to: number): number {
  return events.filter((e) => !e.isCancelled && e.showAs !== 'free' && e.end > from && e.start < to).length;
}

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class BusyLightUiHandlers {
  private readonly now: () => number;
  private readonly version: string;
  private readonly lifx: LifxClient;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly pending = new Map<string, PendingSignIn>();

  constructor(private readonly opts: UiServerOptions) {
    this.now = opts.now ?? Date.now;
    this.version = opts.version ?? packageVersion();
    this.lifx = opts.lifx ?? new LifxClient();
    this.sleep = opts.sleep ?? realSleep;
  }

  /** The request paths of SPEC section 10.3 and their handlers, for HomebridgePluginUiServer.onRequest. */
  routes(): Record<string, Handler> {
    return {
      '/version': async () => ({ version: this.version }),
      '/status': async () => this.status(),
      '/icloud/calendars': (payload) => this.icloudCalendars(payload),
      '/url/test': (payload) => this.urlTest(payload),
      '/microsoft/start': (payload) => this.microsoftStart(payload),
      '/microsoft/poll': (payload) => this.microsoftPoll(payload),
      '/microsoft/cancel': async (payload) => this.microsoftCancel(payload),
      '/microsoft/calendars': (payload) => this.microsoftCalendars(payload),
      '/microsoft/disconnect': async (payload) => this.microsoftDisconnect(payload),
      '/lifx/discover': () => this.lifxDiscover(),
      '/lifx/test': (payload) => this.lifxTest(payload),
      '/reset': async () => this.reset(),
    };
  }

  /** `busy-light/` under the storage path, without creating it. */
  private get storageDir(): string {
    return path.join(this.opts.storagePath, STORAGE_DIR);
  }

  // ---------------------------------------------------------------------------
  // /status
  // ---------------------------------------------------------------------------

  /** The state file of SPEC 10.1 as is, or `{ status: null }` before the plugin has run. */
  status(): unknown {
    return readState(this.storageDir) ?? { status: null };
  }

  // ---------------------------------------------------------------------------
  // /icloud/calendars (SPEC 10.3 item 1)
  // ---------------------------------------------------------------------------

  async icloudCalendars(payload: unknown): Promise<ICloudCalendarsResponse> {
    const appleId = text(payload, 'appleId');
    const appPassword = text(payload, 'appPassword');
    if (!appleId || !appPassword) {
      return { error: 'rejected' };
    }
    const source = new ICloudSource({ name: 'iCloud', appleId, appPassword, calendars: [] },
      { outOfOfficeWords: [...DEFAULT_OUT_OF_OFFICE_WORDS], ownerAddresses: [appleId.toLowerCase()] });
    try {
      const found = await source.listCalendars();
      const { from, to } = todayBounds(this.now());
      const calendars: ICloudCalendarEntry[] = [];
      for (const c of found) {
        let eventsToday: number | null = null;
        if (c.readable && !c.subscribed) {
          try {
            eventsToday = countToday(await source.readCalendar(c, from, to), from, to);
          } catch {
            // The count could not be read; the calendar is listed all the same.
          }
        }
        calendars.push({ id: c.path, name: c.name, shared: c.shared, subscribed: c.subscribed, eventsToday });
      }
      return { calendars };
    } catch (err) {
      if (err instanceof SourceError && err.options.unauthorized) {
        return { error: 'rejected' };
      }
      const status = err instanceof SourceError ? err.options.status ?? 0 : 0;
      if (err instanceof SourceError && (err.options.kind === 'network' || status >= 500 || status === 429)) {
        return { error: 'network' };
      }
      return { error: 'unexpected' };
    }
  }

  // ---------------------------------------------------------------------------
  // /url/test (SPEC 10.3 item 2)
  // ---------------------------------------------------------------------------

  async urlTest(payload: unknown): Promise<UrlTestResponse> {
    const given = text(payload, 'url');
    const email = text(payload, 'email');
    const url = normalizeCalendarUrl(given);
    const host = /^[a-z][a-z0-9+.-]*:\/\//i.test(given) ? hostOf(given.replace(/^webcal:/i, 'https:')) : '';
    if (!url) {
      return { error: 'insecure', host };
    }
    const source = new UrlSource({ type: 'url', id: 'test', name: 'Test', url, use: 'all' },
      { outOfOfficeWords: [...DEFAULT_OUT_OF_OFFICE_WORDS], ownerAddresses: email ? [email.toLowerCase()] : [] });
    const now = this.now();
    try {
      const { from, to } = todayBounds(now);
      return { eventsToday: countToday(await source.fetchEvents(now), from, to) };
    } catch (err) {
      const options = err instanceof SourceError ? err.options : {};
      switch (options.kind) {
      case 'insecure':
      case 'notCalendar':
      case 'tooLarge':
        return { error: options.kind, host: hostOf(url) };
      case 'http':
        return { error: 'http', host: hostOf(url), code: options.status ?? 0 };
      default:
        return { error: 'network', host: hostOf(url) };
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Microsoft 365 (SPEC 10.3 items 3 and 4)
  // ---------------------------------------------------------------------------

  /** Pending sign-ins older than 15 minutes are dropped on every Microsoft request. */
  private sweep(): void {
    const now = this.now();
    for (const [id, p] of this.pending) {
      if (now - p.startedAt >= PENDING_SIGN_IN_MS) {
        this.pending.delete(id);
      }
    }
  }

  async microsoftStart(payload: unknown): Promise<MicrosoftStartResponse> {
    this.sweep();
    const id = text(payload, 'id');
    const tenantId = text(payload, 'tenantId').toLowerCase();
    const clientId = text(payload, 'clientId').toLowerCase();
    if (!isSourceId(id)) {
      return { error: 'network' };
    }
    this.pending.delete(id);
    if (!isGuid(tenantId) || !isGuid(clientId)) {
      return { error: 'refused', reason: refusalReason({ error_codes: [90002] }), help: ADMIN_HELP_URL };
    }
    const scope = scopeFor({ useTeamsStatus: field(payload, 'useTeamsStatus') !== false, useCalendar: field(payload, 'useCalendar') !== false });
    let answer;
    try {
      answer = await postForm(tenantId, 'devicecode', { client_id: clientId, scope });
    } catch {
      return { error: 'network' };
    }
    if (answer.status >= 500 || !answer.body) {
      return { error: 'network' };
    }
    const code = readDeviceCode(answer);
    if (!code) {
      return { error: 'refused', reason: refusalReason(answer.body), help: ADMIN_HELP_URL };
    }
    const now = this.now();
    const expiresAt = now + code.expiresInMs;
    this.pending.set(id, {
      tenantId, clientId, deviceCode: code.deviceCode, startedAt: now, expiresAt, intervalMs: code.intervalMs, nextPollAt: now + code.intervalMs,
    });
    return { verificationUri: code.verificationUri, userCode: code.userCode, expiresAt: new Date(expiresAt).toISOString() };
  }

  /**
   * Asks Microsoft at most once per interval whether the code was used, so the page can call this every 3 seconds.
   * On `done` the token file is written exactly as the plugin writes it, and the plugin picks it up within one tick.
   */
  async microsoftPoll(payload: unknown): Promise<MicrosoftPollResponse> {
    this.sweep();
    const id = text(payload, 'id');
    const p = this.pending.get(id);
    const now = this.now();
    if (!p || now >= p.expiresAt) {
      this.pending.delete(id);
      return { state: 'expired' };
    }
    if (now < p.nextPollAt) {
      return { state: 'waiting' };
    }
    p.nextPollAt = now + p.intervalMs;
    let answer;
    try {
      answer = await postForm(p.tenantId, 'token', {
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code', client_id: p.clientId, device_code: p.deviceCode,
      });
    } catch {
      return { state: 'waiting' }; // the network is tried again at the next interval
    }
    if (this.pending.get(id) !== p) {
      return { state: 'expired' }; // cancelled while the request was out
    }
    const body = answer.body;
    if (answer.status === 200 && body && typeof body.access_token === 'string') {
      this.pending.delete(id);
      try {
        ensureStorageDir(this.opts.storagePath);
        new TokenStore(tokenFile(this.storageDir, id)).write(storedToken(body, this.now()));
      } catch {
        return { state: 'expired' }; // the sign-in could not be saved: Connect again gives a new code
      }
      return { state: 'done' };
    }
    const error = body && typeof body.error === 'string' ? body.error : '';
    if (error === 'authorization_pending' || (!error && answer.status >= 500)) {
      return { state: 'waiting' };
    }
    if (error === 'slow_down') {
      p.intervalMs += 5000;
      p.nextPollAt = now + p.intervalMs;
      return { state: 'waiting' };
    }
    this.pending.delete(id);
    if (error === 'expired_token') {
      return { state: 'expired' };
    }
    return { state: 'refused', reason: refusalReason(body ?? {}), help: ADMIN_HELP_URL };
  }

  microsoftCancel(payload: unknown): { ok: true } {
    this.pending.delete(text(payload, 'id'));
    return { ok: true };
  }

  async microsoftCalendars(payload: unknown): Promise<MicrosoftCalendarsResponse> {
    this.sweep();
    const id = text(payload, 'id');
    const tenantId = text(payload, 'tenantId').toLowerCase();
    const clientId = text(payload, 'clientId').toLowerCase();
    if (!isSourceId(id) || !isGuid(tenantId) || !isGuid(clientId)) {
      return { error: 'notSignedIn' };
    }
    const store = new ListingTokenStore(tokenFile(this.storageDir, id));
    const source: MicrosoftSourceConfig = {
      type: 'microsoft', id, name: 'Microsoft 365', tenantId, clientId, useTeamsStatus: false, useCalendar: true, calendars: [],
    };
    const auth = new MicrosoftAuth({ source, store, log: QUIET, now: this.now, autoSignIn: false });
    if (!auth.hasToken()) {
      return { error: 'notSignedIn' };
    }
    const graph = new GraphClient(auth, source.name, this.now);
    try {
      const found = await graph.listCalendars();
      const owner = (found.find((c) => c.isDefault) ?? found[0])?.ownerAddress ?? '';
      const { from, to } = todayBounds(this.now());
      const calendars: MicrosoftCalendarEntry[] = [];
      for (const c of found) {
        let eventsToday: number | null = null;
        try {
          eventsToday = countToday(await graph.calendarView(`${GRAPH}/me/calendars/${encodeURIComponent(c.id)}/calendarView`, from, to), from, to);
        } catch {
          // The count could not be read; the calendar is listed all the same.
        }
        calendars.push({ id: c.id, name: c.name, isDefault: c.isDefault, shared: !!owner && !!c.ownerAddress && c.ownerAddress !== owner, eventsToday });
      }
      return { calendars };
    } catch (err) {
      if (err instanceof SourceError && err.options.refused) {
        return { error: 'refused', reason: err.message, help: ADMIN_HELP_URL };
      }
      if (err instanceof SourceError && err.state === 'signInNeeded') {
        return { error: 'notSignedIn' };
      }
      return { error: 'network' };
    }
  }

  /** Deletes that source's token file, so the plugin stops reading it until the next Connect. */
  microsoftDisconnect(payload: unknown): { ok: true } {
    const id = text(payload, 'id');
    this.pending.delete(id);
    if (isSourceId(id)) {
      new TokenStore(tokenFile(this.storageDir, id)).delete();
    }
    return { ok: true };
  }

  // ---------------------------------------------------------------------------
  // LIFX (SPEC 10.3 item 5)
  // ---------------------------------------------------------------------------

  async lifxDiscover(): Promise<{ bulbs: Array<{ label: string; serial: string; ip: string }> }> {
    try {
      const bulbs = await this.lifx.discover();
      return { bulbs: bulbs.map((b) => ({ label: b.label, serial: b.serial, ip: b.host })) };
    } catch {
      return { bulbs: [] };
    }
  }

  /**
   * Red, then green, then the saved Available color, each held a second, with acknowledgements. A serial with a host
   * sends untagged to that address, a host alone sends tagged, and a serial alone is found by discovery first. It
   * never writes light.json; the plugin's next send restores the status color.
   */
  async lifxTest(payload: unknown): Promise<{ answered: boolean }> {
    let serial = normalizeSerial(text(payload, 'serial'));
    const given = text(payload, 'host');
    let host = given && isHost(given) ? given : null;
    const raw = field(payload, 'brightness');
    const brightness = typeof raw === 'number' && Number.isInteger(raw) && raw >= 1 && raw <= 100 ? raw : 100;
    try {
      if (!host && serial) {
        host = (await this.lifx.discover()).find((b) => b.serial === serial)?.host ?? null;
      } else if (!host) {
        // Nothing chosen on the page yet: the bulb the plugin would choose, by the saved lifx.bulb or the only one found.
        const bulbs = await this.lifx.discover();
        const wanted = this.savedBulb();
        const pick = wanted ? bulbs.find((b) => matchesBulb(wanted, b)) : bulbs.length === 1 ? bulbs[0] : undefined;
        serial = pick?.serial ?? null;
        host = pick?.host ?? null;
      }
      if (!host) {
        return { answered: false };
      }
      let answered = true;
      for (const [i, color] of [TEST_RED, TEST_GREEN, this.availableColor()].entries()) {
        if (i > 0) {
          await this.sleep(TEST_HOLD_MS);
        }
        answered = (await this.lifx.sendColor(host, serial, color, brightness, 0)) && answered;
      }
      return { answered };
    } catch {
      return { answered: false };
    }
  }

  /** The platform block of the saved configuration (config.json, read only), or undefined. */
  private savedBlock(): Record<string, unknown> | undefined {
    if (!this.opts.configPath) {
      return undefined;
    }
    const config = readJson(this.opts.configPath) as { platforms?: Array<Record<string, unknown>> } | null;
    return Array.isArray(config?.platforms) ? config.platforms.find((p) => p && p.platform === PLATFORM_NAME) : undefined;
  }

  /** The Available color of the saved configuration, or the default. */
  private availableColor(): string {
    const colors = this.savedBlock()?.colors as Record<string, unknown> | undefined;
    return normalizeColor(colors?.available) ?? DEFAULT_COLORS.available;
  }

  /** The saved lifx.bulb (a serial number or a name from the LIFX app), or an empty string. */
  private savedBulb(): string {
    const lifx = this.savedBlock()?.lifx as Record<string, unknown> | undefined;
    return typeof lifx?.bulb === 'string' ? lifx.bulb.trim() : '';
  }

  // ---------------------------------------------------------------------------
  // /reset (SPEC 10.3 item 6)
  // ---------------------------------------------------------------------------

  /** Deletes every file in busy-light/ (tokens, state, light.json) and leaves the reset-pending marker there. */
  reset(): { ok: boolean } {
    this.pending.clear();
    try {
      const dir = ensureStorageDir(this.opts.storagePath);
      for (const name of fs.readdirSync(dir)) {
        const file = path.join(dir, name);
        try {
          if (fs.statSync(file).isFile()) {
            fs.rmSync(file, { force: true });
          }
        } catch {
          // Gone already.
        }
      }
      fs.writeFileSync(path.join(dir, RESET_MARKER), `${new Date(this.now()).toISOString()}\n`, { mode: 0o600 });
      return { ok: true };
    } catch {
      return { ok: false }; // the folder could not be written
    }
  }

  /** Whether a Microsoft sign-in is waiting for this source (tests). */
  hasPending(id: string): boolean {
    return this.pending.has(id);
  }
}

/** The process the Homebridge UI starts (homebridge-ui/server.js). */
export class BusyLightUiServer extends HomebridgePluginUiServer {
  constructor() {
    super();
    const storagePath = this.homebridgeStoragePath;
    if (!storagePath) {
      throw new Error('The Homebridge storage path is not available to the Busy Light settings UI server');
    }
    const handlers = new BusyLightUiHandlers({ storagePath, configPath: this.homebridgeConfigPath });
    for (const [route, handler] of Object.entries(handlers.routes())) {
      this.onRequest(route, handler);
    }
    this.ready();
  }
}

export function startUiServer(): BusyLightUiServer {
  return new BusyLightUiServer();
}
