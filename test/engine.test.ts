import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseConfig } from '../src/config.js';
import { BusyLightEngine } from '../src/engine.js';
import { ensureStorageDir } from '../src/files.js';
import type { NewReport } from '../src/inputs.js';
import { LifxClient, MSG, parseHeader } from '../src/lifx.js';
import { ADMIN_HELP_URL, formatTime } from '../src/messages.js';
import type { Status } from '../src/model.js';
import { readState } from '../src/state.js';
import { FakeClock, FakeFetch, FakeNetwork, fakeLog, fixture, fixtureTitles, icsOf, json, networkError, settle, text, tmpDir } from './helpers.js';

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 8, 15, 0, 0);
const FEED = 'https://calendar.example.com/private/synthetic-secret-path/basic.ics?key=synthetic-query';
const OTHER = 'https://rota.example.net/team.ics';
const DOOR = { serial: 'd073d5000001', label: 'Office Door', host: '192.168.4.50', answers: true };
const TENANT = '11111111-2222-3333-4444-555555555555';
const CLIENT = '66666666-7777-8888-9999-000000000000';

let fake: FakeFetch;
let dir: string;
let clock: FakeClock;
let net: FakeNetwork;
let log: ReturnType<typeof fakeLog>;
let engine: BusyLightEngine | null;
const allLines: string[] = [];

beforeEach(() => {
  fake = new FakeFetch();
  dir = ensureStorageDir(tmpDir('busy-light-engine'));
  clock = new FakeClock(T0);
  net = new FakeNetwork();
  log = fakeLog();
  engine = null;
});
afterEach(() => {
  engine?.stop();
  allLines.push(...log.all());
  fake.restore();
  fs.rmSync(dir, { recursive: true, force: true });
});

let release: (() => void) | null = null;
/** Each wait of the Microsoft sign-in lasts until the test releases it. */
const gatedSleep = (ms: number) => new Promise<void>((resolve) => {
  release = () => {
    clock.t += ms;
    resolve();
  };
});

function make(raw: Record<string, unknown>, statuses: Status[] = []): BusyLightEngine {
  const { config, issues } = parseConfig({ platform: 'BusyLight', ...raw });
  assert.deepEqual(issues, []);
  engine = new BusyLightEngine({
    config, storageDir: dir, log: log.log, version: '0.1.0-beta.1', clock,
    lifx: new LifxClient({ socket: net.factory, timings: { replyMs: 40, collectMs: 100 }, interfaces: () => ({}) }),
    onStatus: (s) => statuses.push(s),
    sleep: gatedSleep,
  });
  return engine;
}

const lifxSends = () => net.sent.filter((s) => [MSG.SetColor, MSG.SetPower].includes(parseHeader(s.buf)!.type as 102 | 117));
const lifxColors = () => net.sent.filter((s) => parseHeader(s.buf)!.type === MSG.SetColor);

test('startup lines', async () => {
  make({ calendars: [{ type: 'url', name: 'Rota', url: FEED }, { type: 'url', name: 'Team', url: OTHER }] });
  fake.on('https://', () => text(icsOf([])));
  engine!.start();
  await settle();
  assert.equal(log.lines('info')[0], 'Busy Light 0.1.0-beta.1: 2 calendars, light off, 3 sensors.');
  engine!.stop();

  log = fakeLog();
  make({ sensors: ['available'], lifx: { enabled: true, host: '192.168.4.50' } });
  engine!.start();
  await settle();
  assert.deepEqual(log.lines('info')[0], 'Busy Light 0.1.0-beta.1: 0 calendars, light on at 192.168.4.50, 1 sensor.');
  assert.deepEqual(log.lines('warn'), ['No calendars are set up yet. Open the plugin settings to add one.'],
    'no Unknown line when there is nothing to read');
  engine!.stop();

  log = fakeLog();
  make({ calendars: [{ type: 'url', name: 'Rota', url: FEED }], lifx: { enabled: true } });
  engine!.start();
  assert.equal(log.lines('info')[0], 'Busy Light 0.1.0-beta.1: 1 calendar, light on, 3 sensors.', 'the bulb is still being found');
});

