/**
 * Which LIFX bulbs to use and keeping hold of them (SPEC 13.2 and 13.3): configured addresses, the remembered bulbs,
 * or discovery; rediscovery while a bulb wanted is not found or a chosen one stops answering; sends to every chosen
 * bulb at the same moment, each on its own; and the bulb log lines.
 */
import path from 'node:path';
import type { LifxConfig } from './config.js';
import { readJson, writeFileAtomic } from './files.js';
import type { Bulb, LifxClient } from './lifx.js';
import { normalizeSerial } from './lifx.js';
import type { Log } from './log.js';
import { bulbBack, bulbNotNamed, bulbSilent, bulbsFound, noBulb, severalBulbs } from './messages.js';

/** Discovery runs again at most this often (SPEC 13.2 item 4). */
export const REDISCOVER_MS = 5 * 60_000;
/** Sends in a row without an answer before discovery runs again. */
export const SILENT_SENDS = 3;
/** The fade of a color sent to a bulb chosen later or found at a new address (SPEC 8.2 item 4). */
const CHANGE_MS = 1000;

export type Found = 'configured' | 'remembered' | 'discovered';

/** One entry of the state file's `lights` (SPEC 10.1 item 5), as `light` was before build 3.2. */
export interface LightState {
  enabled: boolean;
  label: string | null;
  /**
   * The bulb's serial number (from build 3.3, SPEC 10.1 item 5), null for a bulb given only by its address or while none
   * is chosen. Absent in a state file written before 1.0.0.
   */
  serial?: string | null;
  host: string | null;
  found: Found | null;
  lastSent: string | null;
  lastSentAt: string | null;
  answered: boolean | null;
}

/** What one send did for one bulb. */
export interface SendResult {
  label: string | null;
  host: string;
  answered: boolean;
}

/** A chosen bulb, with its own record of sends (SPEC 13.3 item 2). */
interface Chosen {
  /** Null for a bulb given only by its address: packets go tagged with a zero target. */
  serial: string | null;
  label: string | null;
  host: string;
  found: Found;
  /** The entry of `lifx.bulbs` it stands for, or null when nothing named it (the only bulb found, or an address). */
  wanted: string | null;
  silent: number;
  silentLogged: boolean;
  /** A remembered address not sent to yet: when its first send is not acknowledged, discovery runs at once. */
  untried: boolean;
  lastSent: string | null;
  lastSentAt: number | null;
  answered: boolean | null;
  /** The send in progress on this bulb's own lane (SPEC 13.3 item 1), and the next one waiting behind it. */
  running: Promise<void> | null;
  pending: Job | null;
  /** A send of its own is waiting on a discovery for it, and will send to the address it finds. */
  handling: boolean;
}

/** One send for one bulb, and everyone waiting for its result (a newer send replaces an older one still waiting). */
interface Job {
  color: string;
  sendTo: (to: Chosen) => Promise<boolean>;
  waiters: ((result: SendResult) => void)[];
}

/** The last send, replayed to a bulb that a discovery moves or chooses (SPEC 13.2 item 4, 13.3 items 2 and 4). */
interface LastSend {
  color: string;
  /** For a color, sent with the 1 second fade of 8.2 item 4; for the meeting warning, the fade until the meeting. */
  sendTo: (to: Chosen) => Promise<boolean>;
}

/** A bulb line and its level. */
interface Line {
  level: 'info' | 'warn';
  text: () => string;
}

/** One bulb of `busy-light/light.json`. */
export interface Remembered {
  serial: string;
  label: string;
  host: string;
}

export function lightFile(storageDir: string): string {
  return path.join(storageDir, 'light.json');
}

/** The bulbs of `light.json`: `{ "bulbs": [...] }` from build 3.2, or the one object written before it. */
export function readRememberedBulbs(storageDir: string): Remembered[] {
  const raw = readJson(lightFile(storageDir)) as { bulbs?: unknown } | null;
  const list: unknown[] = raw && Array.isArray(raw.bulbs) ? raw.bulbs : raw ? [raw] : [];
  const out: Remembered[] = [];
  for (const item of list) {
    const r = item as Partial<Remembered> | null;
    const serial = r && typeof r.serial === 'string' ? normalizeSerial(r.serial) : null;
    if (r && serial && typeof r.host === 'string') {
      out.push({ serial, label: typeof r.label === 'string' ? r.label : '', host: r.host });
    }
  }
  return out;
}

