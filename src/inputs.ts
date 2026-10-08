/**
 * The senders of the status input (SPEC 18.7): the latest report from each sender, its expiry, the 20-sender limit,
 * the list of senders seen in the past 12 hours that the state file and the settings page show, and, kept apart from
 * that list, the replay table of 18.7 item 6 with its startup floor (item 7). Everything is kept in
 * `busy-light/inputs.json` (mode 600, written atomically on every change), so a long report and the replay rule
 * survive a restart. The key is never here.
 */
import path from 'node:path';
import { readJson, writeFileAtomic } from './files.js';
import { INPUT_STATUSES } from './status.js';
import type { InputReport, InputStatus } from './status.js';

/** At most 20 unexpired senders; a report from a 21st is refused (SPEC 18.7 item 2). */
export const MAX_ACTIVE_SENDERS = 20;
/** The list kept for display: the last 20 senders seen in the past 12 hours (SPEC 18.7 item 5). */
export const MAX_LISTED_SENDERS = 20;
export const LIST_MS = 12 * 3_600_000;
/** The signature window of SPEC 18.8 item 6, which is also how long a replay table entry is kept (18.7 item 6). */
export const REPLAY_WINDOW_MS = 300_000;
/** The sender of the On a Call switch (SPEC 18.9 item 2). */
export const HOME_APP_SENDER = 'Home app';

/** How a report arrived: the status API or the On a Call switch. */
export type Via = 'api' | 'switch';
/** How a report through the API authenticated (SPEC 18.8 item 10); null for the switch. */
export type Auth = 'signed' | 'plain';

export interface SenderEntry {
  sender: string;
  status: InputStatus;
  app: string | null;
  via: Via;
  auth: Auth | null;
  lastHeard: number;
  /** When its report stops counting; null for the switch's report, which lasts until the switch turns off. */
  expiresAt: number | null;
  /** True while its report counts. */
  active: boolean;
}

export interface NewReport {
  sender: string;
  status: InputStatus;
  app: string | null;
  via: Via;
  auth: Auth | null;
  /** How long the report lasts, or null for the switch's report. */
  ttlMs: number | null;
  /** The `ts` of a signed report, recorded in the replay table in the same step that accepts it. */
  ts?: number | null;
}

export type ReportOutcome =
  | { ok: true; entry: SenderEntry; changed: boolean }
  | { ok: false; error: 'tooManySenders' };

interface StoredEntry {
  sender: string;
  status: InputStatus;
  app: string | null;
  via: Via;
  auth: Auth | null;
  lastHeard: string;
  expiresAt: string | null;
  active: boolean;
}

export function inputsFile(storageDir: string): string {
  return path.join(storageDir, 'inputs.json');
}

function isInputStatus(value: unknown): value is InputStatus {
  return typeof value === 'string' && (INPUT_STATUSES as readonly string[]).includes(value);
}

/** One entry of inputs.json as written, or null when it is not one. */
function readEntry(raw: unknown): SenderEntry | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const e = raw as Partial<StoredEntry>;
  const lastHeard = typeof e.lastHeard === 'string' ? Date.parse(e.lastHeard) : NaN;
  const expiresAt = typeof e.expiresAt === 'string' ? Date.parse(e.expiresAt) : null;
  if (typeof e.sender !== 'string' || !e.sender || Number.isNaN(lastHeard) || (expiresAt !== null && Number.isNaN(expiresAt))
    || !isInputStatus(e.status) || (e.via !== 'api' && e.via !== 'switch')) {
    return null;
  }
  return {
    sender: e.sender,
    status: e.status,
    app: typeof e.app === 'string' ? e.app : null,
    via: e.via,
    auth: e.auth === 'signed' || e.auth === 'plain' ? e.auth : null,
    lastHeard,
    expiresAt,
    active: e.active === true,
  };
}

export class SenderStore {
  private entries: SenderEntry[] = [];
  /** The replay table (SPEC 18.7 item 6): the `ts` of the last accepted signed report of each sender. */
  private readonly replay = new Map<string, number>();
  /** Senders a report or `clear` found expired, kept for the next `sweep`, so each still gets its log line. */
  private expiredUnseen: string[] = [];
  /** The startup floor (SPEC 18.7 item 7), when inputs.json could not be read at startup. */
  private floor: number | null = null;