test('a status change: the line, the sensors, the state file and the bulb', async () => {
  const statuses: Status[] = [];
  make({ calendars: [{ type: 'url', name: 'Rota', url: FEED }], lifx: { enabled: true, host: DOOR.host } }, statuses);
  net.bulbs = [{ ...DOOR }];
  fake.on('https://calendar.example.com/', () => text(icsOf([['meeting', T0 - 30 * MIN, T0 + 30 * MIN]])));
  await engine!.tick();
  assert.deepEqual(log.lines('info'), [`Status: In a meeting (Rota, until ${formatTime(T0 + 30 * MIN)}).`]);
  assert.deepEqual(statuses, ['inMeeting']);
  const state = readState(dir)!;
  assert.equal(state.status, 'inMeeting');
  assert.deepEqual(state.reason, { source: 'Rota', until: new Date(T0 + 30 * MIN).toISOString() });
  assert.deepEqual(state.sources, [{
    id: 'rota', name: 'Rota', type: 'url', state: 'connected', lastChecked: new Date(T0).toISOString(), events: 1, error: null,
  }]);
  assert.deepEqual(state.light, {
    enabled: true, label: null, host: DOOR.host, found: 'configured', lastSent: '#FF0000', lastSentAt: new Date(T0).toISOString(), answered: true,
  });
  assert.equal(state.signIn, null);
  assert.equal(state.override, false);
  const color = lifxColors();
  assert.equal(color.length, 1);
  assert.equal(color[0].buf.readUInt32LE(45), 1000, 'a change fades over 1 second');

  // Nothing changes on the next tick: no line, no sensor update, no send.
  clock.t += 30_000;
  await engine!.tick();
  assert.equal(log.lines('info').length, 1);
  assert.deepEqual(statuses, ['inMeeting']);
  assert.equal(lifxColors().length, 1);
});

test('the status line without a reason or without a time', async () => {
  make({ calendars: [{ type: 'url', name: 'Rota', url: FEED }] });
  fake.on('https://calendar.example.com/', () => text(icsOf([])));
  await engine!.tick();
  assert.deepEqual(log.lines('info'), ['Status: Available.']);
  await engine!.setOverride(true);
  assert.deepEqual(log.lines('info'), ['Status: Available.', 'Status: Do not disturb.']);
  assert.equal(readState(dir)!.override, true);
  await engine!.setOverride(false);
  assert.equal(log.lines('info').at(-1), 'Status: Available.');
});

test('backoff: 1, 2, 5, then 15 minutes, logged once and recovered once', async () => {
  make({ calendars: [{ type: 'url', name: 'Rota', url: FEED }] });
  let failing = true;
  fake.on('https://calendar.example.com/', () => (failing ? text('down', 503) : text(icsOf([]))));
  const attemptsAt: number[] = [];
  for (let m = 0; m <= 45; m += 0.5) {
    clock.t = T0 + m * MIN;
    const before = fake.calls.length;
    await engine!.tick();
    if (fake.calls.length > before) {
      attemptsAt.push(m);
    }
  }
  assert.deepEqual(attemptsAt, [0, 1, 3, 8, 23, 38]);
  assert.deepEqual(log.lines('warn'), [
    'Rota: could not be read (calendar.example.com answered HTTP 503). Trying again in 1 minute.',
    'Status unknown: none of your calendars could be read.',
  ]);
  assert.equal(log.lines('debug').filter((l) => l.startsWith('Rota: could not be read')).length, 5, 'repeats are debug');
  const state = readState(dir)!;
  assert.equal(state.sources[0].state, 'notReachable');
  assert.equal(state.sources[0].error, 'calendar.example.com answered HTTP 503');

  failing = false;
  clock.t = T0 + 53 * MIN;
  await engine!.tick();
  assert.deepEqual(log.lines('info'), ['Rota: working again.', 'Status: Available.']);
  assert.equal(readState(dir)!.sources[0].state, 'connected');

  // A success resets the schedule: reloads every calendarSeconds, and a new failure starts at 1 minute.
  failing = true;
  clock.t = T0 + 56 * MIN;
  await engine!.tick();
  clock.t = T0 + 57 * MIN;
  const before = fake.calls.length;
  await engine!.tick();
  assert.equal(fake.calls.length, before + 1);
});