/**
 * The state file's bulbs with a missing serial number or name filled from light.json (SPEC 10.1 item 5, 10.3, from
 * build 3.3): a state file written before 1.0.0 has no serial, matched here by address, and a bulb may be remembered
 * with a name the state file lacks. A serial that is null (a bulb given by its address) stays null.
 */
export function withRemembered(lights: LightState[], remembered: Remembered[]): LightState[] {
  return lights.map((light) => {
    const match = (light.serial ? remembered.find((r) => r.serial === light.serial) : undefined)
      ?? (light.host ? remembered.find((r) => r.host === light.host) : undefined);
    if (!match || (light.serial !== undefined && light.label)) {
      return light;
    }
    return { ...light, serial: light.serial === undefined ? match.serial : light.serial, label: light.label || match.label || null };
  });
}

/** Whether a bulb is the one an entry of `lifx.bulbs` names, by name without regard to case or by serial number. */
export function matchesBulb(wanted: string, bulb: { label: string; serial: string }): boolean {
  const w = wanted.trim();
  if (!w) {
    return true;
  }
  const serial = normalizeSerial(w);
  return (serial !== null && serial === bulb.serial) || bulb.label.toLowerCase() === w.toLowerCase();
}

function chosen(bulb: { serial: string | null; label: string | null; host: string }, found: Found, wanted: string | null): Chosen {
  return {
    serial: bulb.serial, label: bulb.label || null, host: bulb.host, found, wanted, silent: 0, silentLogged: false,
    untried: found === 'remembered', lastSent: null, lastSentAt: null, answered: null, running: null, pending: null, handling: false,
  };
}

export interface LightControllerOptions {
  config: LifxConfig;
  client: LifxClient;
  log: Log;
  /** Where light.json lives, or null to neither read nor write it. */
  storageDir: string | null;
  /** False for the CLI: use the remembered bulbs but never write light.json. */
  remember?: boolean;
  /** False for the CLI, which prints one answer line per bulb itself: no "bulb silent" or "bulb back" lines. */
  reportSends?: boolean;
  now?: () => number;
  onChange?: () => void;
}

export class LightController {
  private chosen: Chosen[] = [];
  private starting: Promise<void> | null = null;
  private discovering: Promise<void> | null = null;
  /** How many discoveries have started, so a send can tell whether one ran while it was trying. */
  private discoveries = 0;
  private lastSend: LastSend | null = null;
  /** Every lane's send in progress, for `settled`. */
  private readonly inFlight = new Set<Promise<void>>();
  private lastDiscovery: number | null = null;
  private lastOutcome: string | null = null;
  private readonly now: () => number;

  constructor(private readonly options: LightControllerOptions) {
    this.now = options.now ?? Date.now;
  }

  get enabled(): boolean {
    return this.options.config.enabled;
  }

  /** The addresses in use, in the order of `lifx.bulbs` (or of `lifx.host`). */
  get hosts(): string[] {
    return this.chosen.map((c) => c.host);
  }

  /** The state file's `lights` (SPEC 10.1 item 5): one entry per chosen bulb, or one as `light` was while none is. */
  lights(): LightState[] {
    if (this.chosen.length === 0) {
      return [{ enabled: this.enabled, label: null, serial: null, host: null, found: null, lastSent: null, lastSentAt: null, answered: null }];
    }
    return this.chosen.map((c) => ({
      enabled: true,
      label: c.label,
      serial: c.serial,
      host: c.host,
      found: c.found,
      lastSent: c.lastSent,
      lastSentAt: c.lastSentAt === null ? null : new Date(c.lastSentAt).toISOString(),
      answered: c.answered,
    }));
  }

  /**
   * SPEC 13.2 item 2: the configured addresses, else the remembered bulbs that fit the configuration, else discovery.
   * Resolves once the bulbs are chosen or discovery has finished.
   */
  start(): Promise<void> {
    this.starting ??= this.choose();
    return this.starting;
  }

