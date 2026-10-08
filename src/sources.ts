/**
 * Runs each configured source: when it is due, what it last delivered, its state of SPEC 8.3, the retry schedule,
 * and the source log lines of SPEC 12. A Microsoft source has up to two parts (presence and calendar), each with
 * its own schedule; the source's state is the worse of the two.
 */
import type { CalendarReport, CalendarSource, IcsSettings } from './calendar.js';
import type { CalendarChoice, SourceConfig, SourceType } from './config.js';
import { SourceError, toSourceError } from './errors.js';
import { GraphClient } from './graph.js';
import { ICloudSource } from './icloud.js';
import type { Log } from './log.js';
import { calendarsNotInUse, icloudDiscovery, icloudRejected, listedCalendarGone, sourceFailed, sourceRecovered } from './messages.js';
import { MicrosoftAuth, TokenStore, tokenFile } from './microsoft.js';
import type { CalEvent, Presence, SourceData } from './status.js';
import { UrlSource } from './url-source.js';

export type SourceState = 'checking' | 'connected' | 'signInNeeded' | 'notReachable';

/** After a failure a source is tried again after 1, 2, 5 and then 15 minutes (SPEC 8.3 item 1). */
export const RETRY_MS = [60_000, 120_000, 300_000, 900_000];
/** iCloud Sign-in needed is tried hourly only, so a wrong password cannot lock the Apple ID (item 2). */
export const ICLOUD_SIGN_IN_RETRY_MS = 3_600_000;

const RANK: Record<SourceState, number> = { connected: 0, checking: 1, notReachable: 2, signInNeeded: 3 };

/** One read with its own schedule. */
class Part {
  state: SourceState = 'checking';
  failures = 0;
  nextAt = 0;
  lastAttempt: number | null = null;
  lastSuccess: number | null = null;
  error: SourceError | null = null;

  succeed(now: number, next: number): void {
    this.state = 'connected';
    this.failures = 0;
    this.error = null;
    this.lastAttempt = now;
    this.lastSuccess = now;
    this.nextAt = next;
  }

  /** Records a failure and returns how long until the next try. */
  fail(now: number, err: SourceError, type: SourceType): number {
    this.state = err.state;
    this.error = err;
    this.lastAttempt = now;
    this.failures++;
    let delay: number;
    if (err.options.noToken) {
      delay = 0; // only the token file is checked, so every tick is cheap
    } else if (err.state === 'signInNeeded' && type === 'icloud') {
      delay = ICLOUD_SIGN_IN_RETRY_MS;
    } else {
      delay = RETRY_MS[Math.min(this.failures, RETRY_MS.length) - 1];
    }
    delay = Math.max(delay, err.options.retryAfterMs ?? 0);
    this.nextAt = now + delay;
    return delay;
  }
}

export interface SourceRunnerOptions {
  config: SourceConfig;
  storageDir: string;
  ics: IcsSettings;
  log: Log;
  now?: () => number;
  /** Replaces the Microsoft sign-in's waits (tests). */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  /** False for the CLI `check`, which prints each source's reason itself and does not try again. */
  logFailures?: boolean;
  /** False for the CLI `check`: a lost Microsoft sign-in never starts the device code flow by itself. */
  autoSignIn?: boolean;
  /** Called when the state, the sign-in code or the error changes, so the state file can be written. */
  onChange?: () => void;
}

/** The `sources[]` entry of the state file (SPEC 10.1). */
export interface SourceStateEntry {
  id: string;
  name: string;
  type: SourceType;
  state: SourceState;
  lastChecked: string | null;
  events: number | null;
  error: string | null;
  help?: string;
}

export class SourceRunner {
  readonly config: SourceConfig;
  readonly auth: MicrosoftAuth | null = null;
  private readonly calendar: CalendarSource | null = null;
  private readonly graph: GraphClient | null = null;
  private readonly calendarPart: Part | null = null;
  private readonly presencePart: Part | null = null;
  private events: CalEvent[] | null = null;
  private presence: Presence | null = null;
  /** A failure warning was written and no recovery line yet. */
  private warned = false;
  /** Listed calendars reported missing, so the "Listed calendar gone" line is written once until each is found again. */
  private readonly gone = new Set<string>();
  private readonly log: Log;
  private readonly now: () => number;

  constructor(private readonly options: SourceRunnerOptions) {
    this.config = options.config;
    this.log = options.log;
    this.now = options.now ?? Date.now;
    const c = options.config;
    if (c.type === 'icloud') {
      this.calendar = new ICloudSource(c, options.ics, this.report());
      this.calendarPart = new Part();
    } else if (c.type === 'google' || c.type === 'url') {
      this.calendar = new UrlSource(c, options.ics);
      this.calendarPart = new Part();
    } else {
      this.auth = new MicrosoftAuth({
        source: c,
        store: new TokenStore(tokenFile(options.storageDir, c.id)),
        log: options.log,
        now: this.now,
        sleep: options.sleep,
        autoSignIn: options.autoSignIn,
        onChange: () => options.onChange?.(),
      });
      this.graph = new GraphClient(this.auth, c.name, this.now, { calendars: c.calendars, report: this.report() });
      if (c.useCalendar) {
        this.calendar = this.graph;
        this.calendarPart = new Part();
      }
      if (c.useTeamsStatus) {
        this.presencePart = new Part();
      }
    }
  }

  get name(): string {
    return this.config.name;
  }

