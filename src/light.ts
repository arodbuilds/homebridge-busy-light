/**
 * Which LIFX bulb to use and keeping hold of it (SPEC 13.2): a configured address, the remembered bulb, or
 * discovery; rediscovery while no bulb is chosen or the chosen one stops answering; and the bulb log lines.
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

export type Found = 'configured' | 'remembered' | 'discovered';

/** The `light` object of the state file (SPEC 10.1). */
export interface LightState {
  enabled: boolean;
  label: string | null;
  host: string | null;
  found: Found | null;
  lastSent: string | null;
  lastSentAt: string | null;
  answered: boolean | null;
}

interface Chosen {
  /** Null for a bulb given only by its address: packets go tagged with a zero target. */
  serial: string | null;
  label: string | null;
  host: string;
  found: Found;
}

/** What `busy-light/light.json` holds. */
interface Remembered {
  serial: string;
  label: string;
  host: string;
}

export function lightFile(storageDir: string): string {
  return path.join(storageDir, 'light.json');
}

/** Whether a bulb is the one `lifx.bulb` names, by name without regard to case or by serial number. */
export function matchesBulb(wanted: string, bulb: { label: string; serial: string }): boolean {
  const w = wanted.trim();
  if (!w) {
    return true;
  }
  const serial = normalizeSerial(w);
  return (serial !== null && serial === bulb.serial) || bulb.label.toLowerCase() === w.toLowerCase();
}

export interface LightControllerOptions {
  config: LifxConfig;
  client: LifxClient;
  log: Log;
  /** Where light.json lives, or null to neither read nor write it. */
  storageDir: string | null;
  /** False for the CLI: use the remembered bulb but never write light.json. */
  remember?: boolean;
  now?: () => number;
  onChange?: () => void;
}

export class LightController {
  private chosen: Chosen | null = null;
  private starting: Promise<void> | null = null;
  private lastDiscovery: number | null = null;
  private lastOutcome: string | null = null;
  private silent = 0;
  private silentLogged = false;
  private untried = false;
  private lastSent: string | null = null;
  private lastSentAt: number | null = null;
  private answered: boolean | null = null;
  private readonly now: () => number;

  constructor(private readonly options: LightControllerOptions) {
    this.now = options.now ?? Date.now;
  }

  get enabled(): boolean {
    return this.options.config.enabled;
  }

  /** The address in use, if one is known yet. */
  get host(): string | null {
    return this.chosen?.host ?? null;
  }

  state(): LightState {
    return {
      enabled: this.enabled,
      label: this.chosen?.label ?? null,
      host: this.chosen?.host ?? null,
      found: this.chosen?.found ?? null,
      lastSent: this.lastSent,
      lastSentAt: this.lastSentAt === null ? null : new Date(this.lastSentAt).toISOString(),
      answered: this.answered,
    };
  }

