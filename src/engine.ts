/**
 * The loop of SPEC section 8, without any HomeKit code: ticks, the boundary timer, resolving the status, applying
 * it (log line, sensors, state file, bulb), the bulb refresh, and the state file of SPEC 10.1.
 */
import type { BusyLightConfig } from './config.js';
import { ownerAddresses } from './config.js';
import { SenderStore, inputsFile } from './inputs.js';
import type { Auth, NewReport, Via } from './inputs.js';
import { LifxClient } from './lifx.js';
import { LightController } from './light.js';
import type { Log } from './log.js';
import { noCalendars, senderCleared, senderExpired, senderReports, startup, statusLine, statusUnknown } from './messages.js';
import { STATUS_NAMES } from './model.js';
import type { Status } from './model.js';
import { SourceRunner } from './sources.js';
import { readInstanceId } from './status-api.js';
import { writeState } from './state.js';
import type { AddressChange, StateFile } from './state.js';
import { freshData, nextBoundary, resolve } from './status.js';
import type { InputReport, Reason } from './status.js';

/** Time and timers, replaced in tests. */
export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (h) => clearInterval(h as NodeJS.Timeout),
};

/** The state file is written at least this often (SPEC 10.1). */
export const STATE_EVERY_MS = 60_000;
/** Bulb transition on a status change; a refresh is instant (SPEC 13.1 item 4). */
export const CHANGE_DURATION_MS = 1000;

export interface EngineOptions {
  config: BusyLightConfig;
  storageDir: string;
  log: Log;
  version: string;
  clock?: Clock;
  lifx?: LifxClient;
  /** Replaces the Microsoft sign-in's waits (tests). */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  /** The override switch's state at startup. */
  override?: boolean;
  /** Called on every status change, to update the sensors. */
  onStatus?: (status: Status) => void;
}

/** The status input server's part of the state file (SPEC 10.1); the platform supplies it while the server runs. */
export interface InputServerStatus {
  listening: boolean;
  error: string | null;
  id: string | null;
  /** The address change notice's record (SPEC 18.11 item 6). */
  advertised?: string | null;
  addressChange?: AddressChange | null;
}

/** What a report through the status API or the switch led to (SPEC 18.4). */
export type ReportResult = { ok: true; expiresAt: number | null; status: Status } | { ok: false; error: 'tooManySenders' };

export class BusyLightEngine {
  readonly sources: SourceRunner[];
  readonly light: LightController;
  /** The senders of the status input (SPEC 18.7). */
  readonly inputs: SenderStore;
  /** The status last applied; null before the first resolve. */
  status: Status | null = null;
  reason: Reason | null = null;
  override: boolean;

  private readonly config: BusyLightConfig;
  private readonly clock: Clock;
  private readonly log: Log;
  private ticking = false;
  private queue: Promise<void> = Promise.resolve();
  private boundaryTimer: unknown = null;
  private expiryTimer: unknown = null;
  private pollTimer: unknown = null;
  private stateTimer: unknown = null;
  private lastTickAt = 0;
  private lastSendAt: number | null = null;
  private stopped = false;
  /** The status input server's state, set by the platform; without a server the input is not listening. */
  inputServerStatus: () => InputServerStatus;

  constructor(private readonly options: EngineOptions) {
    this.config = options.config;
    this.clock = options.clock ?? systemClock;
    this.log = options.log;
    this.override = options.override ?? false;
    const ics = { outOfOfficeWords: this.config.outOfOfficeWords, ownerAddresses: ownerAddresses(this.config) };
    const now = () => this.clock.now();
    this.sources = this.config.calendars.map((config) => new SourceRunner({
      config, storageDir: options.storageDir, ics, log: this.log, now, sleep: options.sleep, onChange: () => this.writeState(),
    }));
    this.inputs = new SenderStore(inputsFile(options.storageDir), (err) => this.log.debug(`Could not write inputs.json: ${err.message}`));
    const id = readInstanceId(options.storageDir);
    this.inputServerStatus = () => ({ listening: false, error: null, id });
    this.light = new LightController({
      config: this.config.lifx,
      client: options.lifx ?? new LifxClient(),
      log: this.log,
      storageDir: options.storageDir,
      now,
      onChange: () => this.writeState(),
    });
  }

  private get pollMs(): number {
    return this.config.pollSeconds * 1000;
  }

