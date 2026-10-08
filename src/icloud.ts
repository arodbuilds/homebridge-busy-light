/**
 * iCloud calendars over CalDAV (SPEC 4.1 and 5.1): HTTP Basic with the Apple ID and an app-specific password,
 * discovery of the calendar list, and a time-range REPORT per calendar.
 */
import { WINDOW_MS } from './calendar.js';
import type { CalendarSource, IcsSettings } from './calendar.js';
import type { ICloudSourceConfig } from './config.js';
import { SourceError } from './errors.js';
import { hostOf, send } from './http.js';
import { readIcs } from './ics.js';
import type { CalEvent } from './status.js';
import { xmlBlocks, xmlHas, xmlText } from './xml.js';

export const ICLOUD_ROOT = 'https://caldav.icloud.com/';
/** Discovery is repeated after any failure and every 24 hours. */
export const REDISCOVER_MS = 24 * 3_600_000;
/** The short reason for a 401, also used in the state file. */
export const ICLOUD_REJECTED = 'iCloud did not accept the Apple ID and app-specific password';

export interface ICloudCalendar {
  name: string;
  url: string;
}

const PRINCIPAL_BODY = '<?xml version="1.0" encoding="utf-8"?>' +
  '<d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>';
const HOME_BODY = '<?xml version="1.0" encoding="utf-8"?>' +
  '<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>';
const LIST_BODY = '<?xml version="1.0" encoding="utf-8"?>' +
  '<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:displayname/><d:resourcetype/>' +
  '<c:supported-calendar-component-set/></d:prop></d:propfind>';

/** A CalDAV time stamp: 20261008T150000Z. */
export function davStamp(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

export function reportBody(from: number, to: number): string {
  return '<?xml version="1.0" encoding="utf-8"?>' +
    '<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-data/></d:prop>' +
    '<c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT">' +
    `<c:time-range start="${davStamp(from)}" end="${davStamp(to)}"/>` +
    '</c:comp-filter></c:comp-filter></c:filter></c:calendar-query>';
}

/** The calendars in a Depth 1 listing of the calendar home: calendar collections that hold events. */
export function parseCalendarList(xml: string, base: string): ICloudCalendar[] {
  const out: ICloudCalendar[] = [];
  for (const response of xmlBlocks(xml, 'response')) {
    const type = xmlBlocks(response, 'resourcetype')[0] ?? '';
    if (!xmlHas(type, 'calendar')) {
      continue;
    }
    const components = xmlBlocks(response, 'supported-calendar-component-set')[0];
    if (components !== undefined && !/name\s*=\s*["']VEVENT["']/i.test(components)) {
      continue; // Reminders lists
    }
    const href = xmlBlocks(response, 'href')[0];
    if (!href) {
      continue;
    }
    const url = new URL(xmlText(href).trim(), base).toString();
    // A calendar's path holds the account number, so it is never used as a name.
    const name = xmlText(xmlBlocks(response, 'displayname')[0] ?? '').trim() || 'Unnamed calendar';
    out.push({ name, url });
  }
  return out;
}

export class ICloudSource implements CalendarSource {
  private calendars: ICloudCalendar[] | null = null;
  private discoveredAt = 0;
  private readonly auth: string;

  constructor(
    private readonly config: ICloudSourceConfig,
    private readonly ics: IcsSettings,
    /** Called once per discovery with every calendar name found and the names in use. */
    private readonly onCalendars: (found: string[], used: string[]) => void = () => undefined,
  ) {
    this.auth = `Basic ${Buffer.from(`${config.appleId}:${config.appPassword}`).toString('base64')}`;
  }

  private async dav(method: string, url: string, depth: '0' | '1', body: string): Promise<string> {
    const res = await send(url, {
      method,
      headers: { 'Authorization': this.auth, 'Depth': depth, 'Content-Type': 'application/xml; charset=utf-8' },
      body,
    });
    if (res.status === 401) {
      await res.body?.cancel().catch(() => undefined);
      throw new SourceError('signInNeeded', ICLOUD_REJECTED, { unauthorized: true });
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      throw new SourceError('notReachable', `${hostOf(url)} answered HTTP ${res.status}`);
    }
    return res.text();
  }

  private async href(url: string, body: string, prop: string): Promise<string> {
    const xml = await this.dav('PROPFIND', url, '0', body);
    const block = xmlBlocks(xml, prop)[0];
    const href = block !== undefined ? xmlBlocks(block, 'href')[0] : undefined;
    if (!href) {
      throw new SourceError('notReachable', `${hostOf(url)} did not return the ${prop}`);
    }
    return new URL(xmlText(href).trim(), url).toString();
  }

  /** Steps 1 to 4 of SPEC 5.1. */
  async discover(): Promise<ICloudCalendar[]> {
    const principal = await this.href(ICLOUD_ROOT, PRINCIPAL_BODY, 'current-user-principal');
    const home = await this.href(principal, HOME_BODY, 'calendar-home-set');
    const all = parseCalendarList(await this.dav('PROPFIND', home, '1', LIST_BODY), home);
    const wanted = this.config.calendars.map((c) => c.name.toLowerCase()).filter(Boolean);
    const used = wanted.length ? all.filter((c) => wanted.includes(c.name.toLowerCase())) : all;
    this.onCalendars(all.map((c) => c.name), used.map((c) => c.name));
    return used;
  }

  async fetchEvents(now: number): Promise<CalEvent[]> {
    const from = now - WINDOW_MS;
    const to = now + WINDOW_MS;
    try {
      if (!this.calendars || now - this.discoveredAt >= REDISCOVER_MS) {
        this.calendars = null;
        this.calendars = await this.discover();
        this.discoveredAt = now;
      }
      const events: CalEvent[] = [];
      for (const calendar of this.calendars) {
        const xml = await this.dav('REPORT', calendar.url, '1', reportBody(from, to));
        for (const data of xmlBlocks(xml, 'calendar-data')) {
          try {
            events.push(...readIcs(xmlText(data), from, to, {
              source: this.config.name,
              outOfOfficeWords: this.ics.outOfOfficeWords,
              ownerAddresses: this.ics.ownerAddresses,
            }));
          } catch {
            // One unreadable calendar object is skipped.
          }
        }
      }
      return events;
    } catch (err) {
      this.calendars = null; // discover again next time
      throw err;
    }
  }
}