  private async choose(): Promise<void> {
    const { config } = this.options;
    if (!config.enabled) {
      return;
    }
    if (config.hosts.length > 0) {
      this.chosen = config.hosts.map((host) => chosen({ serial: null, label: null, host }, 'configured', null));
      this.options.onChange?.();
      return;
    }
    const remembered = this.readRemembered();
    if (config.bulbs.length > 0) {
      for (const wanted of config.bulbs) {
        const bulb = remembered.find((r) => matchesBulb(wanted, r));
        if (bulb && !this.chosen.some((c) => c.serial === bulb.serial)) {
          this.chosen.push(chosen(bulb, 'remembered', wanted));
        }
      }
      if (this.chosen.length > 0) {
        this.options.onChange?.();
      }
      if (config.bulbs.every((w) => this.satisfied(w))) {
        return;
      }
    } else if (remembered.length === 1) {
      this.chosen = [chosen(remembered[0], 'remembered', null)];
      this.options.onChange?.();
      return;
    }
    await this.discover();
  }

  /** `light.json`: `{ "bulbs": [...] }` from build 3.2, or the one object written before it. */
  private readRemembered(): Remembered[] {
    return this.options.storageDir ? readRememberedBulbs(this.options.storageDir) : [];
  }

  private remember(): void {
    const bulbs = this.chosen.filter((c) => c.serial !== null);
    if (!this.options.storageDir || this.options.remember === false || bulbs.length === 0) {
      return;
    }
    const data = { bulbs: bulbs.map((c) => ({ serial: c.serial, label: c.label ?? '', host: c.host })) };
    try {
      writeFileAtomic(lightFile(this.options.storageDir), `${JSON.stringify(data, null, 2)}\n`, 0o600);
    } catch (err) {
      this.options.log.debug(`Could not save light.json: ${(err as Error).message}`);
    }
  }

  /** One discovery at a time: a second caller waits for the one running. */
  private discover(): Promise<void> {
    this.discovering ??= this.runDiscovery().finally(() => {
      this.discovering = null;
    });
    return this.discovering;
  }

  /**
   * Runs discovery and applies the choosing rules for every bulb wanted, writing the bulb lines only when the outcome
   * changes. A chosen bulb with a serial number is never replaced by a different bulb unless `lifx.bulbs` names that
   * one (SPEC 13.2 item 4), each bulb on its own: when it is not found it is kept, and the next discovery looks for it
   * again by its serial number. Only while no bulb has been chosen (none this run, none remembered that fits) does
   * discovery pick one. A kept bulb's record is updated in place, so a send running beside discovery sees its address.
   */
  private async runDiscovery(): Promise<void> {
    this.lastDiscovery = this.now();
    this.discoveries++;
    const hostsBefore = new Map(this.chosen.map((c) => [c, c.host]));
    const bulbs = await this.options.client.discover();
    const wanted = this.options.config.bulbs;
    const previous = this.chosen;
    if (bulbs.length === 0) {
      // Keep every bulb we had: it may only be switched off.
      this.log(`none|${previous.map((c) => c.serial).join(',')}`, [{ level: 'warn', text: () => noBulb() }]);
      return;
    }
    const next: Chosen[] = [];
    const missing: string[] = [];
    /** Chosen before and not found now: kept, but not in use by this discovery's lines. */
    const kept = new Set<Chosen>();
    const take = (bulb: Bulb, before: Chosen | undefined, w: string | null): void => {
      if (next.some((c) => c.serial === bulb.serial)) {
        return;
      }
      if (before && before.serial === bulb.serial) {
        before.host = bulb.host;
        before.label = bulb.label || null;
        before.found = 'discovered';
        before.untried = false;
        before.silent = 0;
        next.push(before);
      } else {
        next.push(chosen(bulb, 'discovered', w));
      }
    };
    if (wanted.length > 0) {
      for (const w of wanted) {
        const before = previous.find((c) => c.wanted === w);
        const same = before?.serial ? bulbs.find((b) => b.serial === before.serial) : undefined;
        const named = bulbs.find((b) => b.serial !== before?.serial && matchesBulb(w, b));
        const pick = same && (!named || matchesBulb(w, same)) ? same : named;
        if (pick) {
          take(pick, before, w);
        } else {
          missing.push(w);
          if (before) {
            // Not found, but kept: it may only be switched off.
            kept.add(before);
            next.push(before);
          }
        }
      }
    } else if (previous.length > 0) {
      for (const before of previous) {
        const same = before.serial ? bulbs.find((b) => b.serial === before.serial) : undefined;
        if (same) {
          take(same, before, null);
        } else {
          this.options.log.debug(`LIFX: a bulb in use was not among the ${bulbs.length} found; it is kept.`);
          kept.add(before);
          next.push(before);
        }
      }
    } else if (bulbs.length === 1) {
      take(bulbs[0], undefined, null);
    }

    this.chosen = next;
    const using = next.filter((c) => !kept.has(c) && c.serial).map((c) => ({ label: c.label ?? '', serial: c.serial! }));
    const signature = `${bulbs.map((b) => `${b.serial}=${b.label}@${b.host}`).join(',')}|${next.map((c) => c.serial).join(',')}|${missing.join(',')}`;
    const lines: Line[] = [];
    if (using.length > 0) {
      lines.push({ level: 'info', text: () => bulbsFound(bulbs, using) });
    } else if (wanted.length === 0 && next.length === 0) {
      lines.push({ level: 'warn', text: () => severalBulbs(bulbs) });
    }
    for (const w of missing) {
      lines.push({ level: 'warn', text: () => bulbNotNamed(w, bulbs) });
    }
    this.log(signature, lines);
    this.remember();
    this.options.onChange?.();
    // A bulb found at a new address, or chosen now, is sent the last color at once, on its own lane (SPEC 13.2 item 4,
    // 13.3 items 2 and 4); one whose own send is waiting on this discovery sends there itself.
    for (const c of next) {
      if (!c.handling && hostsBefore.get(c) !== c.host) {
        this.replay(c);
      }
    }
  }