  private get resolveOptions(): { ignoreAllDayBusy: boolean } {
    return { ignoreAllDayBusy: this.config.ignoreAllDayBusy };
  }

  /** Whether a channel of the status input is on in the configuration. A report through one that is off does not count. */
  private channelOn(via: Via): boolean {
    return via === 'api' ? this.config.statusInput.enabled : this.config.callSwitch.enabled;
  }

  /** The unexpired reports of the channels that are on. */
  private reports(now: number): InputReport[] {
    return this.inputs.active(now, (via) => this.channelOn(via));
  }

  /** Startup: the startup lines, Microsoft sign-in where no token is stored, the bulb, then the first tick. */
  start(): void {
    this.inputs.load(this.clock.now());
    void this.light.start();
    this.log.info(startup(this.options.version, this.sources.length, { enabled: this.light.enabled, host: this.light.host },
      this.config.sensors.length));
    if (this.sources.length === 0) {
      this.log.warn(noCalendars());
    }
    for (const source of this.sources) {
      source.startSignInIfNeeded();
    }
    this.writeState();
    this.pollTimer = this.clock.setInterval(() => void this.tick(), this.pollMs);
    this.stateTimer = this.clock.setInterval(() => this.writeState(), STATE_EVERY_MS);
    void this.tick();
  }

  stop(): void {
    this.stopped = true;
    for (const timer of [this.pollTimer, this.stateTimer]) {
      if (timer !== null) {
        this.clock.clearInterval(timer);
      }
    }
    for (const timer of [this.boundaryTimer, this.expiryTimer]) {
      if (timer !== null) {
        this.clock.clearTimeout(timer);
      }
    }
    this.boundaryTimer = null;
    this.expiryTimer = null;
    for (const source of this.sources) {
      source.stop();
    }
  }

  /** One tick (SPEC 8.1 item 2). A tick never overlaps the previous one. */
  async tick(): Promise<void> {
    if (this.ticking || this.stopped) {
      return;
    }
    this.ticking = true;
    try {
      const now = this.clock.now();
      this.lastTickAt = now;
      // SPEC 8.1 item 2: each source on its own interval, or the platform's when it has none.
      await Promise.all(this.sources.map((s) => s.runDue(now, (s.config.calendarSeconds ?? this.config.calendarSeconds) * 1000)));
      const bulbChosen = await this.light.maintain();
      await this.applyStatus(undefined, bulbChosen);
    } catch (err) {
      this.log.error(`Unexpected error: ${(err as Error).message}`);
    } finally {
      this.ticking = false;
    }
  }

  /**
   * Records a report from the status API or the switch (SPEC 18.7), logs it when it changed, and resolves again at
   * once, so the answer carries the resulting status.
   */
  async report(r: NewReport): Promise<ReportResult> {
    const outcome = this.inputs.report(r, this.clock.now());
    if (!outcome.ok) {
      return outcome;
    }
    if (outcome.changed) {
      this.log.info(senderReports(r.sender, STATUS_NAMES[r.status], r.app));
    }
    this.writeState();
    await this.applyStatus();
    return { ok: true, expiresAt: outcome.entry.expiresAt, status: this.status ?? 'unknown' };
  }

  /** Withdraws a sender's report (`clear`, or the switch turning off) and resolves again at once. */
  async clearInput(sender: string, auth: Auth | null, ts: number | null = null): Promise<Status> {
    if (this.inputs.clear(sender, auth, this.clock.now(), ts)) {
      this.log.info(senderCleared(sender));
    }
    this.writeState();
    await this.applyStatus();
    return this.status ?? 'unknown';
  }

  /** Turns the override on or off and resolves again at once (SPEC 7 item 5). */
  setOverride(on: boolean): Promise<void> {
    this.override = on;
    this.writeState();
    return this.applyStatus();
  }

  /** Resolves and applies, one at a time. `at` is a boundary time, for the boundary timer. */
  applyStatus(at?: number, resend = false): Promise<void> {
    this.queue = this.queue.then(() => this.applyNow(at, resend)).catch((err: unknown) => {
      this.log.error(`Unexpected error: ${(err as Error).message}`);
    });
    return this.queue;
  }

  /** Resolves once the queued applies are done. */
  idle(): Promise<void> {
    return this.queue;
  }

