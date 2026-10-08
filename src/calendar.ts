/**
 * What every calendar source shares (SPEC 5): one call that returns the events overlapping the window from 24 hours
 * before now to 24 hours after now, each already reduced to the event model.
 */
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
