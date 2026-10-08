// Turns iCalendar (ICS) text into CalEvent entries, expanding recurring events.
// Shared by the iCloud (CalDAV) and Google (secret iCal address) sources.

import type { CalEvent } from './status';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mod = require('ical.js');
const ICAL: any = mod.default ?? mod;

export interface IcsOptions {
  /** Event titles containing any of these words count as out of office. */
  oofKeywords: string[];
  /** The owner's email addresses; invitations they declined are treated as free. */
  selfEmails: string[];
}

const MAX_OCCURRENCES = 20000;

function keywordRegex(words: string[]): RegExp | null {
  const cleaned = words.map((w) => w.trim()).filter(Boolean);
  if (cleaned.length === 0) {
    return null;
  }
  const escaped = cleaned.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`(^|[^a-z0-9])(${escaped.join('|')})([^a-z0-9]|$)`, 'i');
}

function classify(comp: any, oof: RegExp | null, self: string[]): { showAs: string; isCancelled: boolean } {
  const text = (name: string) => String(comp.getFirstPropertyValue(name) ?? '').toUpperCase();
  const isCancelled = text('status') === 'CANCELLED';
  const summary = String(comp.getFirstPropertyValue('summary') ?? '');
  const msBusy = text('x-microsoft-cdo-busystatus');

  for (const att of comp.getAllProperties('attendee')) {
    const addr = String(att.getFirstValue() ?? '').replace(/^mailto:/i, '').toLowerCase();
    if (self.includes(addr) && String(att.getParameter('partstat') ?? '').toUpperCase() === 'DECLINED') {
      return { showAs: 'free', isCancelled };
    }
  }
  if (msBusy === 'OOF' || (oof && oof.test(summary))) {
    return { showAs: 'oof', isCancelled };
  }
  if (text('transp') === 'TRANSPARENT' || msBusy === 'FREE') {
    return { showAs: 'free', isCancelled };
  }
  if (text('status') === 'TENTATIVE' || msBusy === 'TENTATIVE') {
    return { showAs: 'tentative', isCancelled };
  }
  return { showAs: 'busy', isCancelled };
}

/** Events (and occurrences of recurring events) that overlap the from/to window. */
export function icsToEvents(text: string, from: number, to: number, opts: IcsOptions): CalEvent[] {
  const oof = keywordRegex(opts.oofKeywords);
  const self = opts.selfEmails.map((e) => e.trim().toLowerCase()).filter(Boolean);
  const root = new ICAL.Component(ICAL.parse(text));

  for (const vtz of root.getAllSubcomponents('vtimezone')) {
    const tzid = vtz.getFirstPropertyValue('tzid');
    if (tzid && !ICAL.TimezoneService.has(tzid)) {
      ICAL.TimezoneService.register(tzid, new ICAL.Timezone({ component: vtz, tzid }));
    }
  }

  const masters: any[] = [];
  const exceptions = new Map<string, any[]>();
  for (const v of root.getAllSubcomponents('vevent')) {
    if (v.hasProperty('recurrence-id')) {
      const uid = String(v.getFirstPropertyValue('uid'));
      exceptions.set(uid, [...(exceptions.get(uid) ?? []), v]);
    } else {
      masters.push(v);
    }
  }

  const out: CalEvent[] = [];
  const push = (comp: any, startDate: any, endDate: any) => {
    const start = startDate.toJSDate().getTime();
    const end = endDate.toJSDate().getTime();
    if (end <= from || start >= to) {
      return;
    }
    out.push({ ...classify(comp, oof, self), start, end, isAllDay: Boolean(startDate.isDate) });
  };

  for (const master of masters) {
    try {
      const uid = String(master.getFirstPropertyValue('uid'));
      // Exceptions are passed explicitly; left alone, ical.js attaches every changed
      // occurrence in the file to every series, whatever its UID.
      const ev = new ICAL.Event(master, { exceptions: exceptions.get(uid) ?? [] });
      exceptions.delete(uid);
      if (!ev.isRecurring()) {
        push(master, ev.startDate, ev.endDate);
        continue;
      }
      const it = ev.iterator();
      for (let n = 0; n < MAX_OCCURRENCES; n++) {
        const next = it.next();
        if (!next) {
          break;
        }
        const d = ev.getOccurrenceDetails(next);
        if (d.startDate.toJSDate().getTime() >= to && next.toJSDate().getTime() >= to) {
          break;
        }
        push(d.item.component, d.startDate, d.endDate);
      }
    } catch {
      // Skip an event that cannot be read rather than lose the whole calendar.
    }
  }

  // Changed occurrences whose series was not included in the data.
  for (const list of exceptions.values()) {
    for (const ex of list) {
      try {
        const ev = new ICAL.Event(ex);
        push(ex, ev.startDate, ev.endDate);
      } catch {
        // skip
      }
    }
  }
  return out;
}