  /** The log lines about the calendars a source chose (SPEC 12): found and in use, not in use, and gone. */
  private report(): CalendarReport {
    return {
      discovered: (found, used, notInUse) => {
        this.log.info(icloudDiscovery(this.name, found, used));
        if (notInUse.length) {
          this.log.info(calendarsNotInUse(this.name, notInUse));
        }
      },
      listed: (choice: CalendarChoice, present: boolean) => {
        const key = choice.id ?? `name:${choice.name.toLowerCase()}`;
        if (present) {
          this.gone.delete(key);
        } else if (!this.gone.has(key)) {
          this.gone.add(key);
          // The id can hold the iCloud account number, so only the name is ever shown.
          this.log.warn(listedCalendarGone(this.name, choice.name || 'Unnamed calendar'));
        }
      },
    };
  }

  /** True when this source reads Teams presence. */
  get usesPresence(): boolean {
    return this.presencePart !== null;
  }

  private parts(): Part[] {
    return [this.presencePart, this.calendarPart].filter((p): p is Part => p !== null);
  }

  /** The worse of the parts' states. */
  get state(): SourceState {
    return this.parts().map((p) => p.state).reduce((a, b) => (RANK[b] > RANK[a] ? b : a), 'connected' as SourceState);
  }

  private worstError(): SourceError | null {
    let worst: Part | null = null;
    for (const p of this.parts()) {
      if (p.error && (!worst || RANK[p.state] > RANK[worst.state])) {
        worst = p;
      }
    }
    return worst?.error ?? null;
  }

  /** What the status model needs (SPEC 6.5). */
  data(): SourceData {
    return {
      events: this.calendarPart ? this.events : null,
      eventsCheckedAt: this.calendarPart?.lastSuccess ?? null,
      presence: this.presencePart ? this.presence : null,
      presenceCheckedAt: this.presencePart?.lastSuccess ?? null,
    };
  }

  stateEntry(): SourceStateEntry {
    const attempts = this.parts().map((p) => p.lastAttempt).filter((t): t is number => t !== null);
    let error = this.state === 'connected' || this.state === 'checking' ? null : this.worstError();
    if (error?.options.noToken && this.auth && !this.auth.hasToken()) {
      error = this.auth.notSignedIn(); // the sign-in moves on between ticks (a code, a refusal)
    }
    const entry: SourceStateEntry = {
      id: this.config.id,
      name: this.config.name,
      type: this.config.type,
      state: this.state,
      lastChecked: attempts.length ? new Date(Math.max(...attempts)).toISOString() : null,
      events: this.calendarPart ? (this.events?.length ?? 0) : null,
      error: error?.message ?? null,
    };
    if (error?.options.help) {
      entry.help = error.options.help;
    }
    return entry;
  }

  /** Starts the Microsoft device code flow when no token is stored (SPEC 4.3 item 5). */
  startSignInIfNeeded(): void {
    if (this.auth && !this.auth.hasToken()) {
      this.auth.startSignIn();
    }
  }

  stop(): void {
    this.auth?.stop();
  }

  /** Presence is read on every tick; the calendar when `calendarMs` has passed since its last check. */
  async runDue(now: number, calendarMs: number): Promise<void> {
    const jobs: Promise<void>[] = [];
    if (this.presencePart && now >= this.presencePart.nextAt) {
      jobs.push(this.run(this.presencePart, now, 0, async () => {
        this.presence = await this.graph!.getPresence();
      }));
    }
    if (this.calendarPart && now >= this.calendarPart.nextAt) {
      jobs.push(this.run(this.calendarPart, now, calendarMs, async () => {
        this.events = await this.calendar!.fetchEvents(now);
        this.log.debug(`${this.name}: ${this.events.length} events in the window.`);
      }));
    }
    await Promise.all(jobs);
  }

  /** Fetches once, for the CLI `check`, regardless of schedule. */
  async runOnce(now: number): Promise<void> {
    for (const p of this.parts()) {
      p.nextAt = 0;
    }
    await this.runDue(now, 0);
  }

  /** The events from the last successful calendar check. */
  get lastEvents(): CalEvent[] | null {
    return this.events;
  }

  get lastPresence(): Presence | null {
    return this.presence;
  }

  private async run(part: Part, now: number, successInterval: number, read: () => Promise<void>): Promise<void> {
    const before = this.state;
    const beforeError = this.worstError()?.message ?? null;
    let delay = 0;
    let failure: SourceError | null = null;
    try {
      await read();
      part.succeed(this.now(), now + successInterval);
    } catch (err) {
      failure = toSourceError(err);
      delay = part.fail(this.now(), failure, this.config.type);
    }
    const after = this.state;
    const failed = (s: SourceState) => s === 'signInNeeded' || s === 'notReachable';
    if (failure && this.options.logFailures !== false) {
      const line = this.failureLine(failure, delay);
      // Presence and calendar run in parallel, so both can see the source as working before either fails:
      // the warning is written once per source.
      if (line.level === 'warn' && !failed(before) && !this.warned) {
        this.log.warn(line.text);
        this.warned = true;
      } else {
        this.log.debug(line.text);
      }
      if (failure.options.refused) {
        this.warned = true;
      }
    } else if (after === 'connected' && failed(before) && this.warned) {
      this.warned = false;
      this.log.info(sourceRecovered(this.name));
    }
    if (after !== before || (this.worstError()?.message ?? null) !== beforeError) {
      this.options.onChange?.();
    }
  }

  /** The line for a failure: the iCloud 401 line, the generic failed line, or (for sign-in) a debug note only. */
  private failureLine(err: SourceError, delay: number): { level: 'warn' | 'debug'; text: string } {
    if (err.options.unauthorized) {
      return { level: 'warn', text: icloudRejected(this.name) };
    }
    if (err.options.refused || err.options.noToken) {
      // The Microsoft lines (code, refused, gave up) are written by the sign-in itself.
      return { level: 'debug', text: `${this.name}: ${err.message}.` };
    }
    return { level: 'warn', text: sourceFailed(this.name, err.message, Math.max(1, Math.ceil(delay / 60_000))) };
  }
}