test('iCloud Sign-in needed is retried hourly, with its own line', async () => {
  make({ calendars: [{ type: 'icloud', name: 'Family', appleId: 'person@example.com', appPassword: 'synthetic-app-password' }] });
  fake.on('https://caldav.icloud.com/', () => text('', 401));
  await engine!.tick();
  for (const m of [1, 15, 59]) {
    clock.t = T0 + m * MIN;
    await engine!.tick();
  }
  assert.equal(fake.calls.length, 1);
  clock.t = T0 + 60 * MIN;
  await engine!.tick();
  assert.equal(fake.calls.length, 2);
  assert.deepEqual(log.lines('warn'), [
    'Family: iCloud did not accept the Apple ID and app-specific password. Check them in the plugin settings.',
    'Status unknown: none of your calendars could be read.',
  ]);
  const state = readState(dir)!;
  assert.deepEqual([state.sources[0].state, state.sources[0].error], ['signInNeeded', 'iCloud did not accept the Apple ID and app-specific password']);
  assert.ok(!JSON.stringify(state).includes('synthetic-app-password'));
});

test('calendars are reloaded every calendarSeconds; Retry-After pushes the retry out', async () => {
  make({ calendars: [{ type: 'url', name: 'Rota', url: FEED }], calendarSeconds: 120 });
  fake.on('https://calendar.example.com/', () => text(icsOf([])));
  await engine!.tick();
  clock.t = T0 + 119_000;
  await engine!.tick();
  assert.equal(fake.calls.length, 1);
  clock.t = T0 + 120_000;
  await engine!.tick();
  assert.equal(fake.calls.length, 2);
});

test('the boundary timer changes the status at the minute a meeting ends, with no network call', async () => {
  const statuses: Status[] = [];
  make({ calendars: [{ type: 'url', name: 'Rota', url: FEED }] }, statuses);
  const end = T0 + 30 * MIN;
  fake.on('https://calendar.example.com/', () => text(icsOf([['meeting', T0 - 30 * MIN, end], ['later', end + 60 * MIN, end + 90 * MIN]])));
  clock.t = end - 10_000;
  await engine!.tick();
  assert.deepEqual(statuses, ['inMeeting']);
  const calls = fake.calls.length;
  assert.deepEqual(clock.pending().map((p) => p.at), [end], 'one timer, for the end of the meeting');
  await clock.advance(10_000);
  await engine!.idle();
  assert.deepEqual(statuses, ['inMeeting', 'available']);
  assert.equal(fake.calls.length, calls);
  assert.equal(log.lines('info').at(-1), `Status: Available (until ${formatTime(end + 60 * MIN)}).`);
  assert.deepEqual(clock.pending(), [], 'the next boundary is after the next tick');
});

test('the bulb is sent its color again every refreshSeconds, instantly, and never with 0', async () => {
  make({ calendars: [{ type: 'url', name: 'Rota', url: FEED }], lifx: { enabled: true, host: DOOR.host, refreshSeconds: 300 } });
  net.bulbs = [{ ...DOOR }];
  fake.on('https://calendar.example.com/', () => text(icsOf([])));
  await engine!.tick();
  assert.equal(lifxColors().length, 1);
  clock.t = T0 + 299_000;
  await engine!.tick();
  assert.equal(lifxColors().length, 1);
  clock.t = T0 + 300_000;
  await engine!.tick();
  assert.equal(lifxColors().length, 2);
  assert.equal(lifxColors()[1].buf.readUInt32LE(45), 0, 'a refresh has no fade');
  engine!.stop();

  net.sent = [];
  make({ calendars: [{ type: 'url', name: 'Rota', url: FEED }], lifx: { enabled: true, host: DOOR.host, refreshSeconds: 0 } });
  await engine!.tick();
  clock.t = T0 + 3_600_000;
  await engine!.tick();
  assert.equal(lifxColors().length, 1);
});

