/**
 * iCloud calendars over CalDAV (SPEC 4.1 and 5.1): HTTP Basic with the Apple ID and an app-specific password,
 * discovery of the calendar list, and a time-range REPORT per calendar.
 */
import { WINDOW_MS, applyUse } from './calendar.js';
import type { CalendarReport, CalendarSource, IcsSettings } from './calendar.js';
import type { CalendarChoice, CalendarUse, ICloudSourceConfig } from './config.js';
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
  /** The collection's path on the CalDAV host: the `id` of a `calendars` entry. It holds the account number, so it is never logged. */
  path: string;
  /** A calendar someone else shared with the user (`shared` in the resource type; `shared-owner` is the user's own). */
  shared: boolean;
  /** A subscribed calendar: listed by the settings page, never ticked (SPEC 10.3 item 1). */
  subscribed: boolean;
  /** A calendar collection the plugin can read with REPORT (`calendar` in the resource type). */
  readable: boolean;
}

/** A calendar the source reads, with what it counts for. */
export interface ChosenCalendar {
  calendar: ICloudCalendar;
  use: CalendarUse;
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

/**
 * The calendars in a Depth 1 listing of the calendar home: calendar collections that hold events, and subscribed
 * calendars (which the settings page lists but cannot tick).
 */
export function parseCalendarList(xml: string, base: string): ICloudCalendar[] {
  const out: ICloudCalendar[] = [];
  for (const response of xmlBlocks(xml, 'response')) {
    const type = xmlBlocks(response, 'resourcetype')[0] ?? '';
    const readable = xmlHas(type, 'calendar');
    const subscribed = xmlHas(type, 'subscribed');
    if (!readable && !subscribed) {
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
    const url = new URL(xmlText(href).trim(), base);
    // A calendar's path holds the account number, so it is never used as a name.
    const name = xmlText(xmlBlocks(response, 'displayname')[0] ?? '').trim() || 'Unnamed calendar';
    out.push({ name, url: url.toString(), path: url.pathname, shared: xmlHas(type, 'shared'), subscribed, readable });
  }
  return out;
}

/** Two collection paths name the same calendar: compared decoded and without regard to a trailing slash. */
export function samePath(a: string, b: string): boolean {
  const norm = (p: string): string => {
    let decoded = p;
    try {
      decoded = decodeURIComponent(p);
    } catch {
      // keep it as written
    }
    return decoded.replace(/\/+$/, '');
  };
  return norm(a) === norm(b);
}

/**
 * SPEC 5.1 step 4: with no list, every readable calendar, counting for everything. Otherwise each entry takes the
 * calendar whose path matches its id or, without an id or when the id matches nothing, the calendar whose name matches
 * its name without regard to case. A calendar is taken once. `missing` holds the entries that matched nothing.
 */
export function chooseCalendars(found: ICloudCalendar[], choices: CalendarChoice[]): { used: ChosenCalendar[]; missing: CalendarChoice[] } {
  const readable = found.filter((c) => c.readable);
  if (choices.length === 0) {
    return { used: readable.map((calendar) => ({ calendar, use: 'all' })), missing: [] };
  }
  const used: ChosenCalendar[] = [];
  const free = (c: ICloudCalendar): boolean => !used.some((u) => u.calendar === c);
  // Ids first, so a name never takes a calendar that another entry names by its id.
  const byName: CalendarChoice[] = [];
  for (const choice of choices) {
    const calendar = choice.id !== null ? readable.find((c) => free(c) && samePath(c.path, choice.id!)) : undefined;
    if (calendar) {
      used.push({ calendar, use: choice.use });
    } else {
      byName.push(choice);
    }
  }
  // A name keeps every calendar of that name, as build 1 did.
  const missing: CalendarChoice[] = [];
  for (const choice of byName) {
    const name = choice.name.toLowerCase();
    const calendars = name ? readable.filter((c) => free(c) && c.name.toLowerCase() === name) : [];
    used.push(...calendars.map((calendar) => ({ calendar, use: choice.use })));
    if (calendars.length === 0) {
      missing.push(choice);
    }
  }
  return { used, missing };
}

/** What the iCloud reader needs: the source's name and credentials, and the calendars it lists. */
export type ICloudCredentials = Pick<ICloudSourceConfig, 'name' | 'appleId' | 'appPassword' | 'calendars'>;

export class ICloudSource implements CalendarSource {
  private calendars: ChosenCalendar[] | null = null;
  private discoveredAt = 0;
  private readonly auth: string;

  constructor(
    private readonly config: ICloudCredentials,
    private readonly ics: IcsSettings,
    /** Told once per discovery which calendars were found, used and missing. */
    private readonly report: CalendarReport = {},
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
      throw new SourceError('notReachable', `${hostOf(url)} answered HTTP ${res.status}`, { kind: 'http', status: res.status });
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

  /** Steps 1 to 3 of SPEC 5.1: every calendar on the account, subscribed ones included. */
  async listCalendars(): Promise<ICloudCalendar[]> {
    const principal = await this.href(ICLOUD_ROOT, PRINCIPAL_BODY, 'current-user-principal');
    const home = await this.href(principal, HOME_BODY, 'calendar-home-set');
    return parseCalendarList(await this.dav('PROPFIND', home, '1', LIST_BODY), home);
  }

  /** Steps 1 to 4 of SPEC 5.1, reporting the names found, in use and not in use, and each listed calendar's presence. */
  async discover(): Promise<ChosenCalendar[]> {
    const all = await this.listCalendars();
    const { used, missing } = chooseCalendars(all, this.config.calendars);
    const readable = all.filter((c) => c.readable);
    const notInUse = this.config.calendars.length ? readable.filter((c) => !c.subscribed && !used.some((u) => u.calendar === c)) : [];
    this.report.discovered?.(readable.map((c) => c.name), used.map((u) => u.calendar.name), notInUse.map((c) => c.name));
    for (const choice of this.config.calendars) {
      this.report.listed?.(choice, !missing.includes(choice));
    }
    return used;
  }

  /** The events of one calendar between two times (step 5), each read as in 5.4. */
  async readCalendar(calendar: ICloudCalendar, from: number, to: number): Promise<CalEvent[]> {
    const xml = await this.dav('REPORT', calendar.url, '1', reportBody(from, to));
    const events: CalEvent[] = [];
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
    return events;
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
      for (const { calendar, use } of this.calendars) {
        events.push(...applyUse(await this.readCalendar(calendar, from, to), use));
      }
      return events;
    } catch (err) {
      this.calendars = null; // discover again next time
      throw err;
    }
  }
}
