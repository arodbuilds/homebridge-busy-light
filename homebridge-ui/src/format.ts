/**
 * Times as the page shows them (SPEC 11.3 G): 12-hour times in the host's locale, the relative times of the Right now
 * row and the calendar cards, and the durations of the interval selects.
 */

import { DURATIONS, RELATIVE, WHEN } from './copy.js';

export function parseDate(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "1:00 PM": 12-hour in the browser's locale, with an ordinary space before AM or PM. */
export function formatTime(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true }).replace(/[\u202f\u00a0]/g, ' ');
}

/** Calendar days from one date to another in the browser's time zone: 0 the same day, 1 the next, and so on. */
function calendarDays(from: Date, to: Date): number {
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((day(to) - day(from)) / 86_400_000);
}

/**
 * A time with its day when it is not today (SPEC 11.3 G): "1:00 PM" today, "tomorrow at 9:00 AM", "Monday at 9:00 AM"
 * within the next 6 days, "October 16 at 9:00 AM" beyond. Weekdays and months are named in English, as the page is.
 */
export function formatWhen(d: Date, now: Date = new Date(Date.now())): string {
  const time = formatTime(d);
  const days = calendarDays(now, d);
  if (days === 0) {
    return time;
  }
  if (days === 1) {
    return WHEN.tomorrow(time);
  }
  if (days > 1 && days <= 6) {
    return WHEN.weekday(d.toLocaleDateString('en-US', { weekday: 'long' }), time);
  }
  return WHEN.date(d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' }), time);
}

/** "just now", "2 minutes ago", "3 hours ago", "2 days ago". */
export function relativeTime(d: Date, now: Date = new Date(Date.now())): string {
  const seconds = Math.max(0, Math.round((now.getTime() - d.getTime()) / 1000));
  if (seconds < 45) {
    return RELATIVE.justNow;
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return RELATIVE.minutes(Math.max(1, minutes));
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return RELATIVE.hours(hours);
  }
  return RELATIVE.days(Math.round(hours / 24));
}

/** A duration in seconds as SPEC 11.3 G writes it: `1 minute`, `{n} minutes`, `{n} seconds`, `{m} minutes {s} seconds`. */
export function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return DURATIONS.seconds(seconds);
  }
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  if (rest === 0) {
    return minutes === 1 ? DURATIONS.minute : DURATIONS.minutes(minutes);
  }
  return minutes === 1 ? DURATIONS.minuteAndSeconds(rest) : DURATIONS.minutesAndSeconds(minutes, rest);
}
