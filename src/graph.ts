/**
 * Microsoft Graph reads (SPEC 5.3): Teams presence and the Outlook calendar view. Only the fields the status needs
 * are requested: availability, activity and out of office from presence, and showAs, start, end, isAllDay and
 * isCancelled from events.
 */
import { WINDOW_MS, applyUse } from './calendar.js';
import type { CalendarReport, CalendarSource } from './calendar.js';
import type { CalendarChoice } from './config.js';
import { SourceError } from './errors.js';
import { retryAfterMs, send } from './http.js';
import { CONSENT_REASON } from './microsoft.js';
import type { MicrosoftAuth } from './microsoft.js';
import type { CalEvent, Presence, ShowAs } from './status.js';

export const GRAPH = 'https://graph.microsoft.com/v1.0';
export const GRAPH_HOST = 'graph.microsoft.com';
export const MAX_PAGES = 5;
/** The only event fields Busy Light asks Graph for (SPEC 5.3). */
export const EVENT_SELECT = 'showAs,start,end,isAllDay,isCancelled';

interface GraphDateTime {
  dateTime?: unknown;
}

interface GraphEvent {
  showAs?: unknown;
  start?: GraphDateTime;
  end?: GraphDateTime;
  isAllDay?: unknown;
  isCancelled?: unknown;
}

/** Graph's showAs, reduced to the event model. Working elsewhere is free; anything unrecognised is busy. */
export function mapShowAs(value: unknown): ShowAs {
  switch (value) {
  case 'free':
  case 'workingElsewhere':
    return 'free';
  case 'tentative':
    return 'tentative';
  case 'oof':
    return 'oof';
  default:
    return 'busy';
  }
}

/**
 * Epoch milliseconds for a Graph date-time. Timed events are UTC without a zone suffix (the `Prefer` header);
 * all-day events are dates, read in the host's local time zone.
 */
export function parseGraphTime(value: unknown, isAllDay: boolean): number {
  if (typeof value !== 'string') {
    return NaN;
  }
  if (isAllDay) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime() : NaN;
  }
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(\.\d+)?/.exec(value);
  if (!m) {
    return NaN;
  }
  const ms = m[2] ? Math.round(Number(`0${m[2]}`) * 1000) : 0;
  return Date.parse(`${m[1]}Z`) + ms;
}

/** One Graph event as the event model, or null when its times cannot be read. */
export function parseGraphEvent(e: GraphEvent, source: string): CalEvent | null {
  const isAllDay = e.isAllDay === true;
  const start = parseGraphTime(e.start?.dateTime, isAllDay);
  const end = parseGraphTime(e.end?.dateTime, isAllDay);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return null;
  }
  return { showAs: mapShowAs(e.showAs), start, end, isAllDay, isCancelled: e.isCancelled === true, source };
}

/** A calendar from `/me/calendars`: nothing but what the settings page shows. */
export interface GraphCalendar {
  id: string;
  name: string;
  isDefault: boolean;
  /** Lower case; empty when Graph did not say. */
  ownerAddress: string;
}

export interface GraphCalendarOptions {
  /** The listed calendars (SPEC 9.1 item 14). Empty reads the default calendar. */
  calendars?: CalendarChoice[];
  /** Told after each read of a listed calendar whether it was there. */
  report?: CalendarReport;
}

export class GraphClient implements CalendarSource {
  private readonly calendars: CalendarChoice[];
  private readonly report: CalendarReport;

  constructor(
    private readonly auth: MicrosoftAuth,
    /** The source name carried on each event. */
    private readonly source: string,
    private readonly now: () => number = Date.now,
    options: GraphCalendarOptions = {},
  ) {
    this.calendars = options.calendars ?? [];
    this.report = options.report ?? {};
  }

