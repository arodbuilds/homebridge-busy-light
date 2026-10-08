/**
 * Google Calendar (secret iCal address) and calendar URL sources (SPEC 5.2). The address is the credential, so it
 * is never logged or written anywhere: errors name the host only.
 */
import { WINDOW_MS, applyUse } from './calendar.js';
import type { CalendarSource, IcsSettings } from './calendar.js';
import type { GoogleSourceConfig, UrlSourceConfig } from './config.js';
import { SourceError } from './errors.js';
import { describeNetworkError, hostOf, readLimited, send } from './http.js';
import { readIcs } from './ics.js';
import type { CalEvent } from './status.js';

export const MAX_BODY_BYTES = 10 * 1024 * 1024;
const MAX_REDIRECTS = 5;
/** A 304 reuses the events parsed from the last full download for at most this long, so the window keeps moving. */
export const REUSE_PARSED_MS = 6 * 3_600_000;

export class UrlSource implements CalendarSource {
  private etag: string | null = null;
  private parsed: CalEvent[] | null = null;
  private parsedAt = 0;

  constructor(
    private readonly config: GoogleSourceConfig | UrlSourceConfig,
    private readonly ics: IcsSettings,
  ) {}

  /** The host of the address, which is all that may be shown of it. */
  get host(): string {
    return hostOf(this.config.url);
  }

  /** The window's events, with the source's `use` applied (SPEC 5.2 item 6). */
  async fetchEvents(now: number): Promise<CalEvent[]> {
    return applyUse(await this.read(now), this.config.use);
  }

  private async read(now: number): Promise<CalEvent[]> {
    const reuse = this.parsed !== null && this.etag !== null && now - this.parsedAt < REUSE_PARSED_MS;
    let url = this.config.url;
    let res: Response | null = null;
    let redirectStatus = 0;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const headers: Record<string, string> = {};
      if (reuse && this.etag) {
        headers['If-None-Match'] = this.etag;
      }
      res = await send(url, { headers, redirect: 'manual' });
      if (res.status < 300 || res.status >= 400 || res.status === 304) {
        break;
      }
      const location = res.headers.get('location');
      await res.body?.cancel().catch(() => undefined);
      if (!location) {
        throw new SourceError('notReachable', `${hostOf(url)} answered HTTP ${res.status}`, { kind: 'http', status: res.status });
      }
      const next = new URL(location, url);
      if (next.protocol !== 'https:') {
        throw new SourceError('notReachable', `${hostOf(url)} redirected to an address that is not https://`, { kind: 'insecure' });
      }
      url = next.toString();
      redirectStatus = res.status;
      res = null;
    }
    if (!res) {
      throw new SourceError('notReachable', `too many redirects from ${this.host}`, { kind: 'http', status: redirectStatus });
    }
    const host = hostOf(url);
    if (res.status === 304 && reuse && this.parsed) {
      await res.body?.cancel().catch(() => undefined);
      return this.parsed.filter((e) => e.end > now - WINDOW_MS && e.start < now + WINDOW_MS);
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      throw new SourceError('notReachable', `${host} answered HTTP ${res.status}`, { kind: 'http', status: res.status });
    }
    let text: string;
    try {
      text = await readLimited(res, MAX_BODY_BYTES, `the calendar from ${host} is larger than 10 MB`);
    } catch (err) {
      throw err instanceof SourceError ? err : new SourceError('notReachable', describeNetworkError(err, host), { kind: 'network' });
    }
    if (!/BEGIN:VCALENDAR/i.test(text)) {
      throw new SourceError('notReachable', `the data from ${host} is not a calendar`, { kind: 'notCalendar' });
    }
    let events: CalEvent[];
    try {
      events = readIcs(text, now - WINDOW_MS, now + WINDOW_MS, {
        source: this.config.name,
        outOfOfficeWords: this.ics.outOfOfficeWords,
        ownerAddresses: this.ics.ownerAddresses,
      });
    } catch {
      throw new SourceError('notReachable', `the data from ${host} is not a calendar`, { kind: 'notCalendar' });
    }
    this.etag = res.headers.get('etag');
    this.parsed = events;
    this.parsedAt = now;
    return events;
  }
}