  /** Sends the last color to one bulb, if there has been a send. */
  private replay(bulb: Chosen): void {
    if (this.lastSend) {
      void this.enqueue(bulb, this.lastSend.color, this.lastSend.sendTo);
    }
  }

  /** Writes the lines of an outcome once, when it differs from the last (SPEC 12 item 2). */
  private log(signature: string, lines: Line[]): void {
    if (signature === this.lastOutcome) {
      return;
    }
    this.lastOutcome = signature;
    for (const line of lines) {
      this.options.log[line.level](line.text());
    }
  }

  private discoveryDue(): boolean {
    return this.options.config.hosts.length === 0 && (this.lastDiscovery === null || this.now() - this.lastDiscovery >= REDISCOVER_MS);
  }

  /** Whether an entry of `lifx.bulbs` names a chosen bulb, its own or one another entry names by its serial or name. */
  private satisfied(wanted: string): boolean {
    return this.chosen.some((c) => c.wanted === wanted || (c.serial !== null && matchesBulb(wanted, { label: c.label ?? '', serial: c.serial })));
  }

  /** Whether a bulb is still to be found: none chosen, or a bulb of `lifx.bulbs` not chosen yet. */
  private looking(): boolean {
    return this.chosen.length === 0 || this.options.config.bulbs.some((w) => !this.satisfied(w));
  }

  /**
   * Called on every tick. While a bulb is still to be found, discovery runs again at most every 5 minutes. True when
   * a bulb has just been chosen; it has been sent the last color already (SPEC 13.3 item 4).
   */
  async maintain(): Promise<boolean> {
    if (!this.enabled) {
      return false;
    }
    await this.start();
    if (!this.looking() || !this.discoveryDue()) {
      return false;
    }
    const before = new Set(this.chosen);
    await this.discover();
    return this.chosen.some((c) => !before.has(c));
  }

  /**
   * Sends a color (`#RRGGBB` or `off`) to every chosen bulb at the same moment, each on its own lane (SPEC 13.3): one
   * result per bulb, none when there is no bulb to send to. A bulb still trying an earlier send gets this one next, in
   * place of any older one waiting. A remembered address that does not answer its first send, or a bulb silent for
   * three sends in a row, sends discovery out again, and the color goes to that bulb's new address.
   */
  async send(color: string, durationMs: number): Promise<SendResult[]> {
    const { client, config } = this.options;
    this.lastSend = { color, sendTo: (to) => client.sendColor(to.host, to.serial, color, config.brightness, CHANGE_MS) };
    return this.deliver(color, (to) => client.sendColor(to.host, to.serial, color, config.brightness, durationMs));
  }

  /**
   * The meeting warning's fade (SPEC 6.7, 13.1 item 8) to the In a meeting color, lasting until `until` by the clock, so
   * a resend after rediscovery fades over the time left. `from` as `LifxClient.sendFade`.
   */
  async sendFade(fade: { from: string | null; to: string; until: number }): Promise<SendResult[]> {
    const { client, config } = this.options;
    const sendTo = (to: Chosen) => client.sendFade(to.host, to.serial,
      { from: fade.from, to: fade.to, durationMs: Math.max(0, fade.until - this.now()) }, config.brightness);
    this.lastSend = { color: fade.to, sendTo };
    return this.deliver(fade.to, sendTo);
  }

