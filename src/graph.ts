/**
 * Microsoft Graph reads (SPEC 5.3): Teams presence and the Outlook calendar view. Only the fields the status needs
 * are requested: availability, activity and out of office from presence, and showAs, start, end, isAllDay and
 * isCancelled from events.
 */
import { WINDOW_MS } from './calendar.js';
import type { CalendarSource } from './calendar.js';
import { SourceError } from './errors.js';
import { retryAfterMs, send } from './http.js';
import { CONSENT_REASON } from './microsoft.js';
import type { MicrosoftAuth } from './microsoft.js';
import type { CalEvent, Presence, ShowAs } from './status.js';

export const GRAPH = 'https://graph.microsoft.com/v1.0';
export const GRAPH_HOST = 'graph.microsoft.com';
export const MAX_PAGES = 5;
const SELECT = 'showAs,start,end,isAllDay,isCancelled';

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

export class GraphClient implements CalendarSource {
  constructor(
    private readonly auth: MicrosoftAuth,
    /** The source name carried on each event. */
    private readonly source: string,
    private readonly now: () => number = Date.now,
  ) {}

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
      if (res.status === 429 || res.status === 503) {
        await res.body?.cancel().catch(() => undefined);
        const wait = retryAfterMs(res.headers.get('retry-after'), this.now());
        throw new SourceError('notReachable', `${GRAPH_HOST} answered HTTP ${res.status}`, wait !== null ? { retryAfterMs: wait } : {});
      }
      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined);
        throw new SourceError('notReachable', `${GRAPH_HOST} answered HTTP ${res.status}`);
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

  /** `/me/calendarView` for the window, following `@odata.nextLink` up to five pages. */
  async fetchEvents(now: number): Promise<CalEvent[]> {
    const from = new Date(now - WINDOW_MS).toISOString();
    const to = new Date(now + WINDOW_MS).toISOString();
    let url: string | null = `${GRAPH}/me/calendarView?startDateTime=${encodeURIComponent(from)}&endDateTime=${encodeURIComponent(to)}` +
      `&$select=${SELECT}&$top=200`;
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
