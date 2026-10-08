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

export interface IcsOptions {
  /** The name of the source, carried on each event. */
  source: string;
  /** Titles containing one of these as a whole word, case-insensitive, are out of office. */
  outOfOfficeWords: string[];
  /** The owner's addresses, lower case. An invitation one of them declined is free. */
  ownerAddresses: string[];
}

/** Iterations allowed per recurring series (SPEC 5.4 item 3). */
export const MAX_ITERATIONS = 20_000;

const BUILT_IN_ZONES = new Set(['UTC', 'GMT', 'Z']);

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

/** SPEC 6.4, first match wins. */
export function classify(comp: Component, oof: RegExp | null, owners: string[]): { showAs: ShowAs; isCancelled: boolean } {
  const isCancelled = upper(comp, 'status') === 'CANCELLED';
  const busyStatus = upper(comp, 'x-microsoft-cdo-busystatus');
  for (const attendee of comp.getAllProperties('attendee')) {
    const value = attendee.getFirstValue();
    const address = typeof value === 'string' ? value.replace(/^mailto:/i, '').trim().toLowerCase() : '';
    const partstat = attendee.getParameter('partstat');
    if (address && owners.includes(address) && typeof partstat === 'string' && partstat.toUpperCase() === 'DECLINED') {
      return { showAs: 'free', isCancelled };
    }
  }
  const title = comp.getFirstPropertyValue('summary');
  if (busyStatus === 'OOF' || (oof !== null && typeof title === 'string' && oof.test(title))) {
    return { showAs: 'oof', isCancelled };
  }
  if (upper(comp, 'transp') === 'TRANSPARENT' || busyStatus === 'FREE') {
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
 * The events, and occurrences of recurring events, that overlap `from` to `to`. Throws only when the data as a
 * whole cannot be parsed; a single unreadable event is skipped.
 */
export function readIcs(text: string, from: number, to: number, opts: IcsOptions): CalEvent[] {
  const oof = outOfOfficePattern(opts.outOfOfficeWords);
  const owners = opts.ownerAddresses.map((a) => a.trim().toLowerCase()).filter(Boolean);
  const out: CalEvent[] = [];

  const push = (comp: Component, startDate: Time, endDate: Time) => {
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
          push(master, event.startDate, event.endDate);
          continue;
        }
        const iterator = event.iterator();
        for (let n = 0; n < MAX_ITERATIONS; n++) {
          const next = iterator.next();
          if (!next) {
            break;
          }
          const details = event.getOccurrenceDetails(next);
          if (details.startDate.toJSDate().getTime() >= to && next.toJSDate().getTime() >= to) {
            break;
          }
          push(details.item.component, details.startDate, details.endDate);
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
  return out;
}
