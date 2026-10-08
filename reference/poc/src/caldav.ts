// Calendar sources that deliver iCalendar data: iCloud over CalDAV and Google by secret iCal address.

import type { CalEvent } from './status';
import { icsToEvents, type IcsOptions } from './ics';

const DAY = 86400000;
const TIMEOUT = 20000;

// ---- small XML helpers (CalDAV responses use varying namespace prefixes) ----

export function xmlBlocks(xml: string, local: string): string[] {
  const re = new RegExp(`<(?:[\\w-]+:)?${local}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${local}>`, 'g');
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    out.push(m[1]);
  }
  return out;
}

export function xmlText(s: string): string {
  const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(s);
  if (cdata) {
    return cdata[1];
  }
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

const davStamp = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

// ---- iCloud ----

export interface ICloudCalendar {
  name: string;
  url: string;
}

export class ICloudSource {
  private calendars: ICloudCalendar[] | null = null;
  private readonly auth: string;

  constructor(
    private readonly appleId: string,
    appPassword: string,
    /** Calendar names to include. Empty means every calendar. */
    private readonly only: string[],
    private readonly ics: IcsOptions,
    private readonly onCalendars: (names: string[], used: string[]) => void,
  ) {
    this.auth = 'Basic ' + Buffer.from(`${appleId}:${appPassword}`).toString('base64');
  }

  private async dav(method: string, url: string, depth: string, body: string): Promise<string> {
    const res = await fetch(url, {
      method,
      headers: { Authorization: this.auth, Depth: depth, 'Content-Type': 'application/xml; charset=utf-8' },
      body,
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (res.status === 401) {
      throw new Error('iCloud rejected the Apple ID or app-specific password');
    }
    if (!res.ok) {
      throw new Error(`iCloud ${method} returned HTTP ${res.status}`);
    }
    return res.text();
  }

  private async discover(): Promise<ICloudCalendar[]> {
    const root = 'https://caldav.icloud.com/';
    const href = (xml: string, prop: string, base: string) => {
      const block = xmlBlocks(xml, prop)[0];
      const h = block ? xmlBlocks(block, 'href')[0] : undefined;
      if (!h) {
        throw new Error(`iCloud did not return ${prop}`);
      }
      return new URL(xmlText(h).trim(), base).toString();
    };
    const principal = href(
      await this.dav('PROPFIND', root, '0',
        '<d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>'),
      'current-user-principal', root,
    );
    const home = href(
      await this.dav('PROPFIND', principal, '0',
        '<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>'),
      'calendar-home-set', principal,
    );
    const list = await this.dav('PROPFIND', home, '1',
      '<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:displayname/><d:resourcetype/>' +
      '<c:supported-calendar-component-set/></d:prop></d:propfind>');
    const all: ICloudCalendar[] = [];
    for (const resp of xmlBlocks(list, 'response')) {
      const type = xmlBlocks(resp, 'resourcetype')[0] ?? '';
      if (!/<(?:[\w-]+:)?calendar[\s/>]/.test(type)) {
        continue;
      }
      const comps = xmlBlocks(resp, 'supported-calendar-component-set')[0];
      if (comps && !/name=["']VEVENT["']/.test(comps)) {
        continue; // reminders lists
      }
      const h = xmlBlocks(resp, 'href')[0];
      if (!h) {
        continue;
      }
      const url = new URL(xmlText(h).trim(), home).toString();
      all.push({ name: xmlText(xmlBlocks(resp, 'displayname')[0] ?? '').trim() || url, url });
    }
    const wanted = this.only.map((n) => n.trim().toLowerCase()).filter(Boolean);
    const used = wanted.length ? all.filter((c) => wanted.includes(c.name.toLowerCase())) : all;
    this.onCalendars(all.map((c) => c.name), used.map((c) => c.name));
    return used;
  }

  async fetch(now: number): Promise<CalEvent[]> {
    const from = now - DAY;
    const to = now + DAY;
    try {
      this.calendars ??= await this.discover();
      const body =
        '<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-data/></d:prop>' +
        '<c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT">' +
        `<c:time-range start="${davStamp(from)}" end="${davStamp(to)}"/>` +
        '</c:comp-filter></c:comp-filter></c:filter></c:calendar-query>';
      const events: CalEvent[] = [];
      for (const cal of this.calendars) {
        const xml = await this.dav('REPORT', cal.url, '1', body);
        for (const data of xmlBlocks(xml, 'calendar-data')) {
          try {
            events.push(...icsToEvents(xmlText(data), from, to, this.ics));
          } catch {
            // skip one unreadable item
          }
        }
      }
      return events;
    } catch (e) {
      this.calendars = null; // discover again next time
      throw e;
    }
  }
}

// ---- Google (or any private ICS feed) ----

export class IcsFeedSource {
  private readonly urls: string[];

  constructor(urls: string[], private readonly ics: IcsOptions) {
    this.urls = urls.map((u) => u.trim().replace(/^webcal:\/\//i, 'https://')).filter(Boolean);
    for (const u of this.urls) {
      if (!/^https:\/\//i.test(u)) {
        throw new Error('Calendar addresses must start with https://');
      }
    }
  }

  async fetch(now: number): Promise<CalEvent[]> {
    const events: CalEvent[] = [];
    for (const url of this.urls) {
      const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) });
      if (!res.ok) {
        // The address itself is a secret, so it is never included in errors.
        throw new Error(`calendar feed returned HTTP ${res.status}`);
      }
      events.push(...icsToEvents(await res.text(), now - DAY, now + DAY, this.ics));
    }
    return events;
  }
}
