import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import type { CalendarReport } from '../src/calendar.js';
import type { CalendarChoice, ICloudSourceConfig } from '../src/config.js';
import { SourceError } from '../src/errors.js';
import { parseConfig } from '../src/config.js';
import { ICLOUD_REJECTED, ICloudSource, REDISCOVER_MS, chooseCalendars, davStamp, parseCalendarList, samePath } from '../src/icloud.js';
import { SourceRunner } from '../src/sources.js';
import { xmlBlocks, xmlText } from '../src/xml.js';
import { FakeFetch, fakeLog, fixture, fixtureTitles, text, tmpDir } from './helpers.js';
import type { Call } from './helpers.js';

const now = Date.UTC(2026, 9, 8, 15);
const ROOT = 'https://caldav.icloud.com/';
const PRINCIPAL = 'https://caldav.icloud.com/10000001/principal/';
const HOME = 'https://p01-caldav.icloud.com/10000001/calendars/';
const PASSWORD = 'abcd-efgh-ijkl-mnop';
const ics = { outOfOfficeWords: ['OOO'], ownerAddresses: ['person@example.com'] };

let fake: FakeFetch;
beforeEach(() => {
  fake = new FakeFetch();
});
afterEach(() => {
  fake.restore();
});

const xml = (body: string) => text(body, 207, { 'content-type': 'application/xml; charset=utf-8' });

function serve(style: 'prefixed' | 'default-ns'): void {
  fake.on(ROOT, () => xml(fixture(`caldav/${style}-principal.xml`)));
  fake.on(PRINCIPAL, () => xml(fixture(`caldav/${style}-home.xml`)));
  fake.on(HOME, () => xml(fixture(`caldav/${style}-list.xml`)));
  fake.on(`${HOME}home/`, () => xml(fixture('caldav/default-ns-report-home.xml')));
  fake.on(`${HOME}work/`, () => xml(fixture('caldav/prefixed-report-work.xml')));
}

function source(calendars: (string | CalendarChoice)[] = [], onCalendars?: (found: string[], used: string[], notInUse: string[]) => void,
  listed?: CalendarReport['listed']): ICloudSource {
  const config: ICloudSourceConfig = {
    type: 'icloud', id: 'family', name: 'Family', appleId: 'person@example.com', appPassword: PASSWORD,
    calendars: calendars.map((c) => (typeof c === 'string' ? { id: null, name: c, use: 'all' as const } : c)),
  };
  return new ICloudSource(config, ics, { discovered: onCalendars, listed });
}

async function failure(p: Promise<unknown>): Promise<SourceError> {
  try {
    await p;
  } catch (err) {
    assert.ok(err instanceof SourceError);
    return err;
  }
  assert.fail('expected a failure');
}

for (const style of ['prefixed', 'default-ns'] as const) {
  test(`discovery and REPORT with ${style} XML`, async () => {
    serve(style);
    const seen: [string[], string[]][] = [];
    const events = await source([], (found, used) => seen.push([found, used])).fetchEvents(now);
    assert.deepEqual(seen, [[['Home', 'Work & Projects'], ['Home', 'Work & Projects']]], 'Reminders, inbox and notifications are dropped');

    const methods = fake.calls.map((c: Call) => `${c.method} ${c.url} ${c.headers.depth}`);
    assert.deepEqual(methods, [
      `PROPFIND ${ROOT} 0`,
      `PROPFIND ${PRINCIPAL} 0`,
      `PROPFIND ${HOME} 1`,
      `REPORT ${HOME}home/ 1`,
      `REPORT ${HOME}work/ 1`,
    ]);
    const auth = `Basic ${Buffer.from(`person@example.com:${PASSWORD}`).toString('base64')}`;
    assert.ok(fake.calls.every((c) => c.headers.authorization === auth));
    const report = fake.calls[3].body ?? '';
    assert.ok(report.includes(`<c:time-range start="${davStamp(now - 86_400_000)}" end="${davStamp(now + 86_400_000)}"/>`));
    assert.ok(report.includes('<c:comp-filter name="VEVENT">'));

    const at = (h: number, m = 0) => Date.UTC(2026, 9, 8, h, m);
    const summary = events.map((e) => `${e.showAs} ${e.isAllDay ? 'all-day' : new Date(e.start).toISOString()}`).sort();
    assert.deepEqual(summary, [
      'busy 2026-10-08T15:00:00.000Z',
      'busy 2026-10-08T17:00:00.000Z',
      'oof all-day',
      'tentative 2026-10-08T19:00:00.000Z',
    ], 'entity and CDATA calendar data both read; the broken object is skipped');
    assert.equal(events.find((e) => e.start === at(15))?.end, at(15, 30));
    assert.ok(events.every((e) => e.source === 'Family'));
  });
}

