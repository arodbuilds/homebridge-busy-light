/**
 * Right now (SPEC 11.3 B): a read-only row describing the running plugin, from the state file /status returns every
 * 15 seconds. The swatch carries the saved color of the status, since that is what the running plugin sends.
 */

import { lightsOf, type App } from '../app.js';
import { RIGHT_NOW, STATUS_NAMES } from '../copy.js';
import { el, paragraph } from '../dom.js';
import { formatTime, formatWhen, parseDate, relativeTime } from '../format.js';

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
  // During the meeting warning the status stays Available, and says when the meeting starts (SPEC 6.7, 11.3 B).
  const meetingAt = parseDate(status.meetingWarning?.meetingAt);
  if (status.status === 'available' && meetingAt) {
    return RIGHT_NOW.meetingAt(formatTime(meetingAt));
  }
  const until = parseDate(status.reason?.until);
  const source = status.reason?.source;
  if (source && status.reason?.app && !until) {
    return RIGHT_NOW.fromApp(source, status.reason.app);
  }
  // The time carries its day when it is not today (SPEC 11.3 B and G).
  const now = new Date(Date.now());
  if (source) {
    return until ? RIGHT_NOW.until(formatWhen(until, now), source) : RIGHT_NOW.from(source);
  }
  return until ? RIGHT_NOW.nothingUntil(formatWhen(until, now)) : RIGHT_NOW.nothingNow;
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
  } else if (status.status === 'notWorking') {
    // The Working switch is off (SPEC 6.6): the light is off, so the Off swatch.
    container.appendChild(el('div', { class: 'bl-now bl-now-not-working', role: 'status' },
      swatch('off'),
      el('div', { class: 'bl-now-text' },
        el('div', { class: 'bl-now-name' }, RIGHT_NOW.notWorking),
        el('div', { class: 'form-text bl-now-line' }, RIGHT_NOW.notWorkingLine),
      ),
    ));
  } else {
    container.appendChild(el('div', { class: 'bl-now', role: 'status' },
      swatch(app.saved.colors[status.status]),
      el('div', { class: 'bl-now-text' },
        el('div', { class: 'bl-now-name' }, STATUS_NAMES[status.status]),
        el('div', { class: 'form-text bl-now-line' }, reasonLine(status)),
      ),
    ));
  }
  // A chosen bulb that did not answer its last send keeps its last color, so it may still show an old one (SPEC 11.3 B,
  // from build 3.3).
  for (const light of lightsOf(status)) {
    if (light.enabled && light.host && light.answered === false) {
      container.appendChild(paragraph(RIGHT_NOW.notAnswering(light.label || light.host), 'form-text bl-now-silent'));
    }
  }
  const updated = parseDate(status.updatedAt);
  if (updated && Date.now() - updated.getTime() > STALE_MS) {
    container.appendChild(paragraph(RIGHT_NOW.stale(relativeTime(updated, new Date(Date.now()))), 'form-text bl-now-stale'));
  }
}
