/**
 * The status model of SPEC section 6: the event model, the precedence rules, the reason and `until`, and freshness.
 * Pure logic with no network, HomeKit or clock access, so every rule can be tested directly.
 */
import type { Status, StatusKey } from './model.js';

/** How an event shows the person's time. */
export type ShowAs = 'free' | 'tentative' | 'busy' | 'oof';

/** One calendar event reduced to what the status needs (SPEC 6.1). Times are epoch milliseconds. Nothing else is kept. */
export interface CalEvent {
  showAs: ShowAs;
  start: number;
  end: number;
  isAllDay: boolean;
  isCancelled: boolean;
  /** The name of the source the event came from. */
  source: string;
}

/** Teams presence from Microsoft Graph `/me/presence`. */
export interface Presence {
  availability: string;
  activity: string;
  outOfOffice: boolean;
}

/** The statuses a sender may report (SPEC 18.2); `clear` is not a status but a withdrawal. */
export const INPUT_STATUSES = ['outOfOffice', 'doNotDisturb', 'inCall', 'inMeeting', 'busy', 'away', 'available', 'offline'] as const;

export type InputStatus = (typeof INPUT_STATUSES)[number];

/** An unexpired status input report (SPEC 18.7), a presence signal alongside Teams presence (6.3). */
export interface InputReport {
  sender: string;
  status: InputStatus;
  app: string | null;
  /** When it arrived; among reports that satisfy the same rule, the latest names the source. */
  receivedAt: number;
}

export interface ResolveOptions {
  /** All-day events marked busy or tentative are ignored in rules 5 and 7. All-day out of office always counts. */
  ignoreAllDayBusy: boolean;
}

/** Why the status is what it is, for the state file, the log and the settings page. */
export interface Reason {
  /**
   * The name of the source that decided it, `Teams` for presence, a sender's name for a status input report, or null
   * (the override, or nothing on any calendar).
   */
  source: string | null;
  /** When the status is next expected to change according to the cached events, or null (always for a report). */
  until: number | null;
  /** The app a deciding report named (SPEC 6.3 item 5); absent otherwise. */
  app?: string;
}

export interface Resolution {
  /** Never `notWorking`: the Working switch is the engine's, above every rule (SPEC 6.6). */
  status: Exclude<Status, 'notWorking'>;
  /** Null when the status is unknown. */
  reason: Reason | null;
}

/** The source name used in a reason when Teams presence decided the status. */
export const TEAMS = 'Teams';

/** Events are fresh for 15 minutes after their source's last successful check (SPEC 6.5). */
export const EVENTS_FRESH_MS = 15 * 60_000;
/** Presence is fresh for 5 minutes. */
export const PRESENCE_FRESH_MS = 5 * 60_000;

/** Active: not cancelled and `start <= now < end`. */
export function isActive(e: CalEvent, now: number): boolean {
  return !e.isCancelled && e.start <= now && now < e.end;
}

/** A counting event is one that can decide a status: not cancelled, not free, and not an ignored all-day event. */
export function isCounting(e: CalEvent, opts: ResolveOptions): boolean {
  if (e.isCancelled || e.showAs === 'free') {
    return false;
  }
  if (e.showAs === 'oof') {
    return true;
  }
  return !(e.isAllDay && opts.ignoreAllDayBusy);
}

interface Decision {
  status: StatusKey;
  /** The deciding source, before `until` is worked out. */
  source: string | null;
  /** The deciding report, when a report decided. */
  report?: InputReport;
}

/** The event among several that keeps a status longest, so its source is the one named. */
function latest(events: CalEvent[]): CalEvent {
  return events.reduce((a, b) => (b.end > a.end ? b : a));
}

/** The latest report that says a status, if any. */
function saying(reports: InputReport[], status: InputStatus): InputReport | undefined {
  return reports.filter((r) => r.status === status).reduce<InputReport | undefined>((a, b) => (!a || b.receivedAt > a.receivedAt ? b : a), undefined);
}

function fromReport(status: StatusKey, report: InputReport): Decision {
  return { status, source: report.sender, report };
}

/**
 * The precedence of SPEC 6.3 at one instant. Presence is null when there is no fresh Teams presence. Within a rule,
 * an event names the source first (it carries an end time), then Teams presence, then the latest report.
 */