test('a name filter keeps the named calendars, without regard to case', async () => {
  serve('default-ns');
  const seen: string[][] = [];
  const events = await source(['work & PROJECTS', 'Missing'], (_found, used) => seen.push(used)).fetchEvents(now);
  assert.deepEqual(seen, [['Work & Projects']]);
  assert.equal(fake.callsTo(`${HOME}home/`).length, 0);
  assert.equal(events.length, 2);
});

test('a 401 is Sign-in needed and never carries the password', async () => {
  fake.on(ROOT, () => text('Unauthorized', 401));
  const err = await failure(source().fetchEvents(now));
  assert.equal(err.state, 'signInNeeded');
  assert.equal(err.options.unauthorized, true);
  assert.equal(err.message, ICLOUD_REJECTED);
  assert.ok(!err.message.includes(PASSWORD) && !err.message.includes('person@example.com'));
});

test('discovery is repeated after a failure', async () => {
  serve('prefixed');
  const src = source();
  await src.fetchEvents(now);
  fake.on(`${HOME}work/`, () => text('busy', 503));
  const err = await failure(src.fetchEvents(now + 180_000));
  assert.equal(err.message, 'p01-caldav.icloud.com answered HTTP 503');
  assert.equal(err.state, 'notReachable');
  fake.on(`${HOME}work/`, () => xml(fixture('caldav/prefixed-report-work.xml')));
  await src.fetchEvents(now + 360_000);
  assert.equal(fake.callsTo(ROOT).filter((c) => c.url === ROOT).length, 2, 'the root was asked again');
});

test('discovery is cached and repeated every 24 hours', async () => {
  serve('prefixed');
  let discoveries = 0;
  const src = source([], () => discoveries++);
  await src.fetchEvents(now);
  await src.fetchEvents(now + 180_000);
  assert.equal(discoveries, 1);
  await src.fetchEvents(now + REDISCOVER_MS);
  assert.equal(discoveries, 2);
});

test('a missing principal is a short failure', async () => {
  fake.on(ROOT, () => xml('<multistatus xmlns="DAV:"><response><href>/</href></response></multistatus>'));
  const err = await failure(source().fetchEvents(now));
  assert.equal(err.message, 'caldav.icloud.com did not return the current-user-principal');
});

test('calendar list parsing resolves relative hrefs against the home', () => {
  const list = parseCalendarList(fixture('caldav/prefixed-list.xml'), HOME);
  assert.deepEqual(list, [
    { name: 'Home', url: `${HOME}home/`, path: '/10000001/calendars/home/', shared: false, subscribed: false, readable: true },
    { name: 'Work & Projects', url: `${HOME}work/`, path: '/10000001/calendars/work/', shared: false, subscribed: false, readable: true },
  ]);
});