  /** Resolves once no bulb has a send in progress or waiting. */
  async settled(): Promise<void> {
    while (this.inFlight.size > 0) {
      await Promise.all([...this.inFlight]);
    }
  }

  /** Puts a send on every chosen bulb's lane at once. `lastSent` records `color`. */
  private async deliver(color: string, sendTo: (to: Chosen) => Promise<boolean>): Promise<SendResult[]> {
    if (!this.enabled) {
      return [];
    }
    await this.start();
    return Promise.all([...this.chosen].map((c) => this.enqueue(c, color, sendTo)));
  }

  /** One bulb's lane: the send starts now when the bulb is free, or waits behind its send in progress (SPEC 13.3 item 1). */
  private enqueue(bulb: Chosen, color: string, sendTo: (to: Chosen) => Promise<boolean>): Promise<SendResult> {
    return new Promise((resolve) => {
      const job: Job = { color, sendTo, waiters: [resolve] };
      if (bulb.pending) {
        // A newer send replaces one still waiting; whoever waited for it gets this one's result.
        job.waiters.unshift(...bulb.pending.waiters);
      }
      bulb.pending = job;
      this.runLane(bulb);
    });
  }

  private runLane(bulb: Chosen): void {
    if (bulb.running || !bulb.pending) {
      return;
    }
    const job = bulb.pending;
    bulb.pending = null;
    const running = this.deliverTo(bulb, job.color, job.sendTo)
      .catch((): SendResult => ({ label: bulb.label, host: bulb.host, answered: false }))
      .then((result) => {
        for (const waiter of job.waiters) {
          waiter(result);
        }
      })
      .finally(() => {
        bulb.running = null;
        this.inFlight.delete(running);
        this.runLane(bulb);
      });
    bulb.running = running;
    this.inFlight.add(running);
  }

  /**
   * One bulb's send, with its own rediscovery: another bulb's send never waits for it (SPEC 13.3 item 1). When a
   * discovery runs while it is trying (its own, or one another silent bulb sent out), it sends again to the address
   * that discovery finds.
   */
  private async deliverTo(bulb: Chosen, color: string, sendTo: (to: Chosen) => Promise<boolean>): Promise<SendResult> {
    let target = bulb;
    const discoveriesBefore = this.discoveries;
    const before = bulb.host;
    let answered = await this.sendOnce(bulb, color, sendTo);
    const firstTry = bulb.untried;
    bulb.untried = false;
    if (!answered && bulb.found !== 'configured') {
      bulb.handling = true;
      try {
        if (firstTry || (bulb.silent >= SILENT_SENDS && this.discoveryDue())) {
          await this.discover();
        } else if (this.discovering) {
          await this.discovering;
        }
      } finally {
        bulb.handling = false;
      }
      if (this.discoveries !== discoveriesBefore) {
        // The same record at a new address, or the bulb `lifx.bulbs` now names in its place.
        const now = this.chosen.find((c) => c === bulb) ?? (bulb.wanted !== null ? this.chosen.find((c) => c.wanted === bulb.wanted) : undefined);
        if (now && (now !== bulb || now.host !== before)) {
          target = now;
          answered = await this.sendOnce(now, color, sendTo);
        }
      }
    }
    return { label: target.label, host: target.host, answered };
  }

  private async sendOnce(bulb: Chosen, color: string, sendTo: (to: Chosen) => Promise<boolean>): Promise<boolean> {
    const host = bulb.host;
    const answered = await sendTo(bulb);
    bulb.lastSent = color;
    bulb.lastSentAt = this.now();
    bulb.answered = answered;
    if (this.options.reportSends === false) {
      bulb.silent = answered ? 0 : bulb.silent + 1;
    } else if (answered) {
      bulb.silent = 0;
      if (bulb.silentLogged) {
        bulb.silentLogged = false;
        this.options.log.info(bulbBack(host));
      }
    } else {
      bulb.silent++;
      if (!bulb.silentLogged) {
        bulb.silentLogged = true;
        this.options.log.warn(bulbSilent(host));
      } else {
        this.options.log.debug(bulbSilent(host));
      }
    }
    this.options.onChange?.();
    return answered;
  }
}
