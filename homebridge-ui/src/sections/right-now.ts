/**
 * Right now (SPEC 11.3 B): a read-only row describing the running plugin, from the state file /status returns every
 * 15 seconds. The swatch carries the saved color of the status, since that is what the running plugin sends.
 */

import type { App } from '../app.js';
import { RIGHT_NOW, STATUS_NAMES } from '../copy.js';
import { el, paragraph } from '../dom.js';
import { formatTime, parseDate, relativeTime } from '../format.js';

/** A state file older than this means the plugin has stopped writing it (SPEC 10.1: at least once a minute). */
export const STALE_MS = 5 * 60 * 1000;

/** A status swatch in the user's color, or an empty ring for Off. Decorative: the name beside it says the status. */
export function swatch(color: string): HTMLElement {
  const off = !/^#[0-9a-f]{6}$/i.test(color);
  return el('span', {
    class: `bl-swatch${off ? ' bl-swatch-off' : ''}`, 'aria-hidden': 'true', style: off ? undefined : `background-color: ${color.toUpperCase()}`,
  });
}

/** The muted line under the status name. */
export function reasonLine(status: NonNullable<App['status']>): string {
  if (status.override) {
    return RIGHT_NOW.override;
  }
  const until = parseDate(status.reason?.until);
  const source = status.reason?.source;
  if (source && status.reason?.app && !until) {
    return RIGHT_NOW.fromApp(source, status.reason.app);
  }
  if (source) {
    return until ? RIGHT_NOW.until(formatTime(until), source) : RIGHT_NOW.from(source);
  }
  return until ? RIGHT_NOW.nothingUntil(formatTime(until)) : RIGHT_NOW.nothingNow;
}

export function renderRightNow(app: App, container: HTMLElement): void {
  const status = app.status;
  if (status === undefined) {
    return; // the first /status answer arrives in a moment
  }
  // With no calendars the status can still come from other apps or the On a Call switch (SPEC 6.5 item 5).
  if (app.saved.calendars.length === 0 && !app.saved.statusInput.enabled && !app.saved.callSwitch.enabled) {
    container.appendChild(paragraph(RIGHT_NOW.noCalendars, 'bl-empty bl-now-empty'));
    return;
  }
  if (!status || !status.status) {
    container.appendChild(paragraph(RIGHT_NOW.notStarted, 'bl-empty bl-now-empty'));
    return;
  }
  if (status.status === 'unknown') {
    container.appendChild(el('div', { class: 'alert alert-warning py-2 px-3 mb-2 bl-now-unknown', role: 'status' }, RIGHT_NOW.unknown));
  } else {
    container.appendChild(el('div', { class: 'bl-now', role: 'status' },
      swatch(app.saved.colors[status.status]),
      el('div', { class: 'bl-now-text' },
        el('div', { class: 'bl-now-name' }, STATUS_NAMES[status.status]),
        el('div', { class: 'form-text bl-now-line' }, reasonLine(status)),
      ),
    ));
  }
  const updated = parseDate(status.updatedAt);
  if (updated && Date.now() - updated.getTime() > STALE_MS) {
    container.appendChild(paragraph(RIGHT_NOW.stale(relativeTime(updated, new Date(Date.now()))), 'form-text bl-now-stale'));
  }
}