test('xml helpers ignore prefixes and decode entities and CDATA', () => {
  const doc = '<multistatus xmlns="DAV:"><response><href>/1/cal/</href><propstat><prop>' +
    '<cal:calendar-data xmlns:cal="urn:x">A &amp; B&#13;&#x41;</cal:calendar-data><displayname/></prop></propstat></response></multistatus>';
  assert.deepEqual(xmlBlocks(xmlBlocks(doc, 'response')[0], 'href'), ['/1/cal/']);
  assert.equal(xmlText(xmlBlocks(doc, 'calendar-data')[0]), 'A & B\rA');
  assert.deepEqual(xmlBlocks(doc, 'displayname'), [], 'self-closing elements have no content');
  assert.equal(xmlText('<![CDATA[x<y & z]]>'), 'x<y & z');
  assert.equal(xmlText(' a &lt; <![CDATA[<b>]]> &gt; '), ' a < <b> > ');
});

test('fixture titles in XML are synthetic', () => {
  assert.ok(fixtureTitles().includes('Synthetic school run & pickup'));
});

test('review: a calendar without a display name is never named by its path', () => {
  const doc = '<multistatus xmlns="DAV:"><response><href>/10000001/calendars/0F1E2D3C-synthetic/</href><propstat><prop>' +
    '<displayname/><resourcetype><collection/><calendar xmlns="urn:ietf:params:xml:ns:caldav"/></resourcetype></prop></propstat></response></multistatus>';
  assert.deepEqual(parseCalendarList(doc, HOME).map((c) => [c.name, c.url]), [['Unnamed calendar', `${HOME}0F1E2D3C-synthetic/`]]);
});

const summary = (events: { showAs: string; isAllDay: boolean; start: number }[]) =>
  events.map((e) => `${e.showAs} ${e.isAllDay ? 'all-day' : new Date(e.start).toISOString().slice(11, 16)}`).sort();

test('calendars listed as entries are matched by id and carry their use (SPEC 5.1 step 4, 6.1)', async () => {
  serve('prefixed');
  const seen: string[][][] = [];
  const events = await source([
    { id: '/10000001/calendars/home/', name: 'Home (renamed since)', use: 'outOfOffice' },
    { id: '/10000001/calendars/work/', name: 'Work & Projects', use: 'all' },
  ], (found, used, notInUse) => seen.push([found, used, notInUse])).fetchEvents(now);
  assert.deepEqual(seen, [[['Home', 'Work & Projects'], ['Home', 'Work & Projects'], []]]);
  assert.deepEqual(summary(events), ['busy 17:00', 'free 15:00', 'oof all-day', 'tentative 19:00'],
    'Home counts for out of office only: its busy event is free and its out of office event stays');
});

test('an id that no longer matches falls back to the name; a calendar is taken once', async () => {
  serve('default-ns');
  const listed: [string, boolean][] = [];
  const events = await source([
    { id: '/10000001/calendars/old-work-id/', name: 'work & projects', use: 'all' },
    { id: null, name: 'Work & Projects', use: 'outOfOffice' },
  ], undefined, (choice, present) => listed.push([choice.name, present])).fetchEvents(now);
  assert.deepEqual(summary(events), ['busy 17:00', 'tentative 19:00']);
  assert.equal(fake.callsTo(`${HOME}home/`).length, 0);
  assert.deepEqual(listed, [['work & projects', true], ['Work & Projects', false]], 'the second entry finds Work already taken');
});

test('calendars found but not listed are reported only when the list is not empty', async () => {
  serve('prefixed');
  const seen: string[][] = [];
  await source([{ id: '/10000001/calendars/work/', name: 'Work & Projects', use: 'all' }], (_f, _u, notInUse) => seen.push(notInUse)).fetchEvents(now);
  await source([], (_f, _u, notInUse) => seen.push(notInUse)).fetchEvents(now);
  assert.deepEqual(seen, [['Home'], []]);
});

