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
import { noCalendars, senderCleared, senderExpired, senderReports, startup, statusLine, statusUnknown, workingOff, workingOn } from './messages.js';
import { STATUS_NAMES } from './model.js';
import type { Status } from './model.js';
import { SourceRunner } from './sources.js';
import { readInstanceId } from './status-api.js';
import { writeState } from './state.js';
import type { AddressChange, StateFile } from './state.js';
import { freshData, meetingAhead, nextBoundary, resolve } from './status.js';
import type { InputReport, Reason, Resolution } from './status.js';

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

/** Node's largest timer delay, 2^31 - 1 ms (about 24.8 days); a longer one fires at once (SPEC 8.1 item 5). */
export const MAX_TIMER_MS = 2_147_483_647;
/** A timer that fires this close to its time counts as due (SPEC 8.1 item 5). */
export const EARLY_MS = 1000;

/**
 * One timer for a time by the clock (SPEC 8.1 item 5): every delay is clamped to Node's maximum, and a timer that
 * fires more than a second early is set again for the time left, so a far time never fires at once.
 */
export class ClockTimer {
  private handle: unknown = null;

  constructor(private readonly clock: Clock) {}

  /** Calls `fn` at `at`, replacing any time set before. */
  set(at: number, fn: () => void): void {
    this.clear();
    const arm = (): void => {
      this.handle = this.clock.setTimeout(() => {
        this.handle = null;
        if (at - this.clock.now() > EARLY_MS) {
          arm();
        } else {
          fn();
        }
      }, Math.min(MAX_TIMER_MS, Math.max(0, at - this.clock.now())));
    };
    arm();
  }