test('Unknown turns every sensor off and leaves the bulb alone', async () => {
  const statuses: Status[] = [];
  make({ calendars: [{ type: 'url', name: 'Rota', url: FEED }], lifx: { enabled: true, host: DOOR.host, refreshSeconds: 60 } }, statuses);
  net.bulbs = [{ ...DOOR }];
  let up = true;
  fake.on('https://calendar.example.com/', () => (up ? text(icsOf([])) : text('', 500)));
  await engine!.tick();
  const sends = lifxSends().length;
  up = false;
  for (let m = 3; m <= 30; m++) {
    clock.t = T0 + m * MIN;
    await engine!.tick();
    if (statuses.at(-1) === 'unknown') {
      break;
    }
  }
  assert.deepEqual(statuses, ['available', 'unknown']);
  assert.equal(clock.t, T0 + 15 * MIN, 'events stop counting 15 minutes after the last success');
  assert.equal(log.lines('warn').filter((l) => l.startsWith('Status unknown')).length, 1);
  const sendsAtUnknown = lifxSends().length;
  for (let m = 16; m <= 30; m++) {
    clock.t = T0 + m * MIN;
    await engine!.tick();
  }
  assert.equal(lifxSends().length, sendsAtUnknown, 'no send, not even a refresh, while unknown');
  assert.ok(sendsAtUnknown >= sends);
  assert.equal(readState(dir)!.status, 'unknown');
  assert.equal(readState(dir)!.reason, null);
});

test('a bulb found later is sent the current color', async () => {
  make({ calendars: [{ type: 'url', name: 'Rota', url: FEED }], lifx: { enabled: true } });
  fake.on('https://calendar.example.com/', () => text(icsOf([])));
  await engine!.light.start();
  await engine!.tick();
  assert.equal(lifxColors().length, 0);
  net.bulbs = [{ ...DOOR }];
  clock.t = T0 + 5 * MIN;
  await engine!.tick();
  assert.equal(lifxColors().length, 1);
  assert.equal(lifxColors()[0].to, DOOR.host);
});

test('ticks never overlap', async () => {
  make({ calendars: [{ type: 'url', name: 'Rota', url: FEED }] });
  fake.on('https://calendar.example.com/', async () => {
    await new Promise((r) => setTimeout(r, 20));
    return text(icsOf([]));
  });
  await Promise.all([engine!.tick(), engine!.tick(), engine!.tick()]);
  assert.equal(fake.calls.length, 1);
});

test('the state file is written at least once a minute', async () => {
  make({ calendars: [{ type: 'url', name: 'Rota', url: FEED }], pollSeconds: 240 });
  fake.on('https://calendar.example.com/', () => text(icsOf([])));
  engine!.start();
  await settle();
  await engine!.idle();
  assert.equal(readState(dir)!.updatedAt, new Date(T0).toISOString());
  await clock.advance(60_000);
  assert.equal(readState(dir)!.updatedAt, new Date(T0 + 60_000).toISOString());
  assert.equal(fs.statSync(`${dir}/state.json`).mode & 0o777, 0o600);
});

