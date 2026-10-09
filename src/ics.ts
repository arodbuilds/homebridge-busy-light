/**
 * Reads iCalendar data into the event model (SPEC 5.4 and 6.4), expanding recurring events with ical.js. Shared by
 * the iCloud, Google and calendar URL sources.
 *
 * An event's title is read here for the out of office words only. It is never logged, stored or returned, and is
 * discarded with the parsed component.
 */
import ICAL from 'ical.js';
import type { CalEvent, ShowAs } from './status.js';

type Component = InstanceType<typeof ICAL.Component>;
type Time = InstanceType<typeof ICAL.Time>;
type IcalEvent = InstanceType<typeof ICAL.Event>;
type Recur = InstanceType<typeof ICAL.Recur>;

export interface IcsOptions {
  /** The name of the source, carried on each event. */
  source: string;
  /** Titles containing one of these as a whole word, case-insensitive, are out of office. */
  outOfOfficeWords: string[];
  /** The owner's addresses, lower case. An invitation one of them declined is free. */
  ownerAddresses: string[];
  /** Called when a recurring series reaches the safety cap, so its source can log the "Repeat limit" line (SPEC 12). */
  onRepeatLimit?: () => void;
}

/**
 * Iterations allowed per recurring series (SPEC 5.4 item 3). A safety net only: a series is skipped when it ended
 * before the window and is otherwise walked from close to the window, so no realistic series comes near it.
 */
export const MAX_ITERATIONS = 20_000;

const BUILT_IN_ZONES = new Set(['UTC', 'GMT', 'Z']);
const DAY_MS = 86_400_000;

/** The length of one step of each frequency that has a fixed length in wall-clock time. */
const STEP_MS: Record<string, number> = {
  SECONDLY: 1000,
  MINUTELY: 60_000,
  HOURLY: 3_600_000,
  DAILY: DAY_MS,
  WEEKLY: 7 * DAY_MS,
};