  /** `file` is null to keep everything in memory. */
  constructor(private readonly file: string | null, private readonly onError: (err: Error) => void = () => undefined) {}

  /**
   * Reads inputs.json at startup (SPEC 18.7 item 4). Reports that expired while Homebridge was down are dropped (they
   * stay in the list as inactive, without the "expired" line), and so is the switch's report, which the platform
   * restores from the switch itself (18.9 item 3). Senders not heard from in 12 hours are forgotten, and replay table
   * entries already more than 300 seconds old are dropped. When the file is missing or unreadable, the startup floor
   * of 18.7 item 7 applies for 300 seconds.
   */
  load(now: number): void {
    const raw = this.file ? readJson(this.file) as { version?: number; senders?: unknown; replay?: unknown } | null : null;
    const readable = raw !== null && typeof raw === 'object' && raw.version === 1;
    const senders = readable && Array.isArray(raw.senders) ? raw.senders : [];
    this.entries = senders.map(readEntry).filter((e): e is SenderEntry => e !== null);
    for (const e of this.entries) {
      if (e.active && (e.via === 'switch' || e.expiresAt === null || e.expiresAt <= now)) {
        e.active = false;
      }
    }
    this.replay.clear();
    for (const item of readable && Array.isArray(raw.replay) ? raw.replay : []) {
      const r = item as { sender?: unknown; ts?: unknown };
      if (typeof r.sender === 'string' && typeof r.ts === 'number' && Number.isSafeInteger(r.ts)) {
        this.replay.set(r.sender, r.ts);
      }
    }
    this.pruneReplay(now);
    this.floor = readable ? null : now;
    this.prune(now);
  }

  /**
   * The `ts` a signed report from this sender must be greater than (SPEC 18.8 item 7): its replay table entry or the
   * startup floor while that applies, whichever is later, or null when neither applies.
   */
  replayFloor(sender: string, now: number): number | null {
    this.pruneReplay(now);
    const entry = this.replay.get(sender) ?? null;
    const floor = this.floor !== null && now - this.floor <= REPLAY_WINDOW_MS ? this.floor : null;
    if (entry === null) {
      return floor;
    }
    return floor === null ? entry : Math.max(entry, floor);
  }

  /** Records the `ts` of an accepted signed `POST /v1/status`, `clear` included (SPEC 18.7 item 6). */
  recordTs(sender: string, ts: number, now: number): void {
    this.replay.set(sender, ts);
    this.pruneReplay(now);
    this.save();
  }

  /** The senders in the replay table (tests). */
  replaySenders(): string[] {
    return [...this.replay.keys()];
  }

  /**
   * Records a report (SPEC 18.7 item 1): it replaces the sender's earlier one. A new sender beyond the 20 active ones
   * is refused when it comes through the API; the switch is the user's own and is never refused. `changed` is true
   * when the sender was not active before, or its status or app changed, which is when the log line is written.
   */
  report(r: NewReport, now: number): ReportOutcome {
    this.expiredUnseen.push(...this.expire(now));
    let entry = this.find(r.sender);
    if (!entry?.active && r.via === 'api' && this.activeEntries().length >= MAX_ACTIVE_SENDERS) {
      return { ok: false, error: 'tooManySenders' };
    }
    const changed = !entry?.active || entry.status !== r.status || entry.app !== r.app;
    if (!entry) {
      entry = { sender: r.sender, status: r.status, app: r.app, via: r.via, auth: r.auth, lastHeard: now, expiresAt: null, active: true };
      this.entries.push(entry);
    }
    entry.status = r.status;
    entry.app = r.app;
    entry.via = r.via;
    entry.auth = r.auth;
    entry.lastHeard = now;
    entry.expiresAt = r.ttlMs === null ? null : now + r.ttlMs;
    entry.active = true;
    if (r.ts !== undefined && r.ts !== null) {
      this.replay.set(r.sender, r.ts);
      this.pruneReplay(now);
    }
    this.prune(now);
    this.save();
    return { ok: true, entry, changed };
  }