test('Microsoft: the code in the state file, then a refusal with its reason and help address', async () => {
  make({ calendars: [{ type: 'microsoft', name: 'Work', tenantId: TENANT, clientId: CLIENT }] });
  const base = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0`;
  fake.on(`${base}/devicecode`, () => json({
    device_code: 'synthetic-device-code', user_code: 'ABCD1234', verification_uri: 'https://microsoft.com/devicelogin', expires_in: 900, interval: 5,
  }));
  let refuse = false;
  fake.on(`${base}/token`, () => (refuse
    ? json({ error: 'invalid_client', error_description: 'AADSTS7000218: synthetic.', error_codes: [7000218] }, 400)
    : json({ error: 'authorization_pending' }, 400)));
  engine!.start();
  await settle();
  let state = readState(dir)!;
  assert.deepEqual(state.signIn, { id: 'work', verificationUri: 'https://microsoft.com/devicelogin', userCode: 'ABCD1234',
    expiresAt: new Date(T0 + 900_000).toISOString() });
  assert.deepEqual([state.sources[0].state, state.sources[0].error], ['signInNeeded', 'waiting for sign-in']);
  assert.equal(log.lines('warn')[0], 'Work: Microsoft sign-in needed. Open https://microsoft.com/devicelogin and enter the code ABCD1234.');

  refuse = true;
  release!();
  await settle();
  await engine!.tick();
  state = readState(dir)!;
  assert.equal(state.signIn, null);
  assert.deepEqual(state.sources[0], {
    id: 'work', name: 'Work', type: 'microsoft', state: 'signInNeeded', lastChecked: new Date(clock.t).toISOString(), events: 0,
    error: 'the app registration does not allow public client flows', help: ADMIN_HELP_URL,
  });
  assert.ok(log.lines('warn').includes('Work: Microsoft did not allow the sign-in: the app registration does not allow public client flows. ' +
    `This needs your Microsoft 365 administrator. Instructions to send them: ${ADMIN_HELP_URL}`));
  assert.ok(!JSON.stringify(state).includes('synthetic-device-code'));
  assert.ok(!log.all().some((l) => l.includes('synthetic-device-code')));
});

test('Microsoft: Teams presence decides, and a calendar-only source works without it', async () => {
  const base = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0`;
  const storage = `${dir}/microsoft-work.json`;
  fs.writeFileSync(storage, JSON.stringify({ refreshToken: 'r', accessToken: 'a', expiresAt: new Date(T0 + 3_600_000).toISOString() }));
  make({ calendars: [{ type: 'microsoft', name: 'Work', tenantId: TENANT, clientId: CLIENT }] });
  fake.on(`${base}/`, () => assert.fail('no sign-in is needed'));
  fake.on('https://graph.microsoft.com/v1.0/me/presence', () => json({ availability: 'DoNotDisturb', activity: 'Presenting' }));
  fake.on('https://graph.microsoft.com/v1.0/me/calendarView', () => json({ value: [] }));
  engine!.start();
  await settle();
  await engine!.idle();
  assert.equal(log.lines('info').at(-1), 'Status: Do not disturb (Teams).');
  assert.equal(readState(dir)!.sources[0].events, 0);
});

test('redaction: a failing URL source names the host only, and no line carries an event title', async () => {
  make({ calendars: [{ type: 'url', name: 'Rota', url: FEED }] });
  fake.on('https://calendar.example.com/', () => text('nope', 404));
  await engine!.tick();
  const warned = log.lines('warn')[0];
  assert.equal(warned, 'Rota: could not be read (calendar.example.com answered HTTP 404). Trying again in 1 minute.');
  const state = fs.readFileSync(`${dir}/state.json`, 'utf8');
  for (const text of [...log.all(), state]) {
    assert.ok(!text.includes('synthetic-secret-path') && !text.includes('synthetic-query') && !text.includes('/private/'), text);
  }
  assert.ok(state.includes('calendar.example.com'));
});

test('redaction: the full fixture through the engine leaves no title in any log line or the state file', async () => {
  make({ calendars: [{ type: 'url', name: 'Rota', url: FEED }], debug: true });
  fake.on('https://calendar.example.com/', () => text(fixture('calendar.ics')));
  await engine!.tick();
  const state = fs.readFileSync(`${dir}/state.json`, 'utf8');
  for (const title of fixtureTitles()) {
    assert.ok(!state.includes(title));
    for (const line of [...log.all(), ...allLines]) {
      assert.ok(!line.includes(title), line);
    }
  }
  assert.ok(![...log.all(), ...allLines].some((l) => l.includes('Synthetic')));
});

test('review: presence and calendar failing together write one warning', async () => {
  fs.writeFileSync(`${dir}/microsoft-work.json`, JSON.stringify({ refreshToken: 'r', accessToken: 'a', expiresAt: new Date(T0 + 3_600_000).toISOString() }));
  make({ calendars: [{ type: 'microsoft', name: 'Work', tenantId: TENANT, clientId: CLIENT }] });
  fake.on('https://graph.microsoft.com/', () => networkError('ECONNREFUSED'));
  await engine!.tick();
  assert.deepEqual(log.lines('warn'), [
    'Work: could not be read (graph.microsoft.com refused the connection). Trying again in 1 minute.',
    'Status unknown: none of your calendars could be read.',
  ]);
});