/** Matches any of the words as a whole word, case-insensitive. Null when there are no words. */
export function outOfOfficePattern(words: string[]): RegExp | null {
  const cleaned = words.map((w) => w.trim()).filter(Boolean);
  if (cleaned.length === 0) {
    return null;
  }
  const escaped = cleaned.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])(?:${escaped.join('|')})(?=[^\\p{L}\\p{N}]|$)`, 'iu');
}

function upper(comp: Component, name: string): string {
  const value = comp.getFirstPropertyValue(name);
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

/** An address as compared with the owner's: without `mailto:`, trimmed, lower case. */
function address(value: unknown): string {
  return typeof value === 'string' ? value.replace(/^mailto:/i, '').trim().toLowerCase() : '';
}

/** SPEC 6.4, first match wins. */
export function classify(comp: Component, oof: RegExp | null, owners: string[]): { showAs: ShowAs; isCancelled: boolean } {
  const isCancelled = upper(comp, 'status') === 'CANCELLED';
  const busyStatus = upper(comp, 'x-microsoft-cdo-busystatus');
  for (const attendee of comp.getAllProperties('attendee')) {
    // The attendee's value, or its EMAIL parameter (an attendee written as urn:uuid: carries the address there).
    const addresses = [address(attendee.getFirstValue()), address(attendee.getParameter('email'))].filter(Boolean);
    const partstat = attendee.getParameter('partstat');
    if (addresses.some((a) => owners.includes(a)) && typeof partstat === 'string' && partstat.toUpperCase() === 'DECLINED') {
      return { showAs: 'free', isCancelled };
    }
  }
  const title = comp.getFirstPropertyValue('summary');
  if (busyStatus === 'OOF' || (oof !== null && typeof title === 'string' && oof.test(title))) {
    return { showAs: 'oof', isCancelled };
  }
  // Working elsewhere is free, as Microsoft Graph's workingElsewhere is (SPEC 5.3 item 6).
  if (upper(comp, 'transp') === 'TRANSPARENT' || busyStatus === 'FREE' || busyStatus === 'WORKINGELSEWHERE') {
    return { showAs: 'free', isCancelled };
  }
  if (upper(comp, 'status') === 'TENTATIVE' || busyStatus === 'TENTATIVE') {
    return { showAs: 'tentative', isCancelled };
  }
  return { showAs: 'busy', isCancelled };
}

function registerTimezones(root: Component): void {
  for (const vtz of root.getAllSubcomponents('vtimezone')) {
    try {
      const tzid = vtz.getFirstPropertyValue('tzid');
      if (typeof tzid === 'string' && tzid && !BUILT_IN_ZONES.has(tzid)) {
        ICAL.TimezoneService.register(new ICAL.Timezone({ component: vtz, tzid }), tzid);
      }
    } catch {
      // An unreadable zone leaves its events in the host's time zone.
    }
  }
}

function parseRoots(text: string): Component[] {
  const parsed = ICAL.parse(text) as unknown;
  if (!Array.isArray(parsed)) {
    return [];
  }
  // A single component is ['vcalendar', props, comps]; several are an array of those.
  const list = typeof parsed[0] === 'string' ? [parsed] : parsed;
  return list.map((jcal) => new ICAL.Component(jcal as unknown[]));
}

const BLOCK = /^BEGIN:(VTIMEZONE|VEVENT)\r?$[\s\S]*?^END:\1\r?$/gim;

/**
 * The calendar's components. ical.js rejects a whole file for some faults in a single event (an RRULE it cannot
 * read, for example), so when the file as a whole fails, each time zone and event is parsed on its own and the
 * unreadable ones are left out.
 */
function roots(text: string): Component[] {
  try {
    return parseRoots(text);
  } catch (err) {
    const root = new ICAL.Component(['vcalendar', [], []]);
    let found = 0;
    for (const match of text.matchAll(BLOCK)) {
      found++;
      try {
        for (const part of parseRoots(`BEGIN:VCALENDAR\r\n${match[0]}\r\nEND:VCALENDAR\r\n`)) {
          for (const sub of part.getAllSubcomponents()) {
            root.addSubcomponent(sub);
          }
        }
      } catch {
        // Leave this one out.
      }
    }
    if (found === 0) {
      throw err;
    }
    return [root];
  }
}

/**
 * A time's wall-clock fields read as if they were UTC: plain calendar arithmetic, with no time zone lookup. It differs
 * from the real instant by the zone's offset, at most 14 hours, so comparisons against it keep a day's margin.
 */
function floating(t: Time): number {
  return Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second);
}

/** A time with the wall-clock fields of `ms` (as `floating` reads them), in the zone and date form of `like`. */
function timeLike(like: Time, ms: number): Time {
  const d = new Date(ms);
  return new ICAL.Time({
    year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(),
    hour: d.getUTCHours(), minute: d.getUTCMinutes(), second: d.getUTCSeconds(), isDate: like.isDate,
  }, like.zone ?? undefined);
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/** True when the rule has no BYxxx part: each period gives exactly one occurrence, at DTSTART's wall-clock time. */
function isSimple(rule: Recur): boolean {
  return Object.keys(rule.parts ?? {}).length === 0;
}

/**
 * The start of the occurrence `steps` intervals after DTSTART, as `floating` reads it, for a rule whose occurrences
 * that can be worked out without walking: a fixed-length frequency, or a monthly or yearly one on a day every month
 * has. Null otherwise.
 */
function advance(rule: Recur, start: Time, steps: number): number | null {
  const freq = rule.freq;
  if (freq in STEP_MS) {
    return floating(start) + steps * (rule.interval || 1) * STEP_MS[freq];
  }
  if ((freq === 'MONTHLY' || freq === 'YEARLY') && start.day <= 28) {
    const months = steps * (rule.interval || 1) * (freq === 'MONTHLY' ? 1 : 12);
    return Date.UTC(start.year, start.month - 1 + months, start.day, start.hour, start.minute, start.second);
  }
  return null;
}

/**
 * SPEC 5.4 item 3: whether the series ended before `limit` (a `floating` time with the margin already taken off), by
 * its UNTIL, or by the last occurrence its COUNT allows when that can be worked out without walking.
 */
function endedBefore(rule: Recur, start: Time, limit: number): boolean {
  if (rule.until) {
    const until = floating(rule.until) + (rule.until.isDate ? DAY_MS : 0);
    if (until < limit) {
      return true;
    }
  }
  if (rule.count && isSimple(rule)) {
    const last = advance(rule, start, rule.count - 1);
    return last !== null && last < limit;
  }
  return false;
}

/**
 * SPEC 5.4 item 3: where to start walking a series so that it starts close to the window. The supported way to start
 * an ical.js expansion later is `event.iterator(start)` with a start that lines up with the series, since the rule is
 * read again from that start: so the start is DTSTART moved on by a whole number of intervals, keeping its wall-clock
 * time, day of the month and month, from which ical.js takes the rule's defaults. The walk then gives exactly the
 * series' occurrences from the period after the one it starts in, and the start is a full period before `limit`, so
 * that first period, which may differ, ends before the window. Undefined to walk from DTSTART.
 */
function startNear(rule: Recur, start: Time, limit: number): Time | undefined {
  const interval = rule.interval || 1;
  const freq = rule.freq;
  if (freq in STEP_MS) {
    const period = interval * STEP_MS[freq];
    const k = Math.floor((limit - STEP_MS[freq] - floating(start)) / period);
    return k >= 1 ? timeLike(start, floating(start) + k * period) : undefined;
  }
  if (freq !== 'MONTHLY' && freq !== 'YEARLY') {
    return undefined;
  }
  const months = freq === 'MONTHLY' ? interval : 12 * interval;
  const last = new Date(limit - (freq === 'MONTHLY' ? 31 : 366) * DAY_MS);
  const elapsed = (last.getUTCFullYear() - start.year) * 12 + last.getUTCMonth() + 1 - start.month;
  // Step back past a start after `last` and past months without DTSTART's day (the 31st, or February 29).
  const most = Math.floor(elapsed / months);
  for (let k = most; k >= 1 && k > most - 60; k--) {
    const total = start.month - 1 + k * months;
    const year = start.year + Math.floor(total / 12);
    const month = total % 12;
    const at = Date.UTC(year, month, start.day, start.hour, start.minute, start.second);
    if (start.day <= daysInMonth(year, month) && at <= last.getTime()) {
      return timeLike(start, at);
    }
  }
  return undefined;
}

type Push = (comp: Component, startDate: Time, endDate: Time) => void;

/**
 * One recurring series (SPEC 5.4 items 2 and 3). Its changed occurrences are read on their own, each included when
 * its own start and end overlap the window, whatever its original date; the walk leaves out the occurrences they
 * replace. A series that ended before the window is not walked; any other walks from close to the window, unless it
 * has RDATE, several RRULEs or a RANGE=THISANDFUTURE change, which are walked from DTSTART. Occurrences that end before
 * the window are passed over by their wall-clock time, without `getOccurrenceDetails` or a time zone lookup.
 * Returns false when the series reached the safety cap.
 */
function expandSeries(master: Component, event: IcalEvent, from: number, to: number, push: Push): boolean {
  // ical.js keeps them by RECURRENCE-ID, although its types say a list.
  const changed = event.exceptions as unknown as Record<string, IcalEvent>;
  // The instants they replace: a RECURRENCE-ID may name its occurrence in another form than DTSTART (in UTC for a
  // series in a time zone, or the other way round), which ical.js's own lookup by text misses.
  const replaced = new Set<number>();
  for (const change of Object.values(changed)) {
    push(change.component, change.startDate, change.endDate);
    replaced.add(change.recurrenceId.toJSDate().getTime());
  }
  const rules = master.getAllProperties('rrule').map((p) => p.getFirstValue() as Recur);
  const ranged = (event as unknown as { rangeExceptions: unknown[] }).rangeExceptions.length > 0;
  const plain = !ranged && rules.length === 1 && !master.hasProperty('rdate');
  const start = event.startDate;
  const duration = Math.max(0, floating(event.endDate) - floating(start));
  // Occurrences starting before this (by wall-clock time) end before the window, whatever their time zone.
  const limit = from - duration - DAY_MS;
  if (plain && endedBefore(rules[0], start, limit)) {
    return true;
  }
  const iterator = event.iterator(plain && !rules[0].count ? startNear(rules[0], start, limit) : undefined);
  const utc = ICAL.Timezone.utcTimezone;
  for (let n = 0; n < MAX_ITERATIONS; n++) {
    const next = iterator.next();
    if (!next) {
      return true;
    }
    if (!ranged && floating(next) < limit) {
      continue;
    }
    const begins = next.toJSDate().getTime();
    if (replaced.has(begins) || next.toString() in changed || next.convertToZone(utc).toString() in changed) {
      // Replaced by a changed occurrence, which was read on its own.
      if (begins >= to && !ranged) {
        return true;
      }
      continue;
    }
    const details = event.getOccurrenceDetails(next);
    if (details.startDate.toJSDate().getTime() >= to && begins >= to) {
      return true;
    }
    push(details.item.component, details.startDate, details.endDate);
  }
  return false;
}

/**
 * The events, and occurrences of recurring events, that overlap `from` to `to`. Throws only when the data as a
 * whole cannot be parsed; a single unreadable event is skipped.
 */
export function readIcs(text: string, from: number, to: number, opts: IcsOptions): CalEvent[] {
  const oof = outOfOfficePattern(opts.outOfOfficeWords);
  const owners = opts.ownerAddresses.map((a) => a.trim().toLowerCase()).filter(Boolean);
  const out: CalEvent[] = [];
  let limited = false;

  const push: Push = (comp, startDate, endDate) => {
    const start = startDate.toJSDate().getTime();
    const end = endDate.toJSDate().getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
      return;
    }
    if (end <= from || start >= to) {
      return;
    }
    out.push({ ...classify(comp, oof, owners), start, end, isAllDay: startDate.isDate, source: opts.source });
  };

  for (const root of roots(text)) {
    registerTimezones(root);

    // Group by UID: each series master and its changed occurrences.
    const masters: Component[] = [];
    const exceptions = new Map<string, Component[]>();
    for (const vevent of root.getAllSubcomponents('vevent')) {
      if (vevent.hasProperty('recurrence-id')) {
        const uid = String(vevent.getFirstPropertyValue('uid') ?? '');
        exceptions.set(uid, [...(exceptions.get(uid) ?? []), vevent]);
      } else {
        masters.push(vevent);
      }
    }

    for (const master of masters) {
      try {
        const uid = String(master.getFirstPropertyValue('uid') ?? '');
        // Pass each series its own exceptions. Left alone, ical.js attaches every changed occurrence in the file
        // to every series, whatever its UID.
        const own = exceptions.get(uid) ?? [];
        exceptions.delete(uid);
        const event = new ICAL.Event(master, { exceptions: own });
        if (!event.isRecurring()) {
          // A single event far from the window is passed over by its wall-clock time, without a time zone lookup.
          if (floating(event.endDate) > from - DAY_MS && floating(event.startDate) < to + DAY_MS) {
            push(master, event.startDate, event.endDate);
          }
        } else if (!expandSeries(master, event, from, to, push)) {
          limited = true;
        }
      } catch {
        // Skip an event that cannot be read rather than lose the whole calendar.
      }
    }

    // Changed occurrences whose series is not in the data are read as single events.
    for (const list of exceptions.values()) {
      for (const vevent of list) {
        try {
          const event = new ICAL.Event(vevent);
          push(vevent, event.startDate, event.endDate);
        } catch {
          // Skip it.
        }
      }
    }
  }
  if (limited) {
    opts.onRepeatLimit?.();
  }
  return out;
}
