/**
 * What every calendar source shares (SPEC 5): one call that returns the events overlapping the window from 24 hours
 * before now to 24 hours after now, each already reduced to the event model.
 */
import type { CalendarChoice, CalendarUse } from './config.js';
import type { CalEvent } from './status.js';

export const WINDOW_MS = 24 * 3_600_000;

export interface CalendarSource {
  fetchEvents(now: number): Promise<CalEvent[]>;
}

/** What the iCalendar reader needs from the configuration as a whole. */
export interface IcsSettings {
  outOfOfficeWords: string[];
  ownerAddresses: string[];
}

/** How a source reports the calendars it chose, so the source runner can write the log lines of SPEC 12. */
export interface CalendarReport {
  /** Once per iCloud discovery: every calendar name found, the names in use, and those found but not listed. */
  discovered?(found: string[], used: string[], notInUse: string[]): void;
  /** For each listed calendar, each time the source looks for it: whether it is still there. */
  listed?(choice: CalendarChoice, present: boolean): void;
}

/**
 * SPEC 6.1: an event from a calendar that counts for out of office only keeps `oof` and is otherwise `free`, so it can
 * make the status Out of office and nothing else.
 */
export function applyUse(events: CalEvent[], use: CalendarUse): CalEvent[] {
  return use === 'outOfOffice' ? events.map((e) => (e.showAs === 'oof' ? e : { ...e, showAs: 'free' })) : events;
}
