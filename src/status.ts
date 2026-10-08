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

export interface ResolveOptions {
  /** All-day events marked busy or tentative are ignored in rules 5 and 7. All-day out of office always counts. */
  ignoreAllDayBusy: boolean;
}

/** Why the status is what it is, for the state file, the log and the settings page. */
export interface Reason {
  /** The name of the source that decided it, `Teams` for presence, or null (the override, or nothing on any calendar). */
  source: string | null;
  /** When the status is next expected to change according to the cached events, or null. */
  until: number | null;
}

export interface Resolution {
  status: Status;
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
}

/** The event among several that keeps a status longest, so its source is the one named. */
function latest(events: CalEvent[]): CalEvent {
  return events.reduce((a, b) => (b.end > a.end ? b : a));
}

/** The precedence of SPEC 6.3 at one instant. Presence is null when there is no fresh presence. */
function decide(override: boolean, presence: Presence | null, events: CalEvent[], now: number, opts: ResolveOptions): Decision {
  if (override) {
    return { status: 'doNotDisturb', source: null };
  }
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
  if (availability === 'DoNotDisturb' || activity === 'Presenting' || activity === 'Focusing' || activity === 'DoNotDisturb') {
    return { status: 'doNotDisturb', source: TEAMS };
  }
  if (activity === 'InACall' || activity === 'InAConferenceCall') {
    return { status: 'inCall', source: TEAMS };
  }
  if (busy.length) {
    return { status: 'inMeeting', source: latest(busy).source };
  }
  if (activity === 'InAMeeting') {
    return { status: 'inMeeting', source: TEAMS };
  }
  if (availability === 'Busy' || availability === 'BusyIdle') {
    return { status: 'busy', source: TEAMS };
  }
  if (tentative.length) {
    return { status: 'tentative', source: latest(tentative).source };
  }
  if (availability === 'Away' || availability === 'BeRightBack') {
    return { status: 'away', source: TEAMS };
  }
  if (availability === 'Available' || availability === 'AvailableIdle') {
    return { status: 'available', source: TEAMS };
  }
  if (presence === null) {
    return { status: 'available', source: null };
  }
  return { status: 'offline', source: TEAMS };
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
): Resolution {
  const decision = decide(override, presence, events, now, opts);
  let until: number | null = null;
  for (const t of boundariesAfter(events, now, opts)) {
    if (decide(override, presence, events, t, opts).status !== decision.status) {
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

/**
 * The status from every source, applying freshness. With no fresh data at all (or no sources) the status is
 * `unknown`. The override switch wins even then, since it is the person's own choice and needs no data.
 */
export function resolve(sources: SourceData[], override: boolean, now: number, opts: ResolveOptions): Resolution {
  const fresh = freshData(sources, now);
  if (!override && !fresh.anyFresh) {
    return { status: 'unknown', reason: null };
  }
  return resolveStatus(override, fresh.presence, fresh.events, now, opts);
}