test('shared, shared-owner and subscribed collections are flagged; a subscribed calendar is never read', async () => {
  const doc = '<multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:CS="http://calendarserver.org/ns/">' +
    '<response><href>/10000001/calendars/mine/</href><propstat><prop><displayname>Mine</displayname>' +
    '<resourcetype><collection/><C:calendar/><CS:shared-owner/></resourcetype></prop></propstat></response>' +
    '<response><href>/10000001/calendars/theirs/</href><propstat><prop><displayname>Theirs</displayname>' +
    '<resourcetype><collection/><C:calendar/><CS:shared/></resourcetype></prop></propstat></response>' +
    '<response><href>/10000001/calendars/holidays/</href><propstat><prop><displayname>Holidays</displayname>' +
    '<resourcetype><collection/><CS:subscribed/></resourcetype></prop></propstat></response></multistatus>';
  const list = parseCalendarList(doc, HOME);
  assert.deepEqual(list.map((c) => [c.name, c.shared, c.subscribed, c.readable]), [
    ['Mine', false, false, true],
    ['Theirs', true, false, true],
    ['Holidays', false, true, false],
  ]);
  assert.deepEqual(chooseCalendars(list, []).used.map((u) => u.calendar.name), ['Mine', 'Theirs']);
  assert.deepEqual(chooseCalendars(list, [{ id: null, name: 'Holidays', use: 'all' }]).missing.map((c) => c.name), ['Holidays']);
});

test('a name keeps every calendar of that name, as build 1 did; an id is never taken by a name', () => {
  const cal = (path: string, name: string) => ({ url: `https://p01-caldav.icloud.com${path}`, path, name, shared: false, subscribed: false, readable: true });
  const found = [cal('/1/calendars/a/', 'Calendar'), cal('/1/calendars/b/', 'Calendar'), cal('/1/calendars/c/', 'Work')];
  const names = (choices: CalendarChoice[]) => chooseCalendars(found, choices).used.map((u) => `${u.calendar.path} ${u.use}`);
  assert.deepEqual(names([{ id: null, name: 'calendar', use: 'all' }]), ['/1/calendars/a/ all', '/1/calendars/b/ all']);
  assert.deepEqual(names([{ id: null, name: 'Calendar', use: 'all' }, { id: '/1/calendars/b/', name: 'Calendar', use: 'outOfOffice' }]),
    ['/1/calendars/b/ outOfOffice', '/1/calendars/a/ all'], 'the id entry keeps its calendar and its use');
  assert.deepEqual(names([{ id: '/1/calendars/gone/', name: 'Work', use: 'outOfOffice' }]), ['/1/calendars/c/ outOfOffice'],
    'an id that matches nothing falls back to the name');
});

test('paths compare decoded and without regard to a trailing slash', () => {
  assert.ok(samePath('/1/calendars/a%20b/', '/1/calendars/a b'));
  assert.ok(!samePath('/1/calendars/a/', '/1/calendars/b/'));
});

test('the source runner writes "New calendars" once per discovery and "Listed calendar gone" once until found again', async () => {
  serve('prefixed');
  const log = fakeLog();
  const { config } = parseConfig({
    calendars: [{
      type: 'icloud', name: 'Family', appleId: 'person@example.com', appPassword: PASSWORD,
      calendars: [{ id: '/10000001/calendars/work/', name: 'Work & Projects' }, { id: '/10000001/calendars/gone/', name: 'Old family' }],
    }],
  });
  const runner = new SourceRunner({ config: config.calendars[0], storageDir: tmpDir('busy-light-icloud'), ics, log: log.log, now: () => now });
  await runner.runDue(now, 180_000);
  await runner.runDue(now + 180_000, 180_000);
  assert.deepEqual(log.lines('info'), [
    'Family: calendars found: Home, Work & Projects. In use: Work & Projects.',
    'Family: calendars not in use: Home. Tick them in the plugin settings to use them.',
  ], 'discovery is cached, so each line once');
  assert.deepEqual(log.lines('warn'), ['Family: the calendar "Old family" was not found. It may have been deleted or unshared.']);

  await runner.runDue(now + REDISCOVER_MS, 180_000);
  assert.equal(log.lines('info').filter((l) => l.includes('not in use')).length, 2, 'again after the next discovery');
  assert.equal(log.lines('warn').length, 1, 'the missing calendar is not reported again until it is found');
  assert.ok(log.all().every((l) => !l.includes('10000001')), 'no line carries a calendar path');
});
