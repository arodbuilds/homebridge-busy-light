import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { MicrosoftSourceConfig } from '../src/config.js';
import { SourceError } from '../src/errors.js';
import { SourceRunner } from '../src/sources.js';
import { GraphClient, MAX_PAGES, mapShowAs, parseGraphEvent } from '../src/graph.js';
import { ADMIN_HELP_URL } from '../src/messages.js';
import { MicrosoftAuth, TokenStore, aadstsCodes, refusalReason, scopeFor, tokenFile } from '../src/microsoft.js';
import { FakeFetch, fakeLog, json, networkError, text, tmpDir } from './helpers.js';
import type { Call } from './helpers.js';

const TENANT = '11111111-2222-3333-4444-555555555555';
const CLIENT = '66666666-7777-8888-9999-000000000000';
const BASE = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0`;
const DEVICE = `${BASE}/devicecode`;
const TOKEN = `${BASE}/token`;
const GRAPH = 'https://graph.microsoft.com/v1.0';
const T0 = Date.UTC(2026, 9, 8, 15);
const DEVICE_CODE = 'synthetic-device-code-never-logged';

const source: MicrosoftSourceConfig = {
  type: 'microsoft', id: 'work', name: 'Work', tenantId: TENANT, clientId: CLIENT, useTeamsStatus: true, useCalendar: true, calendars: [],
};

let fake: FakeFetch;
let dir: string;
let clock: number;
beforeEach(() => {
  fake = new FakeFetch();
  dir = tmpDir('busy-light-ms');
  clock = T0;
});
afterEach(() => {
  fake.restore();
  fs.rmSync(dir, { recursive: true, force: true });
});

const now = () => clock;
const sleep = async (ms: number) => {
  clock += ms;
};

type FakeLog = ReturnType<typeof fakeLog>;

function auth(opts: { log?: FakeLog; onChange?: () => void } = {}): { auth: MicrosoftAuth; log: FakeLog; store: TokenStore } {
  const log = opts.log ?? fakeLog();
  const store = new TokenStore(tokenFile(dir, source.id));
  return { auth: new MicrosoftAuth({ source, store, log: log.log, now, sleep, onChange: opts.onChange }), log, store };
}

function deviceCodeAnswer(index: number, extra: Record<string, unknown> = {}): Response {
  return json({
    device_code: `${DEVICE_CODE}-${index}`, user_code: `CODE${index}`, verification_uri: 'https://microsoft.com/devicelogin',
    expires_in: 900, interval: 5, message: 'synthetic', ...extra,
  });
}

function tokenAnswer(n: number, extra: Record<string, unknown> = {}): Response {
  return json({ token_type: 'Bearer', access_token: `access-${n}`, refresh_token: `refresh-${n}`, expires_in: 3600, ...extra });
}

function form(call: Call): URLSearchParams {
  return new URLSearchParams(call.body ?? '');
}

function writeToken(store: TokenStore, accessValidFor: number, n = 0): void {
  store.write({ refreshToken: `refresh-${n}`, accessToken: `access-${n}`, expiresAt: new Date(clock + accessValidFor).toISOString() });
}

function assertNoSecrets(lines: string[]): void {
  for (const line of lines) {
    assert.ok(!/access-\d|refresh-\d|synthetic-device-code/.test(line), line);
  }
}

test('scope follows the source settings', () => {
  assert.equal(scopeFor({ useTeamsStatus: true, useCalendar: true }), 'offline_access Presence.Read Calendars.Read');
  assert.equal(scopeFor({ useTeamsStatus: false, useCalendar: true }), 'offline_access Calendars.Read');
  assert.equal(scopeFor({ useTeamsStatus: true, useCalendar: false }), 'offline_access Presence.Read');
});

test('device code flow: success after authorization_pending, then slow_down', async () => {
  fake.on(DEVICE, (call, i) => {
    assert.deepEqual(Object.fromEntries(form(call)), { client_id: CLIENT, scope: 'offline_access Presence.Read Calendars.Read' });
    return deviceCodeAnswer(i);
  });
  const pollTimes: number[] = [];
  fake.on(TOKEN, (call, i) => {
    pollTimes.push(clock - T0);
    assert.deepEqual(Object.fromEntries(form(call)), {
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code', client_id: CLIENT, device_code: `${DEVICE_CODE}-0`,
    });
    if (i === 0) {
      return json({ error: 'authorization_pending', error_description: 'AADSTS70016: pending' }, 400);
    }
    if (i === 1) {
      return json({ error: 'slow_down' }, 400);
    }
    return tokenAnswer(1);
  });
  let changes = 0;
  const { auth: a, log, store } = auth({ onChange: () => changes++ });
  assert.equal(a.hasToken(), false);
  const result = await a.signIn({ retryStart: false });
  assert.equal(result, 'signedIn');
  assert.deepEqual(pollTimes, [5000, 10000, 20000], 'slow_down adds 5 seconds to the interval');
  assert.deepEqual(log.lines('warn'), ['Work: Microsoft sign-in needed. Open https://microsoft.com/devicelogin and enter the code CODE0.']);
  assert.deepEqual(log.lines('info'), ['Work: signed in to Microsoft 365.']);
  assert.equal(a.code, null);
  assert.ok(changes >= 2);
  const saved = JSON.parse(fs.readFileSync(store.file, 'utf8'));
  assert.deepEqual(Object.keys(saved).sort(), ['accessToken', 'expiresAt', 'refreshToken'], 'the file holds the tokens and expiry and nothing else');
  assert.equal(saved.refreshToken, 'refresh-1');
  assert.equal(fs.statSync(store.file).mode & 0o777, 0o600);
  assert.equal(await a.getAccessToken(), 'access-1');
  assertNoSecrets(log.all());
});

test('device code flow: the code is shown while it waits', async () => {
  const { auth: a } = auth();
  fake.on(DEVICE, (_c, i) => deviceCodeAnswer(i, { expires_in: 600 }));
  let seen: unknown = null;
  fake.on(TOKEN, () => {
    seen = a.code;
    return tokenAnswer(1);
  });
  await a.signIn({ retryStart: false });
  assert.deepEqual(seen, { verificationUri: 'https://microsoft.com/devicelogin', userCode: 'CODE0', expiresAt: T0 + 600_000 });
});

test('device code flow: expiry issues one more code, up to three, then gives up', async () => {
  fake.on(DEVICE, (_c, i) => deviceCodeAnswer(i, { expires_in: 15, interval: 5 }));
  fake.on(TOKEN, (call) => {
    if (form(call).get('device_code') === `${DEVICE_CODE}-1`) {
      return json({ error: 'expired_token', error_description: 'AADSTS70019: expired' }, 400);
    }
    return json({ error: 'authorization_pending' }, 400);
  });
  const { auth: a, log } = auth();
  const result = await a.signIn({ retryStart: false });
  assert.equal(result, 'gaveUp');
  assert.equal(fake.callsTo(DEVICE).length, 3, 'three codes in total');
  assert.deepEqual(log.lines('warn'), [
    'Work: Microsoft sign-in needed. Open https://microsoft.com/devicelogin and enter the code CODE0.',
    'Work: Microsoft sign-in needed. Open https://microsoft.com/devicelogin and enter the code CODE1.',
    'Work: Microsoft sign-in needed. Open https://microsoft.com/devicelogin and enter the code CODE2.',
    'Work: the sign-in code was not used. Restart Homebridge or run "homebridge-busy-light login" to try again.',
  ]);
  assert.equal(a.gaveUp, true);
  a.startSignIn();
  assert.equal(a.signingIn, false, 'the flow does not start again by itself');
  const err = await a.getAccessToken().catch((e: unknown) => e);
  assert.ok(err instanceof SourceError);
  assert.equal(err.state, 'signInNeeded');
  assert.equal(err.message, 'the sign-in code was not used');
  assertNoSecrets(log.all());
});

const TABLE: [string, string][] = [
  ['AADSTS700016', 'the Directory (tenant) ID or Application (client) ID was not recognised'],
  ['AADSTS90002', 'the Directory (tenant) ID or Application (client) ID was not recognised'],
  ['AADSTS900023', 'the Directory (tenant) ID or Application (client) ID was not recognised'],
  ['AADSTS7000218', 'the app registration does not allow public client flows'],
  ['AADSTS70002', 'the app registration does not allow public client flows'],
  ['AADSTS65001', 'your organization has not approved the permissions'],
  ['AADSTS90094', 'your organization has not approved the permissions'],
  ['AADSTS90099', 'your organization has not approved the permissions'],
  ['AADSTS650051', 'your organization has not approved the permissions'],
  ['AADSTS650057', 'your organization has not approved the permissions'],
  ['AADSTS53003', 'your organization\'s sign-in policy blocked it'],
  ['AADSTS530033', 'your organization\'s sign-in policy blocked it'],
  ['AADSTS50105', 'your organization\'s sign-in policy blocked it'],
  ['AADSTS50158', 'your organization\'s sign-in policy blocked it'],
  ['AADSTS50020', 'that account does not belong to this organization'],
  ['AADSTS50059', 'that account does not belong to this organization'],
  ['AADSTS50076', 'Microsoft answered AADSTS50076'],
];

const refusedLine = (reason: string) =>
  `Work: Microsoft did not allow the sign-in: ${reason}. This needs your Microsoft 365 administrator. Instructions to send them: ${ADMIN_HELP_URL}`;

for (const [code, reason] of TABLE) {
  test(`refused at the device code request: ${code}`, async () => {
    fake.on(DEVICE, () => json({ error: 'invalid_request', error_description: `${code}: synthetic description.`, error_codes: [Number(code.slice(6))] }, 400));
    fake.on(TOKEN, () => assert.fail('no poll after a refusal'));
    const { auth: a, log } = auth();
    assert.equal(await a.signIn({ retryStart: true }), 'refused');
    assert.equal(fake.callsTo(DEVICE).length, 1, 'no further codes are issued');
    assert.deepEqual(log.lines('warn'), [refusedLine(reason)]);
    assert.equal(a.refusedReason, reason);
    const err = await a.getAccessToken().catch((e: unknown) => e);
    assert.ok(err instanceof SourceError);
    assert.deepEqual([err.state, err.message, err.options.help], ['signInNeeded', reason, ADMIN_HELP_URL]);
    a.startSignIn();
    assert.equal(a.signingIn, false, 'a refusal is not retried by itself');
  });

  test(`refused at the token poll: ${code}`, async () => {
    fake.on(DEVICE, (_c, i) => deviceCodeAnswer(i));
    fake.on(TOKEN, () => json({ error: 'invalid_grant', error_codes: [Number(code.slice(6))], error_description: `${code}: synthetic.` }, 400));
    const { auth: a, log } = auth();
    assert.equal(await a.signIn({ retryStart: false }), 'refused');
    assert.equal(fake.callsTo(DEVICE).length, 1, 'no further codes are issued');
    assert.equal(fake.callsTo(TOKEN).length, 1);
    assert.deepEqual(log.lines('warn').slice(1), [refusedLine(reason)]);
    assert.equal(a.code, null);
    assert.equal(a.refusedReason, reason);
  });
}

test('refusal reasons from error_codes alone, and with no code at all', () => {
  assert.deepEqual(aadstsCodes({ error_description: 'AADSTS50020: x', error_codes: [50020, 90002] }), ['AADSTS50020', 'AADSTS90002']);
  assert.equal(refusalReason({ error: 'invalid_client', error_codes: [7000218] }), 'the app registration does not allow public client flows');
  assert.equal(refusalReason({ error: 'authorization_declined' }), 'Microsoft answered authorization_declined');
  assert.equal(refusalReason({}), 'Microsoft answered an error');
});

test('a network failure at the device code request is retried in the background and thrown for the CLI', async () => {
  fake.on(DEVICE, (_c, i) => (i === 0 ? networkError('ENOTFOUND') : deviceCodeAnswer(i)));
  fake.on(TOKEN, () => tokenAnswer(1));
  const { auth: a } = auth();
  assert.equal(await a.signIn({ retryStart: true }), 'signedIn');
  assert.equal(fake.callsTo(DEVICE).length, 2);

  fake.on(DEVICE, () => networkError('ENOTFOUND'));
  const { auth: b } = auth();
  const err = await b.signIn({ retryStart: false }).catch((e: unknown) => e);
  assert.ok(err instanceof SourceError);
  assert.equal(err.message, 'login.microsoftonline.com could not be found');
});

test('refresh: a cached token is reused until 120 seconds before expiry, then refreshed with rotation', async () => {
  const { store } = auth();
  writeToken(store, 121_000);
  const b = new MicrosoftAuth({ source, store, log: fakeLog().log, now, sleep });
  fake.on(TOKEN, (call) => {
    assert.deepEqual(Object.fromEntries(form(call)), {
      grant_type: 'refresh_token', client_id: CLIENT, refresh_token: 'refresh-0', scope: 'offline_access Presence.Read Calendars.Read',
    });
    return tokenAnswer(1);
  });
  assert.equal(await b.getAccessToken(), 'access-0');
  assert.equal(fake.calls.length, 0);
  clock += 1_001;
  assert.equal(await b.getAccessToken(), 'access-1');
  assert.equal(JSON.parse(fs.readFileSync(store.file, 'utf8')).refreshToken, 'refresh-1', 'the rotated refresh token replaces the stored one');
  assert.equal(new MicrosoftAuth({ source, store: new TokenStore(store.file), log: fakeLog().log, now, sleep }).hasToken(), true);
});

test('refresh: a refresh without a new refresh token keeps the old one', async () => {
  const { store } = auth();
  writeToken(store, 0);
  const a = new MicrosoftAuth({ source, store, log: fakeLog().log, now, sleep });
  fake.on(TOKEN, () => json({ access_token: 'access-2', expires_in: 3600 }));
  assert.equal(await a.getAccessToken(), 'access-2');
  assert.equal(JSON.parse(fs.readFileSync(store.file, 'utf8')).refreshToken, 'refresh-0');
});

test('refresh: concurrent callers share one refresh', async () => {
  const { store } = auth();
  writeToken(store, 0);
  const a = new MicrosoftAuth({ source, store, log: fakeLog().log, now, sleep });
  fake.on(TOKEN, async () => {
    await new Promise((r) => setTimeout(r, 10));
    return tokenAnswer(1);
  });
  const tokens = await Promise.all([a.getAccessToken(), a.getAccessToken(), a.getAccessToken()]);
  assert.deepEqual(tokens, ['access-1', 'access-1', 'access-1']);
  assert.equal(fake.callsTo(TOKEN).length, 1);
});

test('refresh: invalid_grant deletes the token and starts the device code flow once', async () => {
  const { store } = auth();
  writeToken(store, 0);
  const log = fakeLog();
  const a = new MicrosoftAuth({ source, store, log: log.log, now, sleep });
  fake.on(TOKEN, (call) => {
    if (form(call).get('grant_type') === 'refresh_token') {
      return json({ error: 'invalid_grant', error_description: 'AADSTS700082: expired.' }, 400);
    }
    return json({ error: 'authorization_pending' }, 400);
  });
  let deviceCalls = 0;
  fake.on(DEVICE, (_c, i) => {
    deviceCalls++;
    return deviceCodeAnswer(i, { expires_in: 10 });
  });
  const err = await a.getAccessToken().catch((e: unknown) => e);
  assert.ok(err instanceof SourceError);
  assert.equal(err.state, 'signInNeeded');
  assert.equal(fs.existsSync(store.file), false);
  assert.equal(a.signingIn, true);
  a.startSignIn();
  a.startSignIn();
  while (a.signingIn) {
    await new Promise((r) => setImmediate(r));
  }
  assert.equal(deviceCalls, 3, 'one flow of up to three codes');
  assert.equal(log.lines('warn').at(-1), 'Work: the sign-in code was not used. Restart Homebridge or run "homebridge-busy-light login" to try again.');
});

test('refresh: interaction_required is handled like invalid_grant', async () => {
  const { store } = auth();
  writeToken(store, 0);
  const a = new MicrosoftAuth({ source, store, log: fakeLog().log, now, sleep });
  fake.on(TOKEN, () => json({ error: 'interaction_required', error_codes: [50076] }, 400));
  fake.on(DEVICE, () => json({ error: 'invalid_client', error_codes: [7000218] }, 400));
  await a.getAccessToken().catch(() => undefined);
  assert.equal(fs.existsSync(store.file), false);
});

test('refresh: a server failure is Not reachable and keeps the token', async () => {
  const { store } = auth();
  writeToken(store, 0);
  const a = new MicrosoftAuth({ source, store, log: fakeLog().log, now, sleep });
  fake.on(TOKEN, () => text('down', 503));
  const err = await a.getAccessToken().catch((e: unknown) => e);
  assert.ok(err instanceof SourceError);
  assert.deepEqual([err.state, err.message], ['notReachable', 'login.microsoftonline.com answered HTTP 503']);
  assert.equal(fs.existsSync(store.file), true);
});

test('a sign-in completed by the CLI is picked up without a restart', async () => {
  const log = fakeLog();
  const { auth: plugin, store } = auth({ log });
  assert.equal(plugin.hasToken(), false);
  // The CLI writes the same file from another process.
  const cli = new TokenStore(store.file);
  await new Promise((r) => setTimeout(r, 5));
  cli.write({ refreshToken: 'refresh-9', accessToken: 'access-9', expiresAt: new Date(clock + 3_600_000).toISOString() });
  assert.equal(await plugin.getAccessToken(), 'access-9');
  assert.deepEqual(log.lines('info'), ['Work: signed in to Microsoft 365.']);
});

test('the token file is watched before each refresh', async () => {
  const { store } = auth();
  writeToken(store, 0, 1);
  const a = new MicrosoftAuth({ source, store, log: fakeLog().log, now, sleep });
  await new Promise((r) => setTimeout(r, 5));
  new TokenStore(store.file).write({ refreshToken: 'refresh-7', accessToken: 'access-7', expiresAt: new Date(clock + 3_600_000).toISOString() });
  fake.on(TOKEN, () => assert.fail('no refresh is needed'));
  assert.equal(await a.getAccessToken(), 'access-7');
});

test('a background flow stops when the CLI signs in', async () => {
  const { auth: a, store } = auth();
  fake.on(DEVICE, (_c, i) => deviceCodeAnswer(i));
  fake.on(TOKEN, () => {
    new TokenStore(store.file).write({ refreshToken: 'refresh-5', accessToken: 'access-5', expiresAt: new Date(clock + 3_600_000).toISOString() });
    return json({ error: 'authorization_pending' }, 400);
  });
  assert.equal(await a.signIn({ retryStart: true }), 'signedIn');
  assert.equal(await a.getAccessToken(), 'access-5');
});

function graph(): { client: GraphClient; auth: MicrosoftAuth; log: ReturnType<typeof fakeLog> } {
  const { store } = auth();
  writeToken(store, 3_600_000);
  const log = fakeLog();
  const a = new MicrosoftAuth({ source, store, log: log.log, now, sleep });
  return { client: new GraphClient(a, 'Work', now), auth: a, log };
}

test('presence mapping', async () => {
  const { client } = graph();
  fake.on(`${GRAPH}/me/presence`, (call) => {
    assert.equal(call.headers.authorization, 'Bearer access-0');
    return json({ id: 'synthetic', availability: 'Busy', activity: 'InACall', outOfOfficeSettings: { message: '', isOutOfOffice: true } });
  });
  assert.deepEqual(await client.getPresence(), { availability: 'Busy', activity: 'InACall', outOfOffice: true });
  fake.on(`${GRAPH}/me/presence`, () => json({ availability: 'Available', activity: 'Available' }));
  assert.deepEqual(await client.getPresence(), { availability: 'Available', activity: 'Available', outOfOffice: false },
    'a missing outOfOfficeSettings is false');
});

test('Graph 401 clears the access token and retries once after a refresh', async () => {
  const { client } = graph();
  fake.on(TOKEN, () => tokenAnswer(1));
  fake.on(`${GRAPH}/me/presence`, (call, i) => {
    if (i === 0) {
      assert.equal(call.headers.authorization, 'Bearer access-0');
      return text('', 401);
    }
    assert.equal(call.headers.authorization, 'Bearer access-1');
    return json({ availability: 'Away', activity: 'Away' });
  });
  assert.equal((await client.getPresence()).availability, 'Away');
  assert.equal(fake.callsTo(TOKEN).length, 1);

  fake.on(`${GRAPH}/me/presence`, () => text('', 401));
  const err = await client.getPresence().catch((e: unknown) => e);
  assert.ok(err instanceof SourceError);
  assert.equal(err.state, 'signInNeeded');
  assert.equal(fake.callsTo(`${GRAPH}/me/presence`).length, 4, 'one retry only');
});

test('Graph 403 is a refused sign-in for lack of consent, logged once', async () => {
  const { client, auth: a, log } = graph();
  fake.on(`${GRAPH}/me/presence`, () => json({ error: { code: 'Forbidden' } }, 403));
  for (let i = 0; i < 3; i++) {
    const err = await client.getPresence().catch((e: unknown) => e);
    assert.ok(err instanceof SourceError);
    assert.deepEqual([err.state, err.message, err.options.help, err.options.refused],
      ['signInNeeded', 'your organization has not approved the permissions', ADMIN_HELP_URL, true]);
  }
  assert.deepEqual(log.lines('warn'), [refusedLine('your organization has not approved the permissions')]);
  assert.equal(a.refusedReason, 'your organization has not approved the permissions');
  fake.on(`${GRAPH}/me/presence`, () => json({ availability: 'Available', activity: 'Available' }));
  await client.getPresence();
  assert.equal(a.refusedReason, null, 'cleared once Graph answers');
});

test('429 and 503 honour Retry-After', async () => {
  const { client } = graph();
  fake.on(`${GRAPH}/me/presence`, () => text('', 429, { 'retry-after': '120' }));
  let err = await client.getPresence().catch((e: unknown) => e);
  assert.ok(err instanceof SourceError);
  assert.deepEqual([err.state, err.message, err.options.retryAfterMs], ['notReachable', 'graph.microsoft.com answered HTTP 429', 120_000]);
  fake.on(`${GRAPH}/me/presence`, () => text('', 503, { 'retry-after': new Date(clock + 30_000).toUTCString() }));
  err = await client.getPresence().catch((e: unknown) => e);
  assert.ok(err instanceof SourceError);
  assert.equal(err.options.retryAfterMs, 30_000);
});

test('calendar: the request selects only the fields of SPEC 5.3 and pages up to five times', async () => {
  const { client } = graph();
  fake.on(`${GRAPH}/me/calendarView`, (call, i) => {
    assert.equal(call.headers.prefer, 'outlook.timezone="UTC"');
    if (i === 0) {
      const url = new URL(call.url);
      assert.equal(url.searchParams.get('$select'), 'showAs,start,end,isAllDay,isCancelled');
      assert.equal(url.searchParams.get('$top'), '200');
      assert.equal(url.searchParams.get('startDateTime'), new Date(T0 - 86_400_000).toISOString());
      assert.equal(url.searchParams.get('endDateTime'), new Date(T0 + 7 * 86_400_000).toISOString(), 'from build 3.3, 7 days ahead (SPEC 5)');
    }
    return json({
      'value': [{ showAs: 'busy', isAllDay: false, isCancelled: false, start: { dateTime: `2026-10-08T1${i}:00:00.0000000`, timeZone: 'UTC' },
        end: { dateTime: `2026-10-08T1${i}:30:00.0000000`, timeZone: 'UTC' } }],
      '@odata.nextLink': `${GRAPH}/me/calendarView?$skiptoken=synthetic-${i}`,
    });
  });
  const events = await client.fetchEvents(T0);
  assert.equal(fake.callsTo(`${GRAPH}/me/calendarView`).length, MAX_PAGES);
  assert.deepEqual(events.map((e) => e.start), [0, 1, 2, 3, 4].map((h) => Date.UTC(2026, 9, 8, 10 + h)));
  assert.ok(events.every((e) => e.source === 'Work'));
});

test('calendar: a nextLink to another host is not followed', async () => {
  const { client } = graph();
  fake.on(`${GRAPH}/me/calendarView`, () => json({ 'value': [], '@odata.nextLink': 'https://elsewhere.example.com/steal' }));
  await client.fetchEvents(T0);
  assert.equal(fake.calls.length, 1);
});

test('calendar: timed events are UTC, all-day events are local dates', () => {
  const timed = parseGraphEvent({ showAs: 'oof', isAllDay: false, start: { dateTime: '2026-10-08T14:30:00.0000000' },
    end: { dateTime: '2026-10-08T15:30:00.5000000' } }, 'Work');
  assert.deepEqual(timed, { showAs: 'oof', start: Date.UTC(2026, 9, 8, 14, 30), end: Date.UTC(2026, 9, 8, 15, 30) + 500, isAllDay: false,
    isCancelled: false, source: 'Work' });
  const allDay = parseGraphEvent({ showAs: 'busy', isAllDay: true, isCancelled: true, start: { dateTime: '2026-10-08T00:00:00.0000000' },
    end: { dateTime: '2026-10-09T00:00:00.0000000' } }, 'Work');
  assert.deepEqual(allDay, { showAs: 'busy', start: new Date(2026, 9, 8).getTime(), end: new Date(2026, 9, 9).getTime(), isAllDay: true,
    isCancelled: true, source: 'Work' });
  assert.equal(parseGraphEvent({ showAs: 'busy', start: { dateTime: 'garbage' }, end: {} }, 'Work'), null);
});

test('showAs mapping', () => {
  assert.deepEqual(['free', 'tentative', 'busy', 'oof', 'workingElsewhere', 'unknown', undefined].map(mapShowAs),
    ['free', 'tentative', 'busy', 'oof', 'free', 'busy', 'busy']);
});

test('token file location and mode', () => {
  assert.equal(tokenFile('/srv/hb/busy-light', 'work'), path.join('/srv/hb/busy-light', 'microsoft-work.json'));
});

test('review: a CLI sign-in noticed by another caller while the flow sleeps ends the flow cleanly', async () => {
  const gates: (() => void)[] = [];
  const gatedSleep = (ms: number) => new Promise<void>((resolve) => gates.push(() => {
    clock += ms;
    resolve();
  }));
  const log = fakeLog();
  const store = new TokenStore(tokenFile(dir, source.id));
  const a = new MicrosoftAuth({ source, store, log: log.log, now, sleep: gatedSleep });
  fake.on(DEVICE, (_c, i) => deviceCodeAnswer(i));
  fake.on(TOKEN, () => json({ error: 'authorization_pending' }, 400));
  const rejections: unknown[] = [];
  const onRejection = (err: unknown) => rejections.push(err);
  process.on('unhandledRejection', onRejection);
  try {
    a.startSignIn();
    while (gates.length === 0) {
      await new Promise((r) => setImmediate(r));
    }
    await new Promise((r) => setTimeout(r, 5));
    new TokenStore(store.file).write({ refreshToken: 'refresh-3', accessToken: 'access-3', expiresAt: new Date(clock + 3_600_000).toISOString() });
    assert.equal(await a.getAccessToken(), 'access-3', 'a tick picks the token up first');
    assert.equal(a.code, null);
    gates.shift()!();
    while (a.signingIn) {
      await new Promise((r) => setImmediate(r));
    }
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(rejections, []);
    assert.equal(log.lines('info').filter((l) => l === 'Work: signed in to Microsoft 365.').length, 1);
    assert.equal(fake.callsTo(TOKEN).length, 0, 'no poll after the sign-in was noticed');
  } finally {
    process.off('unhandledRejection', onRejection);
  }
});

test('review: a token file that cannot be written keeps the sign-in in memory', async () => {
  const store = new TokenStore(path.join(dir, 'missing-folder', 'microsoft-work.json'));
  const log = fakeLog();
  const a = new MicrosoftAuth({ source, store, log: log.log, now, sleep });
  fake.on(DEVICE, (_c, i) => deviceCodeAnswer(i));
  fake.on(TOKEN, () => tokenAnswer(1));
  assert.equal(await a.signIn({ retryStart: true }), 'signedIn');
  assert.equal(await a.getAccessToken(), 'access-1');
  assert.ok(log.lines('debug').some((l) => l.startsWith('Work: could not save the Microsoft sign-in')));
  assertNoSecrets(log.all());
});

test('review: with autoSignIn off (the CLI), invalid_grant never starts the device code flow', async () => {
  const { store } = auth();
  writeToken(store, 0);
  const a = new MicrosoftAuth({ source, store, log: fakeLog().log, now, sleep, autoSignIn: false });
  fake.on(TOKEN, () => json({ error: 'invalid_grant' }, 400));
  fake.on(DEVICE, () => assert.fail('no device code request'));
  await a.getAccessToken().catch(() => undefined);
  assert.equal(a.signingIn, false);
  assert.equal(fake.callsTo(DEVICE).length, 0);
});

test('review: invalid_grant after a Graph 403 still starts the device code flow', async () => {
  const { client, auth: a } = graph();
  fake.on(`${GRAPH}/me/presence`, () => json({}, 403));
  await client.getPresence().catch(() => undefined);
  assert.equal(a.refusedReason, 'your organization has not approved the permissions');
  a.invalidate();
  fake.on(TOKEN, () => json({ error: 'invalid_grant' }, 400));
  let deviceCalls = 0;
  fake.on(DEVICE, () => {
    deviceCalls++;
    return json({ error: 'invalid_client', error_codes: [7000218] }, 400);
  });
  await client.getPresence().catch(() => undefined);
  while (a.signingIn) {
    await new Promise((r) => setImmediate(r));
  }
  assert.equal(deviceCalls, 1);
  assert.equal(a.refusedReason, 'the app registration does not allow public client flows', 'the new reason replaces the old one');
});

test('review: a 403 on presence alone is logged once while the calendar keeps working', async () => {
  const { client, auth: a, log } = graph();
  fake.on(`${GRAPH}/me/presence`, () => json({}, 403));
  fake.on(`${GRAPH}/me/calendarView`, () => json({ value: [] }));
  for (let i = 0; i < 4; i++) {
    await client.getPresence().catch(() => undefined);
    await client.fetchEvents(T0);
  }
  assert.equal(log.lines('warn').length, 1);
  assert.equal(a.refusedReason, 'your organization has not approved the permissions');
  fake.on(`${GRAPH}/me/presence`, () => json({ availability: 'Available', activity: 'Available' }));
  await client.getPresence();
  assert.equal(a.refusedReason, null);
});

const event = (showAs: string, hour: number) => ({
  showAs, isAllDay: false, isCancelled: false,
  start: { dateTime: `2026-10-08T${hour}:00:00.0000000` }, end: { dateTime: `2026-10-08T${hour}:30:00.0000000` },
});

test('calendar: with a list, each listed calendar is read with its use, and one answering 404 is left out (SPEC 5.3 item 2)', async () => {
  const { store } = auth();
  writeToken(store, 3_600_000);
  const log = fakeLog();
  const a = new MicrosoftAuth({ source, store, log: log.log, now, sleep });
  const listed: [string, boolean][] = [];
  const client = new GraphClient(a, 'Work', now, {
    calendars: [
      { id: 'AAMkSynthetic+One=', name: 'Calendar', use: 'all' },
      { id: 'AAMkSyntheticGone=', name: 'Deleted', use: 'all' },
      { id: 'AAMkSyntheticHolidays=', name: 'Holidays', use: 'outOfOffice' },
    ],
    report: { listed: (choice, present) => listed.push([choice.name, present]) },
  });
  fake.on(`${GRAPH}/me/calendars/AAMkSynthetic%2BOne%3D/calendarView`, (call) => {
    assert.equal(new URL(call.url).searchParams.get('$select'), 'showAs,start,end,isAllDay,isCancelled');
    assert.equal(call.headers.prefer, 'outlook.timezone="UTC"');
    return json({ value: [event('busy', 15)] });
  });
  fake.on(`${GRAPH}/me/calendars/AAMkSyntheticGone%3D/calendarView`, () => json({ error: { code: 'ErrorItemNotFound' } }, 404));
  fake.on(`${GRAPH}/me/calendars/AAMkSyntheticHolidays%3D/calendarView`, () => json({ value: [event('busy', 16), event('oof', 17)] }));
  const events = await client.fetchEvents(T0);
  assert.deepEqual(events.map((e) => `${e.showAs} ${new Date(e.start).getUTCHours()}`), ['busy 15', 'free 16', 'oof 17']);
  assert.deepEqual(listed, [['Calendar', true], ['Deleted', false], ['Holidays', true]]);
  assert.equal(fake.callsTo(`${GRAPH}/me/calendarView`).length, 0, 'the default calendar is not read when there is a list');
});

test('calendar: the source runner warns once about a listed calendar that answers 404, until it is found again', async () => {
  const { store } = auth();
  writeToken(store, 3_600_000);
  const log = fakeLog();
  const runner = new SourceRunner({
    config: { ...source, useTeamsStatus: false, calendars: [{ id: 'AAMkSyntheticGone=', name: 'Deleted', use: 'all' }] },
    storageDir: dir, ics: { outOfOfficeWords: [], ownerAddresses: [] }, log: log.log, now, sleep,
  });
  let status = 404;
  fake.on(`${GRAPH}/me/calendars/AAMkSyntheticGone%3D/calendarView`, () => (status === 404 ? json({}, 404) : json({ value: [] })));
  await runner.runDue(clock, 0);
  await runner.runDue(clock, 0);
  assert.deepEqual(log.lines('warn'), ['Work: the calendar "Deleted" was not found. It may have been deleted or unshared.']);
  assert.equal(runner.state, 'connected', 'a missing listed calendar does not fail the source');
  status = 200;
  await runner.runDue(clock, 0);
  status = 404;
  await runner.runDue(clock, 0);
  assert.equal(log.lines('warn').length, 2, 'found again, then gone again');
  assert.ok(log.all().every((l) => !l.includes('AAMk')), 'no line carries a calendar id');
});