  /**
   * Withdraws a sender's report (SPEC 18.4 item 5). Idempotent: a sender with no active report is fine. True when an
   * active report was removed, which is when the log line is written. A sender that only ever cleared is not listed.
   */
  clear(sender: string, auth: Auth | null, now: number, ts: number | null = null): boolean {
    this.expiredUnseen.push(...this.expire(now));
    if (ts !== null) {
      this.replay.set(sender, ts);
      this.pruneReplay(now);
    }
    const entry = this.find(sender);
    if (!entry) {
      if (ts !== null) {
        this.save();
      }
      return false;
    }
    const wasActive = entry.active;
    entry.lastHeard = now;
    entry.active = false;
    if (auth !== null) {
      entry.auth = auth;
    }
    if (wasActive) {
      entry.expiresAt = now;
    }
    this.prune(now);
    this.save();
    return wasActive;
  }

  /**
   * Marks the reports that have expired by now and returns their senders (SPEC 18.7 item 3), with any a report or
   * `clear` found expired since the last sweep.
   */
  sweep(now: number): string[] {
    const unseen = this.expiredUnseen;
    this.expiredUnseen = [];
    return [...unseen, ...this.expire(now)];
  }

  /** Marks the reports that have expired by now and returns their senders. */
  private expire(now: number): string[] {
    const gone: string[] = [];
    for (const e of this.entries) {
      if (e.active && e.expiresAt !== null && e.expiresAt <= now) {
        e.active = false;
        gone.push(e.sender);
      }
    }
    if (gone.length) {
      this.prune(now);
      this.save();
    }
    return gone;
  }

  /** The earliest expiry of an active report, for the expiry timer, or null. */
  nextExpiry(): number | null {
    const times = this.activeEntries().map((e) => e.expiresAt).filter((t): t is number => t !== null);
    return times.length ? Math.min(...times) : null;
  }

  /** The unexpired reports, for the resolver (SPEC 6.3), of the channels `counts` accepts (every channel by default). */
  active(now: number, counts: (via: Via) => boolean = () => true): InputReport[] {
    return this.entries
      .filter((e) => e.active && (e.expiresAt === null || e.expiresAt > now) && counts(e.via))
      .map((e) => ({ sender: e.sender, status: e.status, app: e.app, receivedAt: e.lastHeard }));
  }

  /** The senders to show (SPEC 18.7 item 5): heard from in the past 12 hours, most recent first. */
  list(now: number): SenderEntry[] {
    return this.entries
      .filter((e) => now - e.lastHeard < LIST_MS)
      .sort((a, b) => b.lastHeard - a.lastHeard)
      .map((e) => ({ ...e, active: e.active && (e.expiresAt === null || e.expiresAt > now) }));
  }

  private find(sender: string): SenderEntry | undefined {
    return this.entries.find((e) => e.sender === sender);
  }

  private activeEntries(): SenderEntry[] {
    return this.entries.filter((e) => e.active);
  }

  /** Forgets senders not heard from in 12 hours, and the oldest inactive ones beyond 20. The replay table is apart. */
  private prune(now: number): void {
    this.entries = this.entries.filter((e) => e.active || now - e.lastHeard < LIST_MS);
    const inactive = this.entries.filter((e) => !e.active).sort((a, b) => b.lastHeard - a.lastHeard);
    const room = Math.max(0, MAX_LISTED_SENDERS - this.activeEntries().length);
    const dropped = new Set(inactive.slice(room));
    this.entries = this.entries.filter((e) => !dropped.has(e));
  }

  /** Drops replay table entries once Busy Light's clock is more than 300 seconds past their `ts` (SPEC 18.7 item 6). */
  private pruneReplay(now: number): void {
    for (const [sender, ts] of this.replay) {
      if (now - ts > REPLAY_WINDOW_MS) {
        this.replay.delete(sender);
      }
    }
  }

  private save(): void {
    if (!this.file) {
      return;
    }
    const senders: StoredEntry[] = this.entries.map((e) => ({
      sender: e.sender,
      status: e.status,
      app: e.app,
      via: e.via,
      auth: e.auth,
      lastHeard: new Date(e.lastHeard).toISOString(),
      expiresAt: e.expiresAt === null ? null : new Date(e.expiresAt).toISOString(),
      active: e.active,
    }));
    const replay = [...this.replay].map(([sender, ts]) => ({ sender, ts }));
    try {
      writeFileAtomic(this.file, `${JSON.stringify({ version: 1, senders, replay }, null, 2)}\n`, 0o600);
    } catch (err) {
      this.onError(err as Error);
    }
  }
}