function decide(override: boolean, presence: Presence | null, events: CalEvent[], now: number, opts: ResolveOptions,
  reports: InputReport[] = []): Decision {
  if (override) {
    return { status: 'doNotDisturb', source: null };
  }
  let report: InputReport | undefined;
  const active = events.filter((e) => isActive(e, now) && isCounting(e, opts));
  const oof = active.filter((e) => e.showAs === 'oof');
  const busy = active.filter((e) => e.showAs === 'busy');
  const tentative = active.filter((e) => e.showAs === 'tentative');
  const availability = presence?.availability ?? '';
  const activity = presence?.activity ?? '';

  if (oof.length) {
    return { status: 'outOfOffice', source: latest(oof).source };
  }
  if (presence?.outOfOffice || activity === 'OutOfOffice') {
    return { status: 'outOfOffice', source: TEAMS };
  }
  if ((report = saying(reports, 'outOfOffice'))) {
    return fromReport('outOfOffice', report);
  }
  if (availability === 'DoNotDisturb' || activity === 'Presenting' || activity === 'Focusing' || activity === 'DoNotDisturb') {
    return { status: 'doNotDisturb', source: TEAMS };
  }
  if ((report = saying(reports, 'doNotDisturb'))) {
    return fromReport('doNotDisturb', report);
  }
  if (activity === 'InACall' || activity === 'InAConferenceCall') {
    return { status: 'inCall', source: TEAMS };
  }
  if ((report = saying(reports, 'inCall'))) {
    return fromReport('inCall', report);
  }
  if (busy.length) {
    return { status: 'inMeeting', source: latest(busy).source };
  }
  if (activity === 'InAMeeting') {
    return { status: 'inMeeting', source: TEAMS };
  }
  if ((report = saying(reports, 'inMeeting'))) {
    return fromReport('inMeeting', report);
  }
  if (availability === 'Busy' || availability === 'BusyIdle') {
    return { status: 'busy', source: TEAMS };
  }
  if ((report = saying(reports, 'busy'))) {
    return fromReport('busy', report);
  }
  if (tentative.length) {
    return { status: 'tentative', source: latest(tentative).source };
  }
  if (availability === 'Away' || availability === 'BeRightBack') {
    return { status: 'away', source: TEAMS };
  }
  if ((report = saying(reports, 'away'))) {
    return fromReport('away', report);
  }
  if (availability === 'Available' || availability === 'AvailableIdle') {
    return { status: 'available', source: TEAMS };
  }
  if ((report = saying(reports, 'available'))) {
    return fromReport('available', report);
  }
  const offline = saying(reports, 'offline');
  if (presence === null && !offline) {
    return { status: 'available', source: null };
  }
  return presence !== null ? { status: 'offline', source: TEAMS } : fromReport('offline', offline!);
}

/** The starts and ends of counting events after `now`, in order, without repeats. */
export function boundariesAfter(events: CalEvent[], now: number, opts: ResolveOptions): number[] {
  const times = new Set<number>();
  for (const e of events) {
    if (!isCounting(e, opts)) {
      continue;
    }
    if (e.start > now) {
      times.add(e.start);
    }
    if (e.end > now) {
      times.add(e.end);
    }
  }
  return [...times].sort((a, b) => a - b);
}

/** The next start or end of a counting event after `now`, or null. Drives the boundary timer of SPEC 8.1. */
export function nextBoundary(events: CalEvent[], now: number, opts: ResolveOptions): number | null {
  return boundariesAfter(events, now, opts)[0] ?? null;
}

/**
 * The status from fresh data, with its reason. `until` is the first event boundary at which the same rules, with
 * the same presence and override, give a different status: the end of the deciding event, or the start of the next
 * counting event.
 */
export function resolveStatus(
  override: boolean,
  presence: Presence | null,
  events: CalEvent[],
  now: number,
  opts: ResolveOptions,
  reports: InputReport[] = [],
): Resolution {
  const decision = decide(override, presence, events, now, opts, reports);
  if (decision.report) {
    // A report has no end time (SPEC 6.3 item 5).
    const reason: Reason = { source: decision.source, until: null };
    if (decision.report.app) {
      reason.app = decision.report.app;
    }
    return { status: decision.status, reason };
  }
  let until: number | null = null;
  for (const t of boundariesAfter(events, now, opts)) {
    if (decide(override, presence, events, t, opts, reports).status !== decision.status) {
      until = t;
      break;
    }
  }
  return { status: decision.status, reason: { source: decision.source, until } };
}

/** What one source last delivered. A source that has never succeeded has null times. */
export interface SourceData {
  /** Events from the last successful calendar check, or null when the source has no calendar. */
  events: CalEvent[] | null;
  eventsCheckedAt: number | null;
  /** Presence from the last successful presence check, or null when the source does not read presence. */
  presence: Presence | null;
  presenceCheckedAt: number | null;
}

export interface FreshData {
  events: CalEvent[];
  presence: Presence | null;
  /** True when at least one source has fresh events or fresh presence. */
  anyFresh: boolean;
}

/** Drops events older than 15 minutes and presence older than 5 minutes (SPEC 6.5). */
export function freshData(sources: SourceData[], now: number): FreshData {
  const events: CalEvent[] = [];
  let presence: Presence | null = null;
  let anyFresh = false;
  for (const s of sources) {
    if (s.events && s.eventsCheckedAt !== null && now - s.eventsCheckedAt < EVENTS_FRESH_MS) {
      events.push(...s.events);
      anyFresh = true;
    }
    if (s.presence && s.presenceCheckedAt !== null && now - s.presenceCheckedAt < PRESENCE_FRESH_MS) {
      presence = s.presence;
      anyFresh = true;
    }
  }
  return { events, presence, anyFresh };
}

/** The status input as the resolver sees it: whether either channel is on, and the unexpired reports. */
export interface Inputs {
  /** The status input or the On a Call switch is on (SPEC 6.5 item 5). */
  on: boolean;
  reports: InputReport[];
}

/**
 * The status from every source, applying freshness (SPEC 6.5). With sources configured and no fresh data and no
 * report, or with no sources and both input channels off, the status is `unknown`. A report counts as fresh data.
 * The override switch wins even then, since it is the person's own choice and needs no data.
 */
export function resolve(sources: SourceData[], override: boolean, now: number, opts: ResolveOptions,
  inputs: Inputs = { on: false, reports: [] }): Resolution {
  const fresh = freshData(sources, now);
  if (!override && !fresh.anyFresh && inputs.reports.length === 0 && (sources.length > 0 || !inputs.on)) {
    return { status: 'unknown', reason: null };
  }
  return resolveStatus(override, fresh.presence, fresh.events, now, opts, inputs.reports);
}
