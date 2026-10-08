/**
 * The settings page's UI server (SPEC 10.3, tests of SPEC 15 item 13): every endpoint with a fake fetch, a fake LIFX
 * network and a temporary storage directory, including every error key, and that no response carries a password,
 * token, calendar address or event title.
 */
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { LifxClient, MSG, parseHeader } from '../src/lifx.js';
import { MicrosoftAuth, TokenStore, tokenFile } from '../src/microsoft.js';
import { ADMIN_HELP_URL } from '../src/messages.js';
import { writeState } from '../src/state.js';
import type { StateFile } from '../src/state.js';
import { BusyLightUiHandlers, PENDING_SIGN_IN_MS, countToday, todayBounds } from '../src/ui/server.js';
import type { UiServerOptions } from '../src/ui/server.js';
import type { AddressDeps } from '../src/addresses.js';
import { signature } from '../src/status-api.js';
import {
  FakeFetch, FakeMdns, FakeNetwork, fakeLog, fixture, fixtureTitles, json, mdnsAnswer, mdnsQueryOf, networkError, redirect, text, tmpDir,
} from './helpers.js';

// Today is the host's local day; the fixture counts below are for UTC.
process.env.TZ = 'UTC';

const T0 = Date.UTC(2026, 9, 8, 15);
const TENANT = '11111111-2222-3333-4444-555555555555';
const CLIENT = '66666666-7777-8888-9999-000000000000';
const PASSWORD = 'abcd-efgh-ijkl-mnop';
const FEED = 'https://calendar.example.com/calendar/ical/private-0123456789abcdef/basic.ics?token=synthetic-query';
const ROOT = 'https://caldav.icloud.com/';
const PRINCIPAL = 'https://caldav.icloud.com/10000001/principal/';
const HOME = 'https://p01-caldav.icloud.com/10000001/calendars/';
const LOGIN = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0`;
const GRAPH = 'https://graph.microsoft.com/v1.0';

let fake: FakeFetch;
let storage: string;
let clock: number;
let net: FakeNetwork;
const responses: unknown[] = [];

beforeEach(() => {
  fake = new FakeFetch();
  storage = tmpDir('busy-light-ui');
  clock = T0;
  net = new FakeNetwork();
});
afterEach(() => {
  fake.restore();
  fs.rmSync(storage, { recursive: true, force: true });
});

function handlers(opts: { configPath?: string } = {}): BusyLightUiHandlers {
  return new BusyLightUiHandlers({
    storagePath: storage, configPath: opts.configPath, now: () => clock, version: '0.1.0-beta.2',
    lifx: new LifxClient({ socket: net.factory, timings: { replyMs: 40, collectMs: 100 }, interfaces: () => ({}) }),
    sleep: async () => undefined,
  });
}

/** Calls a route the way the page does, and keeps every response for the redaction check at the end. */
async function call(h: BusyLightUiHandlers, route: string, payload: unknown = {}): Promise<Record<string, unknown>> {
  const res = await h.routes()[route](payload) as Record<string, unknown>;
  responses.push(res);
  return JSON.parse(JSON.stringify(res)) as Record<string, unknown>;
}

const dir = () => path.join(storage, 'busy-light');
const xml = (body: string) => text(body, 207, { 'content-type': 'application/xml; charset=utf-8' });

test('/version and /status', async () => {
  const h = handlers();
  assert.deepEqual(await call(h, '/version'), { version: '0.1.0-beta.2' });
  assert.deepEqual(await call(h, '/status'), { status: null }, 'before the plugin has run');
  assert.equal(fs.existsSync(dir()), false, 'reading the status creates nothing');
  const state: StateFile = {
    version: 1, updatedAt: new Date(T0).toISOString(), status: 'inMeeting', reason: { source: 'Work', until: new Date(T0 + 1_800_000).toISOString() },
    override: false, signIn: null,
    sources: [{ id: 'work', name: 'Work', type: 'url', state: 'connected', lastChecked: new Date(T0).toISOString(), events: 3, error: null }],
    light: { enabled: true, label: 'Floor', host: '192.168.4.50', found: 'discovered', lastSent: '#FF0000', lastSentAt: null, answered: true },
  };
  fs.mkdirSync(dir(), { recursive: true });
  writeState(dir(), state);
  assert.deepEqual(await call(h, '/status'), state as unknown as Record<string, unknown>, 'the state file as is');
});

test('today and its count: timed and all-day events overlapping the local day, neither free nor cancelled', () => {
  const { from, to } = todayBounds(T0);
  assert.equal(from, Date.UTC(2026, 9, 8));
  assert.equal(to, Date.UTC(2026, 9, 9));
  const e = (showAs: 'free' | 'busy' | 'oof' | 'tentative', start: number, end: number, extra: Partial<{ isCancelled: boolean; isAllDay: boolean }> = {}) =>
    ({ showAs, start, end, isAllDay: false, isCancelled: false, source: 'x', ...extra });
  assert.equal(countToday([
    e('busy', from + 3_600_000, from + 7_200_000),
    e('free', from + 3_600_000, from + 7_200_000),
    e('busy', from + 3_600_000, from + 7_200_000, { isCancelled: true }),
    e('oof', from, to, { isAllDay: true }),
    e('tentative', from - 3_600_000, from + 60_000),
    e('busy', from - 86_400_000, from, { isAllDay: true }),
    e('busy', to, to + 3_600_000),
  ], from, to), 3);
});

function serveICloud(list: string): void {
  fake.on(ROOT, () => xml(fixture('caldav/prefixed-principal.xml')));
  fake.on(PRINCIPAL, () => xml(fixture('caldav/prefixed-home.xml')));
  fake.on(HOME, () => xml(list));
  fake.on(`${HOME}home/`, () => xml(fixture('caldav/default-ns-report-home.xml')));
  fake.on(`${HOME}work/`, () => xml(fixture('caldav/prefixed-report-work.xml')));
}

const SHARED_LIST = '<multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:CS="http://calendarserver.org/ns/">' +
  '<response><href>/10000001/calendars/home/</href><propstat><prop><displayname>Home</displayname>' +
  '<resourcetype><collection/><C:calendar/><CS:shared-owner/></resourcetype></prop></propstat></response>' +
  '<response><href>/10000001/calendars/work/</href><propstat><prop><displayname>Work &amp; Projects</displayname>' +
  '<resourcetype><collection/><C:calendar/><CS:shared/></resourcetype></prop></propstat></response>' +
  '<response><href>/10000001/calendars/holidays/</href><propstat><prop><displayname>Holidays</displayname>' +
  '<resourcetype><collection/><CS:subscribed/></resourcetype></prop></propstat></response></multistatus>';

test('/icloud/calendars lists every calendar with its path, flags and the number of events today (SPEC 10.3 item 1)', async () => {
  serveICloud(SHARED_LIST);
  const h = handlers();
  const res = await call(h, '/icloud/calendars', { appleId: 'person@example.com', appPassword: PASSWORD });
  assert.deepEqual(res, {
    calendars: [
      { id: '/10000001/calendars/home/', name: 'Home', shared: false, subscribed: false, eventsToday: 2 },
      { id: '/10000001/calendars/work/', name: 'Work & Projects', shared: true, subscribed: false, eventsToday: 2 },
      { id: '/10000001/calendars/holidays/', name: 'Holidays', shared: false, subscribed: true, eventsToday: null },
    ],
  });
  const auth = `Basic ${Buffer.from(`person@example.com:${PASSWORD}`).toString('base64')}`;
  assert.ok(fake.calls.every((c) => c.headers.authorization === auth));
  const reports = fake.calls.filter((c) => c.method === 'REPORT');
  assert.equal(reports.length, 2, 'one REPORT per readable calendar');
  assert.ok(reports[0].body!.includes('<c:time-range start="20261008T000000Z" end="20261009T000000Z"/>'), 'for today only');
  assert.equal(fs.existsSync(dir()), false, 'nothing is written');
});

test('/icloud/calendars: a calendar whose count cannot be read is listed with null', async () => {
  serveICloud(fixture('caldav/prefixed-list.xml'));
  fake.on(`${HOME}work/`, () => text('', 500));
  const res = await call(handlers(), '/icloud/calendars', { appleId: 'person@example.com', appPassword: PASSWORD });
  const counts = (res.calendars as { name: string; eventsToday: number | null }[]).map((c) => [c.name, c.eventsToday]);
  assert.deepEqual(counts, [['Home', 2], ['Work & Projects', null]]);
});

test('/icloud/calendars errors: rejected, network and unexpected', async () => {
  const h = handlers();
  const ask = () => call(h, '/icloud/calendars', { appleId: 'person@example.com', appPassword: PASSWORD });
  fake.on(ROOT, () => text('Unauthorized', 401));
  assert.deepEqual(await ask(), { error: 'rejected' });
  fake.on(ROOT, () => networkError('ENOTFOUND'));
  assert.deepEqual(await ask(), { error: 'network' });
  fake.on(ROOT, () => text('', 503));
  assert.deepEqual(await ask(), { error: 'network' });
  fake.on(ROOT, () => xml('<multistatus xmlns="DAV:"><response><href>/</href></response></multistatus>'));
  assert.deepEqual(await ask(), { error: 'unexpected' });
  fake.on(ROOT, () => text('', 400));
  assert.deepEqual(await ask(), { error: 'unexpected' });
  const before = fake.calls.length;
  assert.deepEqual(await call(h, '/icloud/calendars', { appleId: 'person@example.com' }), { error: 'rejected' });
  assert.equal(fake.calls.length, before, 'nothing is sent without both fields');
});

test('/url/test counts today\'s events, and reports insecure, notCalendar, http, network and tooLarge with the host only (SPEC 10.3 item 2)', async () => {
  const h = handlers();
  fake.on('https://calendar.example.com/', () => text(fixture('calendar.ics')));
  const ok = await call(h, '/url/test', { url: FEED.replace('https://', 'webcal://'), email: 'person@example.com' });
  assert.equal(typeof ok.eventsToday, 'number');
  assert.equal(fake.calls[0].url, FEED, 'webcal:// is read as https://');

  assert.deepEqual(await call(h, '/url/test', { url: 'http://calendar.example.com/calendar/ical/private-0123456789abcdef/basic.ics' }),
    { error: 'insecure', host: 'calendar.example.com' });
  assert.deepEqual(await call(h, '/url/test', { url: 'not an address' }), { error: 'insecure', host: '' });
  fake.on('https://calendar.example.com/', () => redirect('http://calendar.example.com/plain.ics'));
  assert.deepEqual(await call(h, '/url/test', { url: FEED }), { error: 'insecure', host: 'calendar.example.com' });
  fake.on('https://calendar.example.com/', () => text('<html>Synthetic page</html>'));
  assert.deepEqual(await call(h, '/url/test', { url: FEED }), { error: 'notCalendar', host: 'calendar.example.com' });
  fake.on('https://calendar.example.com/', () => text('gone', 404));
  assert.deepEqual(await call(h, '/url/test', { url: FEED }), { error: 'http', host: 'calendar.example.com', code: 404 });
  fake.on('https://calendar.example.com/', () => networkError('ECONNREFUSED'));
  assert.deepEqual(await call(h, '/url/test', { url: FEED }), { error: 'network', host: 'calendar.example.com' });
  fake.on('https://calendar.example.com/', () => text('BEGIN:VCALENDAR', 200, { 'content-length': String(11 * 1024 * 1024) }));
  assert.deepEqual(await call(h, '/url/test', { url: FEED }), { error: 'tooLarge', host: 'calendar.example.com' });
});

test('/url/test: the declined-invitation rule uses the email given, so a declined meeting does not count', async () => {
  const declined = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:a', 'SUMMARY:Synthetic declined', 'DTSTART:20261008T160000Z',
    'DTEND:20261008T170000Z', 'ATTENDEE;PARTSTAT=DECLINED:mailto:person@example.com', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  fake.on('https://calendar.example.com/', () => text(declined));
  const h = handlers();
  assert.deepEqual(await call(h, '/url/test', { url: FEED }), { eventsToday: 1 });
  assert.deepEqual(await call(h, '/url/test', { url: FEED, email: 'person@example.com' }), { eventsToday: 0 });
});

const START = { id: 'cal-mgx3k8e4f6g', tenantId: TENANT, clientId: CLIENT, useTeamsStatus: true, useCalendar: true };

function deviceCode(): Response {
  return json({
    device_code: 'synthetic-device-code-never-shown', user_code: 'SYNTH123', verification_uri: 'https://microsoft.com/devicelogin',
    expires_in: 900, interval: 5, message: 'synthetic',
  });
}

test('/microsoft/start to done writes the same token file the plugin reads (SPEC 10.3 item 3)', async () => {
  const h = handlers();
  fake.on(`${LOGIN}/devicecode`, (c) => {
    const form = new URLSearchParams(c.body ?? '');
    assert.equal(form.get('client_id'), CLIENT);
    assert.equal(form.get('scope'), 'offline_access Presence.Read Calendars.Read');
    return deviceCode();
  });
  const answers = [json({ error: 'authorization_pending' }, 400), json({ error: 'slow_down' }, 400),
    json({ token_type: 'Bearer', access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', expires_in: 3600 })];
  fake.on(`${LOGIN}/token`, (c, i) => {
    const form = new URLSearchParams(c.body ?? '');
    assert.equal(form.get('grant_type'), 'urn:ietf:params:oauth:grant-type:device_code');
    assert.equal(form.get('device_code'), 'synthetic-device-code-never-shown');
    return answers[i];
  });
  assert.deepEqual(await call(h, '/microsoft/start', START), {
    verificationUri: 'https://microsoft.com/devicelogin', userCode: 'SYNTH123', expiresAt: new Date(T0 + 900_000).toISOString(),
  });
  assert.deepEqual(await call(h, '/microsoft/poll', { id: START.id }), { state: 'waiting' });
  assert.equal(fake.callsTo(`${LOGIN}/token`).length, 0, 'not before the interval Microsoft gave');
  clock += 5000;
  assert.deepEqual(await call(h, '/microsoft/poll', { id: START.id }), { state: 'waiting' }, 'authorization_pending');
  clock += 5000;
  assert.deepEqual(await call(h, '/microsoft/poll', { id: START.id }), { state: 'waiting' }, 'slow_down');
  clock += 5000;
  assert.deepEqual(await call(h, '/microsoft/poll', { id: START.id }), { state: 'waiting' }, 'slow_down added 5 seconds');
  assert.equal(fake.callsTo(`${LOGIN}/token`).length, 2);
  clock += 5000;
  assert.deepEqual(await call(h, '/microsoft/poll', { id: START.id }), { state: 'done' });
  assert.equal(h.hasPending(START.id), false);

  const file = tokenFile(dir(), START.id);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(fs.statSync(dir()).mode & 0o777, 0o700);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), {
    refreshToken: 'synthetic-refresh', accessToken: 'synthetic-access', expiresAt: new Date(clock + 3_600_000).toISOString(),
  });
  const log = fakeLog();
  const plugin = new MicrosoftAuth({
    source: { type: 'microsoft', name: 'Work', ...START, calendars: [] }, store: new TokenStore(file), log: log.log, now: () => clock,
  });
  assert.equal(plugin.hasToken(), true);
  assert.equal(await plugin.getAccessToken(), 'synthetic-access', 'the plugin reads it as its own');
  assert.deepEqual(await call(h, '/microsoft/poll', { id: START.id }), { state: 'expired' }, 'nothing is pending any more');
});

test('/microsoft/poll: a sign-in that cannot be saved answers expired, never a thrown error', async () => {
  const h = handlers();
  fake.on(`${LOGIN}/devicecode`, () => deviceCode());
  fake.on(`${LOGIN}/token`, () => json({ token_type: 'Bearer', access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', expires_in: 3600 }));
  await call(h, '/microsoft/start', START);
  fs.writeFileSync(dir(), 'not a folder');
  clock += 5000;
  assert.deepEqual(await call(h, '/microsoft/poll', { id: START.id }), { state: 'expired' });
  assert.equal(h.hasPending(START.id), false);
});

test('/microsoft/start: network, refused, and the scope follows the two checkboxes', async () => {
  const h = handlers();
  fake.on(`${LOGIN}/devicecode`, () => networkError('ENOTFOUND'));
  assert.deepEqual(await call(h, '/microsoft/start', START), { error: 'network' });
  fake.on(`${LOGIN}/devicecode`, () => text('busy', 503));
  assert.deepEqual(await call(h, '/microsoft/start', START), { error: 'network' });
  fake.on(`${LOGIN}/devicecode`, () => json({ error: 'invalid_client', error_description: 'AADSTS7000218: Synthetic.' }, 400));
  assert.deepEqual(await call(h, '/microsoft/start', START), {
    error: 'refused', reason: 'the app registration does not allow public client flows', help: ADMIN_HELP_URL,
  });
  assert.deepEqual(await call(h, '/microsoft/start', { ...START, tenantId: 'contoso' }), {
    error: 'refused', reason: 'the Directory (tenant) ID or Application (client) ID was not recognised', help: ADMIN_HELP_URL,
  });
  assert.deepEqual(await call(h, '/microsoft/start', { ...START, id: '../../etc' }), { error: 'network' }, 'the id names a file');
  fake.on(`${LOGIN}/devicecode`, (c) => {
    assert.equal(new URLSearchParams(c.body ?? '').get('scope'), 'offline_access Calendars.Read');
    return deviceCode();
  });
  await call(h, '/microsoft/start', { ...START, useTeamsStatus: false });
});

test('/microsoft/poll: expired_token, a refusal, cancel and the 15 minute limit', async () => {
  const h = handlers();
  fake.on(`${LOGIN}/devicecode`, () => deviceCode());
  fake.on(`${LOGIN}/token`, () => json({ error: 'expired_token' }, 400));
  await call(h, '/microsoft/start', START);
  clock += 5000;
  assert.deepEqual(await call(h, '/microsoft/poll', { id: START.id }), { state: 'expired' });

  await call(h, '/microsoft/start', START);
  fake.on(`${LOGIN}/token`, () => json({ error: 'invalid_grant', error_codes: [65001] }, 400));
  clock += 5000;
  assert.deepEqual(await call(h, '/microsoft/poll', { id: START.id }), {
    state: 'refused', reason: 'your organization has not approved the permissions', help: ADMIN_HELP_URL,
  });
  assert.equal(h.hasPending(START.id), false);

  await call(h, '/microsoft/start', START);
  assert.deepEqual(await call(h, '/microsoft/cancel', { id: START.id }), { ok: true });
  assert.equal(h.hasPending(START.id), false);
  clock += 5000;
  assert.deepEqual(await call(h, '/microsoft/poll', { id: START.id }), { state: 'expired' });

  fake.on(`${LOGIN}/devicecode`, () => json({
    device_code: 'd', user_code: 'U', verification_uri: 'https://microsoft.com/devicelogin', expires_in: 3600, interval: 5,
  }));
  fake.on(`${LOGIN}/token`, () => json({ error: 'authorization_pending' }, 400));
  await call(h, '/microsoft/start', START);
  clock += PENDING_SIGN_IN_MS - 1000;
  assert.deepEqual(await call(h, '/microsoft/poll', { id: START.id }), { state: 'waiting' });
  clock += 1000;
  assert.deepEqual(await call(h, '/microsoft/poll', { id: START.id }), { state: 'expired' }, 'after 15 minutes, whatever the code\'s own lifetime');
  fake.on(`${LOGIN}/token`, () => networkError('ECONNRESET'));
  await call(h, '/microsoft/start', START);
  clock += 5000;
  assert.deepEqual(await call(h, '/microsoft/poll', { id: START.id }), { state: 'waiting' }, 'a network failure is tried again');
});

function writeToken(id: string, accessValidFor = 3_600_000): void {
  fs.mkdirSync(dir(), { recursive: true });
  new TokenStore(tokenFile(dir(), id)).write({
    refreshToken: 'synthetic-refresh', accessToken: 'synthetic-access', expiresAt: new Date(clock + accessValidFor).toISOString(),
  });
}

const CALS = { id: START.id, tenantId: TENANT, clientId: CLIENT };

test('/microsoft/calendars lists the Outlook calendars with default, shared and today\'s count (SPEC 10.3 item 4)', async () => {
  writeToken(START.id);
  fake.on(`${GRAPH}/me/calendars`, (c, i) => {
    assert.equal(c.headers.authorization, 'Bearer synthetic-access');
    if (i === 0) {
      assert.equal(new URL(c.url).searchParams.get('$select'), 'id,name,isDefaultCalendar,owner');
      return json({
        'value': [
          { id: 'AAMkSyntheticDefault=', name: 'Calendar', isDefaultCalendar: true, owner: { name: 'Synthetic', address: 'Person@Example.com' } },
          { id: 'AAMkSyntheticHolidays=', name: 'Holidays', isDefaultCalendar: false, owner: { address: 'person@example.com' } },
        ],
        '@odata.nextLink': `${GRAPH}/me/calendars?$skiptoken=synthetic`,
      });
    }
    return json({ value: [{ id: 'AAMkSyntheticShared=', name: 'Team', isDefaultCalendar: false, owner: { address: 'colleague@example.com' } }] });
  });
  const view = (value: unknown[]) => () => json({ value });
  const ev = (showAs: string, h: number) => ({ showAs, isAllDay: false, isCancelled: false,
    start: { dateTime: `2026-10-08T${h}:00:00.0000000` }, end: { dateTime: `2026-10-08T${h}:30:00.0000000` } });
  fake.on(`${GRAPH}/me/calendars/AAMkSyntheticDefault%3D/calendarView`, (c) => {
    const url = new URL(c.url);
    assert.equal(url.searchParams.get('$select'), 'showAs,start,end,isAllDay,isCancelled');
    assert.equal(url.searchParams.get('startDateTime'), '2026-10-08T00:00:00.000Z');
    assert.equal(url.searchParams.get('endDateTime'), '2026-10-09T00:00:00.000Z');
    return json({ value: [ev('busy', 10), ev('free', 11), ev('tentative', 12)] });
  });
  fake.on(`${GRAPH}/me/calendars/AAMkSyntheticHolidays%3D/calendarView`, view([]));
  fake.on(`${GRAPH}/me/calendars/AAMkSyntheticShared%3D/calendarView`, () => text('', 500));
  assert.deepEqual(await call(handlers(), '/microsoft/calendars', CALS), {
    calendars: [
      { id: 'AAMkSyntheticDefault=', name: 'Calendar', isDefault: true, shared: false, eventsToday: 2 },
      { id: 'AAMkSyntheticHolidays=', name: 'Holidays', isDefault: false, shared: false, eventsToday: 0 },
      { id: 'AAMkSyntheticShared=', name: 'Team', isDefault: false, shared: true, eventsToday: null },
    ],
  });
});

test('/microsoft/calendars refreshes in memory only, so the plugin keeps its token with every scope', async () => {
  writeToken(START.id, 0);
  const before = fs.readFileSync(tokenFile(dir(), START.id), 'utf8');
  fake.on(`${LOGIN}/token`, (c) => {
    assert.equal(new URLSearchParams(c.body ?? '').get('scope'), 'offline_access Calendars.Read');
    return json({ access_token: 'synthetic-access-narrow', refresh_token: 'synthetic-refresh-2', expires_in: 3600 });
  });
  fake.on(`${GRAPH}/me/calendars`, (c) => {
    assert.equal(c.headers.authorization, 'Bearer synthetic-access-narrow');
    return json({ value: [] });
  });
  assert.deepEqual(await call(handlers(), '/microsoft/calendars', CALS), { calendars: [] });
  assert.equal(fs.readFileSync(tokenFile(dir(), START.id), 'utf8'), before, 'the token file is unchanged');
});

test('/microsoft/calendars errors: notSignedIn, refused and network; /microsoft/disconnect deletes the token file', async () => {
  const h = handlers();
  assert.deepEqual(await call(h, '/microsoft/calendars', CALS), { error: 'notSignedIn' }, 'no token file');
  writeToken(START.id);
  fake.on(`${GRAPH}/me/calendars`, () => text('', 403));
  assert.deepEqual(await call(h, '/microsoft/calendars', CALS), {
    error: 'refused', reason: 'your organization has not approved the permissions', help: ADMIN_HELP_URL,
  });
  fake.on(`${GRAPH}/me/calendars`, () => networkError('ETIMEDOUT'));
  assert.deepEqual(await call(h, '/microsoft/calendars', CALS), { error: 'network' });
  writeToken(START.id, 0);
  fake.on(`${LOGIN}/token`, () => json({ error: 'invalid_grant' }, 400));
  assert.deepEqual(await call(h, '/microsoft/calendars', CALS), { error: 'notSignedIn' }, 'a refresh token Microsoft no longer accepts');
  assert.equal(fs.existsSync(tokenFile(dir(), START.id)), true, 'the plugin\'s token file is left for the plugin');
  writeToken(START.id);
  fake.on(`${GRAPH}/me/calendars`, () => text('', 401));
  fake.on(`${LOGIN}/token`, () => json({ access_token: 'synthetic-access-2', expires_in: 3600 }));
  assert.deepEqual(await call(h, '/microsoft/calendars', CALS), { error: 'notSignedIn' }, 'Graph refused the sign-in twice');

  assert.deepEqual(await call(h, '/microsoft/disconnect', { id: START.id }), { ok: true });
  assert.equal(fs.existsSync(tokenFile(dir(), START.id)), false);
  assert.deepEqual(await call(h, '/microsoft/disconnect', { id: START.id }), { ok: true }, 'nothing to delete is fine');
  assert.deepEqual(await call(h, '/microsoft/disconnect', { id: '../state' }), { ok: true });
});

const FLOOR = { serial: 'd073d5000001', label: 'Floor', host: '192.168.4.50', answers: true };
const DESK = { serial: 'd073d5000002', label: 'Desk', host: '192.168.4.51', answers: true };

test('/lifx/discover lists the bulbs found and changes nothing (SPEC 10.3 item 5)', async () => {
  const h = handlers();
  assert.deepEqual(await call(h, '/lifx/discover'), { bulbs: [] });
  net.bulbs = [FLOOR, DESK];
  assert.deepEqual(await call(h, '/lifx/discover'), {
    bulbs: [{ label: 'Desk', serial: 'd073d5000002', ip: '192.168.4.51' }, { label: 'Floor', serial: 'd073d5000001', ip: '192.168.4.50' }],
  });
  assert.equal(fs.existsSync(dir()), false, 'light.json is never written');
});

/** The colors sent to a host, as hue (0 to 65535) per SetColor, in order. */
function hues(host: string): number[] {
  return net.sent.filter((s) => s.to === host && parseHeader(s.buf)!.type === MSG.SetColor).map((s) => s.buf.readUInt16LE(37));
}

test('/lifx/test sends red, green and the saved Available color, by serial untagged or by host tagged', async () => {
  net.bulbs = [FLOOR];
  const configPath = path.join(storage, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({ platforms: [{ platform: 'BusyLight', colors: { available: '#0000ff' } }] }));
  const h = handlers({ configPath });
  assert.deepEqual(await call(h, '/lifx/test', { serial: 'D0:73:D5:00:00:01', host: FLOOR.host, brightness: 50 }), { answered: true });
  assert.deepEqual(hues(FLOOR.host), [0, 21845, 43690], 'red, green, then the saved Available color (blue)');
  const packets = net.sent.filter((s) => s.to === FLOOR.host).map((s) => parseHeader(s.buf)!);
  assert.ok(packets.every((p) => !p.tagged && p.serial === FLOOR.serial), 'untagged to the serial');
  const brightness = net.sent.find((s) => parseHeader(s.buf)!.type === MSG.SetColor)!.buf.readUInt16LE(41);
  assert.equal(brightness, Math.round(65535 / 2), 'at the brightness given');

  net.sent = [];
  assert.deepEqual(await call(handlers(), '/lifx/test', { host: FLOOR.host, brightness: 100 }), { answered: true });
  assert.ok(net.sent.every((s) => parseHeader(s.buf)!.tagged), 'an IP address alone sends tagged');
  assert.deepEqual(hues(FLOOR.host), [0, 21845, 21845], 'the default Available color is green');

  net.sent = [];
  assert.deepEqual(await call(h, '/lifx/test', { serial: FLOOR.serial, brightness: 100 }), { answered: true }, 'a serial alone is found first');
  assert.ok(net.typesTo('255.255.255.255').includes(MSG.GetService));

  FLOOR.answers = false;
  try {
    assert.deepEqual(await call(h, '/lifx/test', { host: FLOOR.host, brightness: 100 }), { answered: false });
  } finally {
    FLOOR.answers = true;
  }
  assert.deepEqual(await call(h, '/lifx/test', { serial: 'd073d5ffffff', brightness: 100 }), { answered: false }, 'not on the network');
  assert.equal(fs.existsSync(path.join(dir(), 'light.json')), false, 'light.json is never written');
});

test('/lifx/test with no bulb chosen on the page uses the bulb the plugin would: the saved lifx.bulb, or the only one', async () => {
  // A build 1 configuration: lifx.bulb and lifx.host empty, and the bulb found by discovery.
  const configPath = path.join(storage, 'config.json');
  const save = (lifx: Record<string, unknown>) => fs.writeFileSync(configPath, JSON.stringify({ platforms: [{ platform: 'BusyLight', lifx }] }));
  save({ enabled: true, bulb: '', host: '' });
  const h = handlers({ configPath });
  net.bulbs = [FLOOR];
  assert.deepEqual(await call(h, '/lifx/test', { brightness: 100 }), { answered: true }, 'the only bulb');
  assert.ok(net.sent.filter((s) => s.to === FLOOR.host).every((s) => !parseHeader(s.buf)!.tagged && parseHeader(s.buf)!.serial === FLOOR.serial));
  assert.deepEqual(hues(FLOOR.host), [0, 21845, 21845]);

  net.bulbs = [FLOOR, DESK];
  net.sent = [];
  assert.deepEqual(await call(h, '/lifx/test', { brightness: 100 }), { answered: false }, 'several bulbs and none named');
  assert.deepEqual(hues(FLOOR.host), []);
  save({ enabled: true, bulb: 'floor', host: '' });
  assert.deepEqual(await call(h, '/lifx/test', { brightness: 100 }), { answered: true }, 'a build 1 bulb name');
  assert.deepEqual(hues(FLOOR.host), [0, 21845, 21845]);
  assert.deepEqual(hues(DESK.host), []);
  net.bulbs = [];
  assert.deepEqual(await call(handlers(), '/lifx/test', { brightness: 100 }), { answered: false }, 'no bulb on the network');
});

test('/reset deletes every file in busy-light/ and leaves only the marker (SPEC 10.3 item 6)', async () => {
  writeToken('work');
  fs.writeFileSync(path.join(dir(), 'state.json'), '{}');
  fs.writeFileSync(path.join(dir(), 'light.json'), '{}');
  const h = handlers();
  fake.on(`${LOGIN}/devicecode`, () => deviceCode());
  await call(h, '/microsoft/start', START);
  assert.deepEqual(await call(h, '/reset'), { ok: true });
  assert.deepEqual(fs.readdirSync(dir()), ['reset-pending']);
  assert.equal(fs.readFileSync(path.join(dir(), 'reset-pending'), 'utf8'), `${new Date(T0).toISOString()}\n`);
  assert.equal(h.hasPending(START.id), false, 'a pending sign-in is dropped too');
  fs.rmSync(dir(), { recursive: true });
  assert.deepEqual(await call(h, '/reset'), { ok: true }, 'with nothing there yet');
  assert.deepEqual(fs.readdirSync(dir()), ['reset-pending']);
  fs.rmSync(dir(), { recursive: true });
  fs.writeFileSync(dir(), 'not a folder');
  assert.deepEqual(await call(h, '/reset'), { ok: false }, 'a folder that cannot be written, never a thrown error');
});

test('the routes are the endpoints of SPEC 10.3', () => {
  assert.deepEqual(Object.keys(handlers().routes()), [
    '/version', '/status', '/icloud/calendars', '/url/test', '/microsoft/start', '/microsoft/poll', '/microsoft/cancel', '/microsoft/calendars',
    '/microsoft/disconnect', '/lifx/discover', '/lifx/test', '/reset', '/input/info', '/input/test',
  ]);
});

// SPEC 15 item 20: /input/info and /input/test, with os.networkInterfaces, dns.lookup and fetch replaced.

const INPUT_KEY = 'uiServerTestKey-0123456789abcdefghijklmnop';
const silentMdns = new FakeMdns();
const NETWORK: AddressDeps = {
  hostname: () => 'homebridge',
  interfaces: () => ({
    eth0: [{ address: '192.168.4.10', family: 'IPv4', internal: false, netmask: '255.255.255.0', mac: '', cidr: null }],
  }),
  createSocket: silentMdns.factory,
  mdnsWaitMs: 10,
  lookup: async () => [{ address: '192.168.4.10', family: 4 }],
};

function inputHandlers(extra: Partial<UiServerOptions> = {}): BusyLightUiHandlers {
  return new BusyLightUiHandlers({ storagePath: storage, now: () => clock, version: '0.1.0-beta.3', addresses: NETWORK, ...extra });
}

test('/input/info: the host name when it resolves to the host, the IPv4 addresses, the saved port, and the id, created once', async () => {
  const configPath = path.join(storage, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({ platforms: [{ platform: 'BusyLight', statusInput: { enabled: true, port: 9000, key: INPUT_KEY } }] }));
  const info = await call(inputHandlers({ configPath }), '/input/info') as { id: string };
  assert.match(info.id, /^[A-Za-z0-9_-]{16}$/);
  assert.deepEqual(info, { hostname: 'homebridge.local', addresses: ['192.168.4.10'], port: 9000, id: info.id, addressChange: null });
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir(), 'instance.json'), 'utf8')).id, info.id, 'created in instance.json');
  assert.equal((await call(inputHandlers(), '/input/info') as { id: string }).id, info.id, 'and kept');
  const elsewhere = await call(inputHandlers({ addresses: { ...NETWORK, lookup: async () => [{ address: '192.168.4.99', family: 4 }] } }), '/input/info');
  assert.equal(elsewhere.hostname, null, 'a name that resolves elsewhere');
  assert.equal(elsewhere.port, 8582, 'the default port with nothing saved');
  const slow = await call(inputHandlers({ addresses: { ...NETWORK, lookup: () => new Promise(() => undefined), timeoutMs: 20 } }), '/input/info');
  assert.equal(slow.hostname, null, 'a name that times out');
  assert.ok(!JSON.stringify(responses).includes(INPUT_KEY), 'no key is read into an answer');
});

test('/input/info on the Pi: multicast DNS confirms the name that /etc/hosts sends to 127.0.0.1, and the check is kept for 10 minutes', async () => {
  const mdns = new FakeMdns();
  mdns.answer = (query) => {
    const { id, name } = mdnsQueryOf(query);
    return [mdnsAnswer(id, name, [{ name, address: '192.168.4.10' }])];
  };
  const handlers = inputHandlers({ addresses: { ...NETWORK, createSocket: mdns.factory, lookup: async () => [{ address: '127.0.0.1', family: 4 }] } });
  assert.equal((await call(handlers, '/input/info')).hostname, 'homebridge.local');
  mdns.answer = () => [];
  clock += 9 * 60_000;
  assert.equal((await call(handlers, '/input/info')).hostname, 'homebridge.local', 'kept');
  assert.equal(mdns.sent.length, 1, 'one query in 10 minutes');
  clock += 60_000;
  assert.equal((await call(handlers, '/input/info')).hostname, null, 'asked again after 10 minutes');
  assert.equal(mdns.sent.length, 2);
});

test('/input/info: the address change of the state file, until config.json is saved after it (SPEC 18.11 item 6)', async () => {
  const configPath = path.join(storage, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({ platforms: [{ platform: 'BusyLight', statusInput: { enabled: true, key: INPUT_KEY } }] }));
  const at = Date.now() + 60_000;
  fs.utimesSync(configPath, new Date(at - 120_000), new Date(at - 120_000));
  fs.mkdirSync(dir(), { recursive: true });
  fs.writeFileSync(path.join(dir(), 'state.json'), JSON.stringify({
    version: 1, updatedAt: new Date(at).toISOString(), status: 'available', reason: null, override: false, sources: [], signIn: null, light: null,
    statusInput: { enabled: true, port: 8582, listening: true, error: null, id: null, advertised: '192.168.4.23',
      addressChange: { from: '192.168.4.10', to: '192.168.4.23', at: new Date(at).toISOString() } },
  }));
  const before = await call(inputHandlers({ configPath }), '/input/info');
  assert.deepEqual(before.addressChange, { from: '192.168.4.10', to: '192.168.4.23' }, 'config.json is older than the change');
  fs.utimesSync(configPath, new Date(at + 60_000), new Date(at + 60_000));
  assert.equal((await call(inputHandlers({ configPath }), '/input/info')).addressChange, null, 'saved since');
  fs.rmSync(path.join(dir(), 'state.json'));
  assert.equal((await call(inputHandlers({ configPath }), '/input/info')).addressChange, null, 'no state file');
});

test('/input/test: a signed In a call for 30 seconds from Busy Light test to 127.0.0.1, and each result', async () => {
  fake.on('http://127.0.0.1:9000/v1/status', (c) => {
    assert.deepEqual(JSON.parse(c.body!), { sender: 'Busy Light test', status: 'inCall', ttlSeconds: 30 });
    assert.equal(c.headers.authorization, `BusyLight-HMAC-SHA256 ts=${clock}, sig=${signature(INPUT_KEY, 'POST', '/v1/status', String(clock), c.body!)}`);
    return json({ accepted: true, expiresAt: new Date(clock + 30_000).toISOString(), status: 'inCall' });
  });
  const h = inputHandlers();
  assert.deepEqual(await call(h, '/input/test', { port: 9000, key: INPUT_KEY }), { ok: true });
  fake.on('http://127.0.0.1:9000/v1/status', () => json({ error: 'unauthorized', message: 'Missing or wrong key.' }, 401));
  assert.deepEqual(await call(h, '/input/test', { port: 9000, key: INPUT_KEY }), { error: 'unauthorized', message: 'Missing or wrong key.' });
  fake.on('http://127.0.0.1:9000/v1/status', () => networkError('ECONNREFUSED'));
  assert.deepEqual(await call(h, '/input/test', { port: 9000, key: INPUT_KEY }), { error: 'notListening', message: 'Nothing is listening on port 9000.' });
  fake.on('http://127.0.0.1:9000/v1/status', () => json({ error: 'rate_limited', message: 'Too many.' }, 429));
  assert.deepEqual(await call(h, '/input/test', { port: 9000, key: INPUT_KEY }), { error: 'other', message: 'Too many.' });
  for (const payload of [{ port: 80, key: INPUT_KEY }, { port: 9000, key: 'short' }, { port: '9000', key: INPUT_KEY }, {}]) {
    assert.deepEqual(await call(h, '/input/test', payload), { error: 'other', message: 'The port or the key is not valid.' });
  }
  assert.ok(!JSON.stringify(responses).includes(INPUT_KEY), 'the key is never returned');
});

test('no response carries a password, token, device code, calendar address or event title', () => {
  assert.ok(responses.length > 40);
  const all = JSON.stringify(responses);
  for (const secret of [PASSWORD, 'synthetic-access', 'synthetic-refresh', 'synthetic-device-code', 'private-0123456789abcdef', 'synthetic-query',
    '/calendar/ical/', ...fixtureTitles()]) {
    assert.ok(!all.includes(secret), secret);
  }
});
