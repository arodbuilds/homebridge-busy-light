/**
 * What every calendar source shares (SPEC 5): one call that returns the events overlapping the window from 24 hours
 * before now to 7 days after now, each already reduced to the event model.
 */
import type { CalendarChoice, CalendarUse } from './config.js';
import type { CalEvent } from './status.js';

/** The window reaches back 24 hours, for events that started before now and are still on (SPEC 5). */
export const WINDOW_BEFORE_MS = 24 * 3_600_000;
/**
 * And 7 days ahead (from build 3.3, the owner's decision for 1.0; 24 hours before it), so a Friday afternoon with
 * nothing until Monday morning says `until Monday at 9:00 AM` (SPEC 5, 11.3 G, 12).
 */
export const WINDOW_AFTER_MS = 7 * 24 * 3_600_000;

/** The window of SPEC 5 at `now`, for the iCloud REPORT, the Graph calendarView range and the events kept from an address. */
export function readingWindow(now: number): { from: number; to: number } {
  return { from: now - WINDOW_BEFORE_MS, to: now + WINDOW_AFTER_MS };
}

export interface CalendarSource {
  fetchEvents(now: number): Promise<CalEvent[]>;
}

/** What the iCalendar reader needs from the configuration as a whole. */
export interface IcsSettings {
  outOfOfficeWords: string[];
  ownerAddresses: string[];
  /** Called when a recurring series reaches the safety cap of SPEC 5.4 item 3, so the source can say so once. */
  onRepeatLimit?: () => void;
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