  private async applyNow(at: number | undefined, resend: boolean): Promise<void> {
    if (this.stopped) {
      return;
    }
    const now = Math.max(this.clock.now(), at ?? 0);
    for (const sender of this.inputs.sweep(now)) {
      this.log.info(senderExpired(sender));
    }
    const inputsOn = this.config.statusInput.enabled || this.config.callSwitch.enabled;
    const result = resolve(this.sources.map((s) => s.data()), this.override, now, this.resolveOptions,
      { on: inputsOn, reports: this.reports(now) });
    const changed = result.status !== this.status;
    this.reason = result.reason;
    if (changed) {
      this.status = result.status;
      if (result.status === 'unknown') {
        if (this.sources.length > 0) {
          this.log.warn(statusUnknown());
        }
      } else {
        this.log.info(statusLine(STATUS_NAMES[result.status], result.reason));
      }
      this.options.onStatus?.(result.status);
      this.writeState();
      if (result.status !== 'unknown') {
        await this.send(result.status, CHANGE_DURATION_MS, now);
      }
    } else if (result.status !== 'unknown' && (resend || this.refreshDue(now))) {
      await this.send(result.status, resend ? CHANGE_DURATION_MS : 0, now);
    }
    this.scheduleBoundary(now);
    this.scheduleExpiry(now);
  }

  /** SPEC 18.7 item 3: one timer for the next report to expire, so the status changes the moment it does. */
  private scheduleExpiry(now: number): void {
    if (this.expiryTimer !== null) {
      this.clock.clearTimeout(this.expiryTimer);
      this.expiryTimer = null;
    }
    const next = this.inputs.nextExpiry();
    if (next === null) {
      return;
    }
    this.expiryTimer = this.clock.setTimeout(() => {
      this.expiryTimer = null;
      void this.applyStatus(next);
    }, Math.max(0, next - now));
  }

  private refreshDue(now: number): boolean {
    const every = this.config.lifx.refreshSeconds * 1000;
    return this.light.enabled && every > 0 && this.lastSendAt !== null && now - this.lastSendAt >= every;
  }

  private async send(status: Exclude<Status, 'unknown'>, durationMs: number, now: number): Promise<void> {
    if (!this.light.enabled) {
      return;
    }
    this.lastSendAt = now;
    await this.light.send(this.config.colors[status], durationMs);
  }

  /** SPEC 8.1 item 3: one timer for the next event boundary, when that comes before the next tick. */
  private scheduleBoundary(now: number): void {
    if (this.boundaryTimer !== null) {
      this.clock.clearTimeout(this.boundaryTimer);
      this.boundaryTimer = null;
    }
    const events = freshData(this.sources.map((s) => s.data()), now).events;
    const next = nextBoundary(events, now, this.resolveOptions);
    if (next === null || next >= this.lastTickAt + this.pollMs) {
      return;
    }
    this.boundaryTimer = this.clock.setTimeout(() => {
      this.boundaryTimer = null;
      void this.applyStatus(next);
    }, next - now);
  }

  /** The state file of SPEC 10.1. */
  stateFile(): StateFile {
    const waiting = this.sources.find((s) => s.auth?.code);
    const code = waiting?.auth?.code;
    const status = this.status ?? 'unknown';
    return {
      version: 1,
      updatedAt: new Date(this.clock.now()).toISOString(),
      status,
      reason: status !== 'unknown' && this.reason
        ? {
          source: this.reason.source,
          until: this.reason.until === null ? null : new Date(this.reason.until).toISOString(),
          ...(this.reason.app ? { app: this.reason.app } : {}),
        }
        : null,
      override: this.override,
      sources: this.sources.map((s) => s.stateEntry()),
      signIn: waiting && code
        ? { id: waiting.config.id, verificationUri: code.verificationUri, userCode: code.userCode, expiresAt: new Date(code.expiresAt).toISOString() }
        : null,
      light: this.light.state(),
      statusInput: { enabled: this.config.statusInput.enabled, port: this.config.statusInput.port, ...this.inputServerStatus() },
      inputs: this.inputs.list(this.clock.now()).map((e) => ({
        sender: e.sender,
        status: e.status,
        app: e.app,
        via: e.via,
        auth: e.auth,
        lastHeard: new Date(e.lastHeard).toISOString(),
        expiresAt: e.expiresAt === null ? null : new Date(e.expiresAt).toISOString(),
        active: e.active,
      })),
    };
  }

  writeState(): void {
    try {
      writeState(this.options.storageDir, this.stateFile());
    } catch (err) {
      this.log.debug(`Could not write state.json: ${(err as Error).message}`);
    }
  }
}