  /** `part` names the read (presence or calendar), so a 403 on one is cleared only by that one working again. */
  private async get(url: string, part: string, headers: Record<string, string> = {}): Promise<Record<string, unknown>> {
    for (let attempt = 0; ; attempt++) {
      const token = await this.auth.getAccessToken();
      const res = await send(url, { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json', ...headers } });
      if (res.status === 401 && attempt === 0) {
        await res.body?.cancel().catch(() => undefined);
        this.auth.invalidate();
        continue;
      }
      if (res.status === 401) {
        await res.body?.cancel().catch(() => undefined);
        throw new SourceError('signInNeeded', `${GRAPH_HOST} did not accept the sign-in`);
      }
      if (res.status === 403) {
        await res.body?.cancel().catch(() => undefined);
        throw this.auth.refuse(CONSENT_REASON, part);
      }
      if (res.status === 404) {
        await res.body?.cancel().catch(() => undefined);
        throw new SourceError('notReachable', `${GRAPH_HOST} answered HTTP 404`, { notFound: true });
      }
      if (res.status === 429 || res.status === 503) {
        await res.body?.cancel().catch(() => undefined);
        const wait = retryAfterMs(res.headers.get('retry-after'), this.now());
        throw new SourceError('notReachable', `${GRAPH_HOST} answered HTTP ${res.status}`, wait !== null ? { retryAfterMs: wait } : {});
      }
      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined);
        throw new SourceError('notReachable', `${GRAPH_HOST} answered HTTP ${res.status}`, { kind: 'http', status: res.status });
      }
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        throw new SourceError('notReachable', `${GRAPH_HOST} sent an answer that could not be read`);
      }
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new SourceError('notReachable', `${GRAPH_HOST} sent an answer that could not be read`);
      }
      this.auth.accepted(part);
      return body as Record<string, unknown>;
    }
  }

  /**
   * The user's Outlook calendars (SPEC 10.3 item 4), selecting only the id, name, default flag and owner, following
   * `@odata.nextLink` on graph.microsoft.com up to five pages.
   */
  async listCalendars(): Promise<GraphCalendar[]> {
    let url: string | null = `${GRAPH}/me/calendars?$select=id,name,isDefaultCalendar,owner`;
    const out: GraphCalendar[] = [];
    for (let page = 0; page < MAX_PAGES && url; page++) {
      const body = await this.get(url, 'calendar');
      const value = Array.isArray(body.value) ? body.value as Record<string, unknown>[] : [];
      for (const c of value) {
        if (!c || typeof c !== 'object' || typeof c.id !== 'string' || !c.id) {
          continue;
        }
        const owner = c.owner as { address?: unknown } | null | undefined;
        out.push({
          id: c.id,
          name: typeof c.name === 'string' && c.name.trim() ? c.name.trim() : 'Unnamed calendar',
          isDefault: c.isDefaultCalendar === true,
          ownerAddress: typeof owner?.address === 'string' ? owner.address.toLowerCase() : '',
        });
      }
      const next = body['@odata.nextLink'];
      url = typeof next === 'string' && next.startsWith(`https://${GRAPH_HOST}/`) ? next : null;
    }
    return out;
  }

  /** `/me/presence`. A missing `outOfOfficeSettings` means not out of office. */
  async getPresence(): Promise<Presence> {
    const p = await this.get(`${GRAPH}/me/presence`, 'presence');
    const ooo = p.outOfOfficeSettings as { isOutOfOffice?: unknown } | null | undefined;
    return {
      availability: typeof p.availability === 'string' ? p.availability : '',
      activity: typeof p.activity === 'string' ? p.activity : '',
      outOfOffice: ooo?.isOutOfOffice === true,
    };
  }

  /**
   * The window's events (SPEC 5.3 item 2): the default calendar's `/me/calendarView`, or with a list, each listed
   * calendar's `/me/calendars/{id}/calendarView` with its `use`. A listed calendar that answers 404 is left out and
   * reported; the others are read.
   */
  async fetchEvents(now: number): Promise<CalEvent[]> {
    const from = now - WINDOW_MS;
    const to = now + WINDOW_MS;
    if (this.calendars.length === 0) {
      return this.calendarView(`${GRAPH}/me/calendarView`, from, to);
    }
    const events: CalEvent[] = [];
    for (const choice of this.calendars) {
      try {
        const view = await this.calendarView(`${GRAPH}/me/calendars/${encodeURIComponent(choice.id ?? '')}/calendarView`, from, to);
        events.push(...applyUse(view, choice.use));
        this.report.listed?.(choice, true);
      } catch (err) {
        if (!(err instanceof SourceError && err.options.notFound)) {
          throw err;
        }
        this.report.listed?.(choice, false);
      }
    }
    return events;
  }

  /** One calendar view between two times, following `@odata.nextLink` up to five pages. */
  async calendarView(base: string, fromMs: number, toMs: number): Promise<CalEvent[]> {
    const from = new Date(fromMs).toISOString();
    const to = new Date(toMs).toISOString();
    let url: string | null = `${base}?startDateTime=${encodeURIComponent(from)}&endDateTime=${encodeURIComponent(to)}` +
      `&$select=${EVENT_SELECT}&$top=200`;
    const events: CalEvent[] = [];
    for (let page = 0; page < MAX_PAGES && url; page++) {
      const body = await this.get(url, 'calendar', { Prefer: 'outlook.timezone="UTC"' });
      const value = Array.isArray(body.value) ? body.value as GraphEvent[] : [];
      for (const e of value) {
        const event = e && typeof e === 'object' ? parseGraphEvent(e, this.source) : null;
        if (event) {
          events.push(event);
        }
      }
      const next = body['@odata.nextLink'];
      url = typeof next === 'string' && next.startsWith(`https://${GRAPH_HOST}/`) ? next : null;
    }
    return events;
  }
}