  /**
   * SPEC 13.2 item 2: the configured address, else the remembered bulb if it fits the configuration, else
   * discovery. Resolves once a bulb is chosen or discovery has finished.
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
    if (config.host) {
      this.chosen = { serial: null, label: null, host: config.host, found: 'configured' };
      this.options.onChange?.();
      return;
    }
    const remembered = this.readRemembered();
    if (remembered && matchesBulb(config.bulb, remembered)) {
      this.chosen = { ...remembered, found: 'remembered' };
      this.untried = true;
      this.options.onChange?.();
      return;
    }
    await this.discover();
  }

  private readRemembered(): Remembered | null {
    if (!this.options.storageDir) {
      return null;
    }
    const raw = readJson(lightFile(this.options.storageDir)) as Partial<Remembered> | null;
    if (!raw || typeof raw.serial !== 'string' || typeof raw.host !== 'string' || !normalizeSerial(raw.serial)) {
      return null;
    }
    return { serial: normalizeSerial(raw.serial)!, label: typeof raw.label === 'string' ? raw.label : '', host: raw.host };
  }

  private remember(): void {
    if (!this.options.storageDir || this.options.remember === false || !this.chosen?.serial) {
      return;
    }
    const data: Remembered = { serial: this.chosen.serial, label: this.chosen.label ?? '', host: this.chosen.host };
    try {
      writeFileAtomic(lightFile(this.options.storageDir), `${JSON.stringify(data, null, 2)}\n`, 0o600);
    } catch (err) {
      this.options.log.debug(`Could not save light.json: ${(err as Error).message}`);
    }
  }

  /**
   * Runs discovery and applies the choosing rules, writing the bulb lines only when the outcome changes. A chosen bulb
   * with a serial number is never replaced by a different bulb unless `lifx.bulb` names that one (SPEC 13.2 item 4):
   * when it is not found it is kept, and the next discovery looks for it again by its serial number. Only while no
   * bulb has been chosen (none this run, none remembered that fits) does discovery pick one.
   */
  private async discover(): Promise<void> {
    this.lastDiscovery = this.now();
    const bulbs = await this.options.client.discover();
    const wanted = this.options.config.bulb;
    const previous = this.chosen;
    let pick: Bulb | undefined;
    if (previous?.serial) {
      const same = bulbs.find((b) => b.serial === previous.serial);
      const named = wanted ? bulbs.find((b) => b.serial !== previous.serial && matchesBulb(wanted, b)) : undefined;
      if (same && (!named || matchesBulb(wanted, same))) {
        pick = same;
      } else if (named) {
        pick = named;
      } else if (bulbs.length === 0) {
        // Keep the bulb we had: it may only be switched off.
        this.log(`none|${previous.serial}`, () => noBulb(), 'warn');
        return;
      } else {
        // Others answer, but the chosen bulb is kept: it may only be switched off.
        this.options.log.debug(`LIFX: the bulb in use was not among the ${bulbs.length} found; it is kept.`);
        return;
      }
    } else if (wanted) {
      pick = bulbs.find((b) => matchesBulb(wanted, b));
    } else if (bulbs.length === 1) {
      pick = bulbs[0];
    }

    const signature = `${bulbs.map((b) => `${b.serial}=${b.label}@${b.host}`).join(',')}|${pick?.serial ?? ''}`;
    if (pick) {
      const chosenBulb = pick;
      this.chosen = { serial: chosenBulb.serial, label: chosenBulb.label || null, host: chosenBulb.host, found: 'discovered' };
      this.silent = 0;
      this.untried = false;
      this.remember();
      this.log(signature, () => bulbsFound(bulbs, chosenBulb), 'info');
    } else {
      this.chosen = null;
      if (bulbs.length === 0) {
        this.log(signature, () => noBulb(), 'warn');
      } else if (wanted) {
        this.log(signature, () => bulbNotNamed(wanted, bulbs), 'warn');
      } else {
        this.log(signature, () => severalBulbs(bulbs), 'warn');
      }
    }
    this.options.onChange?.();
  }

  private log(signature: string, line: () => string, level: 'info' | 'warn'): void {
    if (signature !== this.lastOutcome) {
      this.lastOutcome = signature;
      this.options.log[level](line());
    }
  }

  private discoveryDue(): boolean {
    return !this.options.config.host && (this.lastDiscovery === null || this.now() - this.lastDiscovery >= REDISCOVER_MS);
  }

  /**
   * Called on every tick. While no bulb is chosen, discovery runs again at most every 5 minutes. True when a bulb
   * has just been chosen, so the caller can send it the current color.
   */
  async maintain(): Promise<boolean> {
    if (!this.enabled) {
      return false;
    }
    await this.start();
    if (this.chosen || !this.discoveryDue()) {
      return false;
    }
    await this.discover();
    return this.chosen !== null;
  }

  /**
   * Sends a color (`#RRGGBB` or `off`) to the chosen bulb. Null when there is no bulb to send to, otherwise whether
   * it answered. A remembered address that does not answer its first send, or a bulb silent for three sends in a
   * row, sends discovery out again, and the color goes to the bulb's new address straight away.
   */
  async send(color: string, durationMs: number): Promise<boolean | null> {
    if (!this.enabled) {
      return null;
    }
    await this.start();
    if (!this.chosen) {
      return null;
    }
    let answered = await this.sendOnce(color, durationMs);
    const firstTry = this.untried;
    this.untried = false;
    if (!answered && this.chosen && this.chosen.found !== 'configured' && (firstTry || (this.silent >= SILENT_SENDS && this.discoveryDue()))) {
      const before = this.chosen.host;
      await this.discover();
      if (this.chosen && this.chosen.host !== before) {
        answered = await this.sendOnce(color, durationMs);
      }
    }
    return answered;
  }

  private async sendOnce(color: string, durationMs: number): Promise<boolean> {
    const chosen = this.chosen!;
    const answered = await this.options.client.sendColor(chosen.host, chosen.serial, color, this.options.config.brightness, durationMs);
    this.lastSent = color;
    this.lastSentAt = this.now();
    this.answered = answered;
    if (answered) {
      this.silent = 0;
      if (this.silentLogged) {
        this.silentLogged = false;
        this.options.log.info(bulbBack(chosen.host));
      }
    } else {
      this.silent++;
      if (!this.silentLogged) {
        this.silentLogged = true;
        this.options.log.warn(bulbSilent(chosen.host));
      } else {
        this.options.log.debug(bulbSilent(chosen.host));
      }
    }
    this.options.onChange?.();
    return answered;
  }
}