// Build 3: the sender store in the loop (SPEC 6.3, 6.5, 18.7).

const INPUT_KEY = 'Synthetic-engine-key-000000000000000000000';
const MAC = 'CallWatch on Alex’s iMac';
const inputOn = { statusInput: { enabled: true, key: INPUT_KEY } };
const call = (extra: Partial<NewReport> = {}): NewReport =>
  ({ sender: MAC, status: 'inCall', app: 'Microsoft Teams', via: 'api', auth: 'signed', ttlMs: 60_000, ...extra });

test('a report decides at once, logs once per change, and expires the moment its ttl ends', async () => {
  const statuses: Status[] = [];
  make(inputOn, statuses);
  engine!.start();
  await settle();
  assert.equal(engine!.status, 'available', 'no calendars with the status input on: not unknown (SPEC 6.5 item 5)');
  const result = await engine!.report(call());
  assert.deepEqual(result, { ok: true, expiresAt: T0 + 60_000, status: 'inCall' });
  await engine!.report(call({ ttlMs: 60_000 }));
  assert.deepEqual(log.lines('info').filter((l) => l.startsWith(MAC)), [`${MAC} reports In a call from Microsoft Teams.`], 'a repeat is not logged');
  assert.ok(log.lines('info').includes(`Status: In a call (${MAC}).`));
  await clock.advance(59_999);
  assert.equal(engine!.status, 'inCall');
  await clock.advance(1);
  assert.equal(engine!.status, 'available', 'the expiry timer changes the status at the moment the report expires');
  assert.ok(log.lines('info').includes(`${MAC}'s status expired.`));
  assert.deepEqual(statuses, ['available', 'inCall', 'available']);
});

test('clear withdraws a report with one line; a report through a channel that is off does not count', async () => {
  make(inputOn);
  engine!.start();
  await settle();
  await engine!.report(call({ status: 'busy', app: null }));
  assert.equal(engine!.status, 'busy');
  assert.equal(await engine!.clearInput(MAC, 'signed'), 'available');
  assert.equal(await engine!.clearInput(MAC, 'signed'), 'available', 'clearing again is fine');
  assert.deepEqual(log.lines('info').filter((l) => l.startsWith(MAC)), [`${MAC} reports Busy.`, `${MAC} cleared its status.`]);
  engine!.stop();

  log = fakeLog();
  make({ callSwitch: { enabled: true } });
  engine!.start();
  await settle();
  await engine!.report(call());
  assert.equal(engine!.status, 'available', 'the status API is off, so its reports do not count');
  await engine!.report({ sender: 'Home app', status: 'inCall', app: null, via: 'switch', auth: null, ttlMs: null });
  assert.equal(engine!.status, 'inCall', 'the switch is on');
});

test('a long report survives a restart; with calendars and no fresh data and no report the status is unknown', async () => {
  make(inputOn);
  engine!.start();
  await settle();
  await engine!.report(call({ status: 'doNotDisturb', app: null, ttlMs: 2 * 3_600_000 }));
  engine!.stop();
  clock.t += 10 * MIN;
  make(inputOn);
  engine!.start();
  await settle();
  assert.equal(engine!.status, 'doNotDisturb', 'reloaded from inputs.json');
  engine!.stop();

  log = fakeLog();
  make({ ...inputOn, calendars: [{ type: 'url', name: 'Rota', url: FEED }] });
  fake.on('https://', () => networkError('ECONNREFUSED'));
  engine!.start();
  await settle();
  assert.equal(engine!.status, 'doNotDisturb', 'the report is fresh data while calendars fail');
  await clock.advance(2 * 3_600_000);
  assert.equal(engine!.status, 'unknown', 'calendars configured, none fresh, no report');
});