  clear(): void {
    if (this.handle !== null) {
      this.clock.clearTimeout(this.handle);
      this.handle = null;
    }
  }
}

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
  /** The Working switch's state at startup (SPEC 6.6); without the switch, working. */
  working?: boolean;
  /** Called on every status change, to update the sensors. */
  onStatus?: (status: Status) => void;
  /** Called when the meeting warning begins or ends, for the Meeting Soon sensor (SPEC 6.7). */
  onMeetingSoon?: (on: boolean) => void;
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
  /** False while the Working switch is off (SPEC 6.6). */
  working: boolean;
  /** The meeting warning while it is on (SPEC 6.7): the meeting's start. */
  meetingWarning: { meetingAt: number } | null = null;

  private readonly config: BusyLightConfig;
  private readonly clock: Clock;
  private readonly log: Log;
  private ticking = false;
  private queue: Promise<void> = Promise.resolve();
  private readonly boundaryTimer: ClockTimer;
  private readonly expiryTimer: ClockTimer;
  private pollTimer: unknown = null;
  private stateTimer: unknown = null;
  private lastSendAt: number | null = null;
  private stopped = false;
  /** The status input server's state, set by the platform; without a server the input is not listening. */
  inputServerStatus: () => InputServerStatus;

  constructor(private readonly options: EngineOptions) {
    this.config = options.config;
    this.clock = options.clock ?? systemClock;
    this.log = options.log;
    this.override = options.override ?? false;
    this.working = options.working ?? true;
    this.boundaryTimer = new ClockTimer(this.clock);
    this.expiryTimer = new ClockTimer(this.clock);
    const ics = { outOfOfficeWords: this.config.outOfOfficeWords, ownerAddresses: ownerAddresses(this.config) };
    const now = () => this.clock.now();
    this.sources = this.config.calendars.map((config) => new SourceRunner({
      config, storageDir: options.storageDir, ics, log: this.log, now, sleep: options.sleep, onChange: () => this.writeState(),
      // SPEC 8.1 item 3: the boundary timer follows the cached events as soon as they change, not when the tick ends.
      onData: () => this.scheduleBoundary(this.clock.now()),
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
    this.log.info(startup(this.options.version, this.sources.length, { enabled: this.light.enabled, hosts: this.light.hosts },
      this.config.sensors.length));
    if (this.sources.length === 0) {
      this.log.warn(noCalendars());
    }
    if (!this.working) {
      // Restored off: the log says why the light is off (SPEC 6.6 item 3).
      this.log.info(workingOff(this.config.name));
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
    this.boundaryTimer.clear();
    this.expiryTimer.clear();
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
      // SPEC 8.1 item 2: each source on its own interval, or the platform's when it has none.
      await Promise.all(this.sources.map((s) => s.runDue(now, (s.config.calendarSeconds ?? this.config.calendarSeconds) * 1000)));
      // A bulb chosen or found at a new address is sent the last color by the light controller (SPEC 13.3 items 2 and 4).
      await this.light.maintain();
      await this.applyStatus();
      await this.light.settled();
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

  /**
   * The Working switch turned on or off (SPEC 6.6): its line when the state changes, then the status at once. Off is
   * `notWorking`, above every rule; on resolves as usual.
   */
  setWorking(on: boolean): Promise<void> {
    if (on !== this.working) {
      this.working = on;
      this.log.info(on ? workingOn(this.config.name) : workingOff(this.config.name));
    }
    this.writeState();
    return this.applyStatus();
  }

  /** Turns the override on or off and resolves again at once (SPEC 7 item 5). */
  setOverride(on: boolean): Promise<void> {
    this.override = on;
    this.writeState();
    return this.applyStatus();
  }

  /**
   * Resolves and applies, one at a time. `at` is a boundary time, for the boundary timer. An apply puts its color on
   * every bulb's lane and goes on, so one bulb still trying never holds up the next color on the others (SPEC 13.3 item 1).
   */
  applyStatus(at?: number): Promise<void> {
    this.queue = this.queue.then(() => this.applyNow(at)).catch((err: unknown) => {
      this.log.error(`Unexpected error: ${(err as Error).message}`);
    });
    return this.queue;
  }

  /** Resolves once the queued applies are done and every bulb has its color (or has stopped trying). */
  idle(): Promise<void> {
    return this.queue.then(() => this.light.settled());
  }

  private async applyNow(at: number | undefined): Promise<void> {
    if (this.stopped) {
      return;
    }
    // A timer's time is the resolve's only when it fired within a second of it (SPEC 8.1 item 5).
    const now = at !== undefined && at - this.clock.now() <= EARLY_MS ? Math.max(this.clock.now(), at) : this.clock.now();
    for (const sender of this.inputs.sweep(now)) {
      this.log.info(senderExpired(sender));
    }
    const inputsOn = this.config.statusInput.enabled || this.config.callSwitch.enabled;
    // The Working switch off comes before every rule (SPEC 6.6); reports and boundaries are still tracked.
    const result: Resolution | { status: 'notWorking'; reason: null } = this.working
      ? resolve(this.sources.map((s) => s.data()), this.override, now, this.resolveOptions, { on: inputsOn, reports: this.reports(now) })
      : { status: 'notWorking', reason: null };
    const changed = result.status !== this.status;
    this.reason = result.reason;
    // SPEC 6.7: the meeting warning, while the status is Available and a calendar meeting is that close.
    const ahead = result.status === 'available' ? this.meetingAhead(now) : null;
    const warning = ahead !== null && ahead - now <= this.config.meetingWarningSeconds * 1000 ? { meetingAt: ahead } : null;
    const hadWarning = this.meetingWarning !== null;
    const warningChanged = (warning?.meetingAt ?? null) !== (this.meetingWarning?.meetingAt ?? null);
    this.meetingWarning = warning;
    if (changed) {
      this.status = result.status;
      if (result.status === 'unknown') {
        if (this.sources.length > 0) {
          this.log.warn(statusUnknown());
        }
      } else if (result.status !== 'notWorking') {
        // Not working has the Working lines instead (SPEC 6.6 item 3).
        this.log.info(statusLine(STATUS_NAMES[result.status], result.reason, now));
      }
      this.options.onStatus?.(result.status);
      if (warningChanged) {
        this.options.onMeetingSoon?.(warning !== null);
      }
      this.writeState();
      if (warning) {
        // Available began inside the warning time: the fade starts from the Available color (SPEC 6.7 item 3).
        this.sendWarning(warning, now, true);
      } else if (result.status !== 'unknown') {
        this.send(result.status, CHANGE_DURATION_MS, now);
      }
    } else if (result.status !== 'unknown') {
      if (warningChanged) {
        this.options.onMeetingSoon?.(warning !== null);
        this.writeState();
      }
      if (warning && warningChanged) {
        this.sendWarning(warning, now, false);
      } else if (!warning && hadWarning) {
        // The warning ended before the meeting: the normal apply replaces the fade at once (SPEC 6.7 item 4).
        this.send(result.status, CHANGE_DURATION_MS, now);
      } else if (!warning && this.refreshDue(now)) {
        // No refresh during the warning, which would end the fade (SPEC 6.7 item 6).
        this.send(result.status, 0, now);
      }
    }
    // From the clock after the send is put on the bulbs' lanes (SPEC 8.1 item 3).
    const after = Math.max(this.clock.now(), now);
    this.scheduleBoundary(after);
    this.scheduleExpiry(after);
  }

  /** SPEC 18.7 item 3: one timer for the next report to expire, so the status changes the moment it does. */
  private scheduleExpiry(now: number): void {
    const next = this.inputs.nextExpiry();
    if (next === null) {
      this.expiryTimer.clear();
      return;
    }
    this.expiryTimer.set(Math.max(next, now), () => void this.applyStatus(next));
  }

  private refreshDue(now: number): boolean {
    const every = this.config.lifx.refreshSeconds * 1000;
    return this.light.enabled && every > 0 && this.lastSendAt !== null && now - this.lastSendAt >= every;
  }

  /**
   * SPEC 6.7 item 1: the start of the next meeting when the status is Available and the next change is to In a
   * meeting, while the settings allow a warning (on, the In a meeting color not off, working); null otherwise.
   */
  private meetingAhead(now: number): number | null {
    if (this.config.meetingWarningSeconds <= 0 || !this.working || this.config.colors.inMeeting === 'off') {
      return null;
    }
    const fresh = freshData(this.sources.map((s) => s.data()), now);
    return meetingAhead(this.override, fresh.presence, fresh.events, now, this.resolveOptions, this.reports(now));
  }

  /**
   * The meeting warning's fade (SPEC 6.7 item 3): to the In a meeting color, until the meeting starts. With the Available
   * color off the bulb comes on dim first; `fromAvailable` sets the Available color first, when the bulb may not show it.
   */
  private sendWarning(warning: { meetingAt: number }, now: number, fromAvailable: boolean): void {
    if (!this.light.enabled) {
      return;
    }
    this.lastSendAt = now;
    const available = this.config.colors.available;
    this.log.debug(`Meeting warning: fading over ${Math.round((warning.meetingAt - now) / 1000)} seconds.`);
    this.light.sendFade({ from: available === 'off' ? 'off' : fromAvailable ? available : null, to: this.config.colors.inMeeting,
      until: warning.meetingAt }).catch((err: unknown) => this.log.error(`Unexpected error: ${(err as Error).message}`));
  }

  /**
   * Puts a status's color on every bulb's lane, without waiting for the answers (SPEC 13.3 item 1); not working turns
   * the light off, whatever the Offline color (SPEC 6.6 item 1).
   */
  private send(status: Exclude<Status, 'unknown'>, durationMs: number, now: number): void {
    if (!this.light.enabled) {
      return;
    }
    this.lastSendAt = now;
    this.light.send(status === 'notWorking' ? 'off' : this.config.colors[status], durationMs)
      .catch((err: unknown) => this.log.error(`Unexpected error: ${(err as Error).message}`));
  }

  /**
   * SPEC 8.1 item 3: one timer for the next event boundary, set after every apply and whenever a source's events
   * change, whether or not the next tick comes first: a tick resolves only once its calendar checks finish.
   */
  private scheduleBoundary(now: number): void {
    if (this.stopped) {
      return;
    }
    const events = freshData(this.sources.map((s) => s.data()), now).events;
    let next = nextBoundary(events, now, this.resolveOptions);
    // The beginning of a meeting warning is timed the same way (SPEC 6.7 item 2).
    const ahead = this.meetingAhead(now);
    const begins = ahead === null ? null : ahead - this.config.meetingWarningSeconds * 1000;
    if (begins !== null && begins > now && (next === null || begins < next)) {
      next = begins;
    }
    if (next === null) {
      this.boundaryTimer.clear();
      return;
    }
    this.boundaryTimer.set(next, () => void this.applyStatus(next));
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
      lights: this.light.lights(),
      statusInput: {
        enabled: this.config.statusInput.enabled, port: this.config.statusInput.port, ...this.inputServerStatus(),
        reported: Object.fromEntries(Object.entries(this.inputs.reported()).map(([status, at]) => [status, new Date(at).toISOString()])),
      },
      meetingWarning: this.meetingWarning ? { meetingAt: new Date(this.meetingWarning.meetingAt).toISOString() } : null,
      inputs: this.inputs.list(this.clock.now()).map((e) => ({
        sender: e.sender,
        status: e.status,
        app: e.app,
        via: e.via,
        auth: e.auth,
        lastHeard: new Date(e.lastHeard).toISOString(),
        expiresAt: e.expiresAt === null ? null : new Date(e.expiresAt).toISOString(),
        active: e.active,
        ended: e.ended,
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
