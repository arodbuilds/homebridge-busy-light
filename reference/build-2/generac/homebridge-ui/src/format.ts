/**
 * Times as the page shows them, in the browser's locale and time zone: 12-hour times, US-style dates (SPEC
 * writing style) and the relative times of the account and generator cards.
 */

import { RELATIVE } from './copy.js';

export function parseDate(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "3:15 PM". */
export function formatTime(d: Date): string {
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/** "September 12, 2026". */
export function formatDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

/** "3:15 PM" today, else "September 12, 2026 at 3:15 PM". */
export function formatTimeOrDate(d: Date, now: Date = new Date()): string {
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  return sameDay ? formatTime(d) : `${formatDate(d)} at ${formatTime(d)}`;
}

/** "just now", "2 minutes ago", "3 hours ago", "2 days ago". */
export function relativeTime(d: Date, now: Date = new Date()): string {
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

/** "10:00" to "10:00 AM"; null when the value is not HH:MM. */
export function hhmmTo12h(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) {
    return null;
  }
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) {
    return null;
  }
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(min).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/** A number with at most one decimal, for volts. */
export function formatVolts(v: number): string {
  return (Math.round(v * 10) / 10).toFixed(1);
}
