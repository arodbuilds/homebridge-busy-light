import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseConfig } from '../src/config.js';
import { BusyLightEngine, MAX_TIMER_MS } from '../src/engine.js';
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
  assert.deepEqual(state.lights, [{
    enabled: true, label: null, host: DOOR.host, found: 'configured', lastSent: '#FF0000', lastSentAt: new Date(T0).toISOString(), answered: true,
  }]);
  assert.equal(state.light, undefined, 'from build 3.2 the state file has lights only');
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
  assert.deepEqual(clock.pending().map((p) => p.at), [end + 60 * MIN], 'the next boundary, whether or not a tick comes first (SPEC 8.1 item 3)');
});

test('a meeting that starts while a calendar check waits on a slow server changes the status within one second of its start (SPEC 8.1 item 3)',
  async () => {
    const start = T0 + 5 * MIN;
    make({ calendars: [{ type: 'url', name: 'Rota', url: FEED, calendarSeconds: 60 }], pollSeconds: 30 });
    let release: (() => void) | null = null;
    const feed = icsOf([['meeting', start, start + 30 * MIN]]);
    fake.on('https://calendar.example.com/', (_call, index) => (index === 0 ? text(feed)
      : new Promise<Response>((resolve) => {
        release = () => resolve(text(feed));
      })));
    engine!.start();
    await settle();
    await engine!.idle();
    assert.equal(engine!.status, 'available');
    await clock.advance(5 * MIN - 1);
    assert.equal(fake.callsTo('https://calendar.example.com/').length, 2, 'the second check is still waiting');
    assert.equal(engine!.status, 'available');
    await clock.advance(1000);
    assert.equal(engine!.status, 'inMeeting', 'changed at the start, while the check waits');
    release!();
    await settle();
  });

test('the boundary timer is set from the clock after a send to an offline bulb (SPEC 8.1 item 3)', async () => {
  const end = T0 + 30 * MIN;
  class SlowBulb extends LifxClient {
    override async sendColor(): Promise<boolean> {
      clock.t += 3000; // three tries of each packet, unanswered
      return false;
    }
  }
  const { config } = parseConfig({ platform: 'BusyLight', calendars: [{ type: 'url', name: 'Rota', url: FEED }],
    lifx: { enabled: true, host: DOOR.host } });
  const statuses: [Status, number][] = [];
  engine = new BusyLightEngine({ config, storageDir: dir, log: log.log, version: '0.1.0-beta.5', clock, lifx: new SlowBulb(),
    onStatus: (s) => statuses.push([s, clock.t]) });
  fake.on('https://calendar.example.com/', () => text(icsOf([['meeting', T0 - 30 * MIN, end]])));
  clock.t = end - 10_000;
  await engine.tick();
  assert.deepEqual(clock.pending().map((p) => p.at), [end], 'at the end, not 3 seconds after it');
  await clock.advance(10_000);
  await engine.idle();
  assert.deepEqual(statuses, [['inMeeting', end - 10_000], ['available', end]]);
});

test('every timer delay is at most Node\'s maximum, and a far expiry does not fire at once (SPEC 8.1 item 5)', async () => {
  const far = T0 + 60 * 86_400_000;
  fs.writeFileSync(`${dir}/inputs.json`, JSON.stringify({ version: 1, replay: [], senders: [{ sender: 'Far sender on a test Mac', status: 'doNotDisturb',
    app: null, via: 'api', auth: 'signed', lastHeard: new Date(T0).toISOString(), expiresAt: new Date(far).toISOString(), active: true }] }));
  make({ statusInput: { enabled: true, key: 'Synthetic-engine-key-000000000000000000000' } });
  engine!.start();
  await settle();
  await engine!.idle();
  assert.equal(engine!.status, 'doNotDisturb');
  const delays = () => clock.pending().filter((p) => p.every === null).map((p) => p.at - clock.t);
  assert.ok(delays().length > 0 && delays().every((d) => d <= MAX_TIMER_MS), String(delays()));
  await clock.advance(MAX_TIMER_MS);
  await engine!.idle();
  assert.equal(engine!.status, 'doNotDisturb', 'the clamped timer fired early and was set again');
  assert.ok(delays().every((d) => d > 0 && d <= MAX_TIMER_MS));
  await clock.advance(far - clock.t);
  await engine!.idle();
  assert.equal(engine!.status, 'available', 'expired at its time');
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

test('a bulb found later is sent the current color, with the 1 second fade (SPEC 8.2 item 4)', async () => {
  make({ calendars: [{ type: 'url', name: 'Rota', url: FEED }], lifx: { enabled: true, refreshSeconds: 600 } });
  fake.on('https://calendar.example.com/', () => text(icsOf([])));
  await engine!.light.start();
  await engine!.tick();
  assert.equal(lifxColors().length, 0);
  net.bulbs = [{ ...DOOR }];
  clock.t = T0 + 5 * MIN;
  await engine!.tick();
  assert.equal(lifxColors().length, 1);
  assert.equal(lifxColors()[0].to, DOOR.host);
  assert.equal(lifxColors()[0].buf.readUInt32LE(45), 1000);
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

test('a series repeating too often writes the Repeat limit line once per source (SPEC 5.4 item 3, 12)', async () => {
  make({ calendars: [{ type: 'url', name: 'Rota', url: FEED }, { type: 'url', name: 'Team', url: OTHER }], calendarSeconds: 60 });
  const everySecond = icsOf([['every-second', T0 - 2 * 86_400_000, T0 - 2 * 86_400_000 + 1000, ['RRULE:FREQ=SECONDLY']]]);
  fake.on('https://calendar.example.com/', () => text(everySecond));
  fake.on(OTHER, () => text(icsOf([])));
  await engine!.tick();
  clock.t += 60_000;
  await engine!.tick();
  assert.equal(fake.callsTo('https://calendar.example.com/').length, 2, 'read twice');
  assert.deepEqual(log.lines('warn'), ['Rota: a recurring event repeats too often to read in full, so some of its occurrences are left out.']);
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

test('two calendars with different intervals reload on their own schedules (SPEC 8.1 item 2, 9.1 item 19)', async () => {
  make({
    pollSeconds: 30,
    calendarSeconds: 180,
    calendars: [{ type: 'url', name: 'Often', url: OTHER, calendarSeconds: 60 }, { type: 'url', name: 'Platform', url: FEED }],
  });
  fake.on('https://', () => text(icsOf([])));
  engine!.start();
  await settle();
  await clock.advance(6 * MIN);
  assert.equal(fake.callsTo(OTHER).length, 7, 'every 60 seconds: at 0 and each of the 6 minutes');
  assert.equal(fake.callsTo(FEED.split('?')[0]).length, 3, 'every 180 seconds, the platform interval: at 0, 3 and 6 minutes');
});

test('the state file carries the status input, the senders with how they authenticated, and the deciding app; never the key', async () => {
  make(inputOn);
  engine!.start();
  await settle();
  await engine!.report(call());
  await engine!.report(call({ sender: 'Test on my laptop', status: 'away', app: null, auth: 'plain' }));
  const state = readState(dir)!;
  assert.deepEqual(state.statusInput, { enabled: true, port: 8582, listening: false, error: null, id: null,
    reported: { inCall: new Date(T0).toISOString(), away: new Date(T0).toISOString() } });
  assert.deepEqual(state.reason, { source: MAC, until: null, app: 'Microsoft Teams' });
  assert.deepEqual(state.inputs, [
    { sender: MAC, status: 'inCall', app: 'Microsoft Teams', via: 'api', auth: 'signed', lastHeard: new Date(T0).toISOString(),
      expiresAt: new Date(T0 + 60_000).toISOString(), active: true, ended: null },
    { sender: 'Test on my laptop', status: 'away', app: null, via: 'api', auth: 'plain', lastHeard: new Date(T0).toISOString(),
      expiresAt: new Date(T0 + 60_000).toISOString(), active: true, ended: null },
  ]);
  const raw = fs.readFileSync(`${dir}/state.json`, 'utf8');
  assert.ok(!raw.includes(INPUT_KEY), 'the key is never in the state file');
  engine!.inputServerStatus = () => ({ listening: true, error: null, id: 'q3Lr8vT0cXw2mN5a' });
  engine!.writeState();
  assert.deepEqual(readState(dir)!.statusInput, { enabled: true, port: 8582, listening: true, error: null, id: 'q3Lr8vT0cXw2mN5a',
    reported: { inCall: new Date(T0).toISOString(), away: new Date(T0).toISOString() } });
});

// Build 3.2: the Working switch (SPEC 6.6).

test('not working: the bulb off whatever the Offline color, every status ignored, the override too, and the lines (SPEC 6.6)', async () => {
  const statuses: Status[] = [];
  make({ calendars: [{ type: 'url', name: 'Rota', url: FEED }], lifx: { enabled: true, host: DOOR.host, refreshSeconds: 60 },
    colors: { offline: '#FFFFFF' }, ...inputOn }, statuses);
  net.bulbs = [{ ...DOOR }];
  fake.on('https://calendar.example.com/', () => text(icsOf([['meeting', T0 - 30 * MIN, T0 + 30 * MIN]])));
  await engine!.tick();
  assert.equal(engine!.status, 'inMeeting');
  net.sent = [];
  await engine!.setWorking(false);
  assert.equal(engine!.status, 'notWorking');
  assert.deepEqual(statuses, ['inMeeting', 'notWorking'], 'the sensors are told, and turn off');
  assert.deepEqual(net.sent.map((s) => parseHeader(s.buf)!.type), [MSG.SetPower], 'one packet: power off');
  assert.equal(net.sent[0].buf.readUInt16LE(36), 0);
  assert.equal(readState(dir)!.status, 'notWorking');
  assert.equal(readState(dir)!.reason, null);
  assert.equal(log.lines('info').at(-1), 'Busy Light Working turned off. The light stays off until it is turned on.');
  assert.ok(!log.lines('info').some((l) => l.startsWith('Status: Not')), 'no status line for not working');

  // Reports, the override and boundaries change nothing; the report is still kept.
  await engine!.report(call());
  await engine!.setOverride(true);
  await clock.advance(31 * MIN);
  await engine!.tick();
  assert.equal(engine!.status, 'notWorking');
  assert.deepEqual(statuses, ['inMeeting', 'notWorking']);
  assert.ok(engine!.inputs.list(clock.t).some((e) => e.sender === MAC));
  assert.ok(net.sent.every((s) => parseHeader(s.buf)!.type === MSG.SetPower && s.buf.readUInt16LE(36) === 0), 'only off, refreshed');
  assert.ok(net.sent.length >= 2, 'the refresh sends off again');

  // Turned on: resolved at once, with the status line and the bulb's color.
  net.sent = [];
  await engine!.setWorking(true);
  assert.equal(engine!.status, 'doNotDisturb', 'the override applies again');
  assert.deepEqual(log.lines('info').slice(-2), ['Busy Light Working turned on.', 'Status: Do not disturb.']);
  assert.equal(lifxColors().length, 1);
  await engine!.setWorking(true);
  assert.equal(log.lines('info').filter((l) => l.includes('Working turned on')).length, 1, 'a line only when the state changes');
});

test('not working at startup: the off line once, and it wins over Unknown (SPEC 6.6)', async () => {
  const { config } = parseConfig({ platform: 'BusyLight', calendars: [{ type: 'url', name: 'Rota', url: FEED }], lifx: { enabled: true, host: DOOR.host } });
  net.bulbs = [{ ...DOOR }];
  fake.on('https://calendar.example.com/', () => networkError('ECONNREFUSED'));
  engine = new BusyLightEngine({ config, storageDir: dir, log: log.log, version: '0.1.0-beta.5', clock, working: false,
    lifx: new LifxClient({ socket: net.factory, timings: { replyMs: 40, collectMs: 100 }, interfaces: () => ({}) }) });
  engine.start();
  await settle();
  await engine.idle();
  assert.equal(engine.status, 'notWorking');
  assert.deepEqual(log.lines('info').filter((l) => l.includes('Working')), ['Busy Light Working turned off. The light stays off until it is turned on.']);
  assert.ok(!log.lines('warn').some((l) => l.startsWith('Status unknown')));
  assert.deepEqual(net.sent.map((s) => parseHeader(s.buf)!.type), [MSG.SetPower]);
});

// Build 3.2: the meeting warning (SPEC 6.7), with a fake clock and a fake socket.

/** The colors and powers sent to the bulb, in order: hue, brightness and duration of a SetColor, level and duration of a SetPower. */
type Packet = ['color', number, number, number] | ['power', number, number];
function packets(): Packet[] {
  return net.sent.filter((s) => s.to === DOOR.host).flatMap((s): Packet[] => {
    const h = parseHeader(s.buf)!;
    if (h.type === MSG.SetColor) {
      return [['color', s.buf.readUInt16LE(37), s.buf.readUInt16LE(41), s.buf.readUInt32LE(45)]];
    }
    return h.type === MSG.SetPower ? [['power', s.buf.readUInt16LE(36), s.buf.readUInt32LE(38)]] : [];
  });
}
const RED = 0;
const GREEN = 21845;
const FULL = 65535;

function warned(feed: () => string, extra: Record<string, unknown> = {}, statuses: Status[] = []): BusyLightEngine {
  const e = make({ calendars: [{ type: 'url', name: 'Rota', url: FEED }], lifx: { enabled: true, host: DOOR.host, refreshSeconds: 60 },
    meetingWarningSeconds: 120, ...extra }, statuses);
  net.bulbs = [{ ...DOOR }];
  fake.on('https://calendar.example.com/', () => text(feed()));
  return e;
}

test('the warning is one SetColor to the In a meeting color lasting until the start, sent when it begins (SPEC 6.7)', async () => {
  const start = T0 + 10 * MIN;
  const e = warned(() => icsOf([['meeting', start, start + 30 * MIN]]));
  e.start();
  await settle();
  await e.idle();
  assert.equal(e.status, 'available');
  assert.deepEqual(packets(), [['color', GREEN, FULL, 1000], ['power', FULL, 1000]]);
  net.sent = [];
  await clock.advance(8 * MIN - 1);
  assert.ok(packets().length > 0 && packets().every((p) => (p[0] === 'color' ? p[1] === GREEN && p[3] === 0 : p[1] === FULL && p[2] === 0)),
    'before the warning, only the refreshes of the Available color');
  net.sent = [];
  await clock.advance(1);
  await e.idle();
  assert.equal(e.status, 'available', 'the status stays Available');
  assert.deepEqual(e.meetingWarning, { meetingAt: start });
  assert.deepEqual(packets(), [['power', FULL, 0], ['color', RED, FULL, 120_000]], 'one fade of 2 minutes: the bulb fades by itself');
  assert.deepEqual(readState(dir)!.meetingWarning, { meetingAt: new Date(start).toISOString() });
  net.sent = [];
  await clock.advance(2 * MIN - 1);
  assert.deepEqual(packets(), [], 'no stream of packets, and no refresh during the fade');
  await clock.advance(1);
  await e.idle();
  assert.equal(e.status, 'inMeeting');
  assert.equal(e.meetingWarning, null);
  assert.deepEqual(packets(), [['color', RED, FULL, 1000], ['power', FULL, 1000]], 'the start changes the status as usual');
  assert.equal(readState(dir)!.meetingWarning, null);
});

test('with Available Off, the bulb comes on dim at the In a meeting color and the same SetColor fades it up (SPEC 6.7 item 3)', async () => {
  const start = T0 + 10 * MIN;
  const e = warned(() => icsOf([['meeting', start, start + 30 * MIN]]), { colors: { available: 'off' }, lifx: { enabled: true, host: DOOR.host,
    brightness: 80 } });
  e.start();
  await settle();
  await e.idle();
  assert.deepEqual(packets(), [['power', 0, 1000]], 'off while Available');
  net.sent = [];
  await clock.advance(8 * MIN);
  await e.idle();
  assert.deepEqual(packets().slice(-3), [['color', RED, Math.round(FULL / 100), 0], ['power', FULL, 0], ['color', RED, Math.round(FULL * 0.8), 120_000]]);
  assert.deepEqual(packets().slice(0, -3).filter((p) => !(p[0] === 'power' && p[1] === 0)), [], 'before it, only refreshes of off');
});

test('a meeting cancelled during the fade: the Available color comes back at once (SPEC 6.7 item 4)', async () => {
  const start = T0 + 10 * MIN;
  let cancelled = false;
  const e = warned(() => icsOf(cancelled ? [] : [['meeting', start, start + 30 * MIN]]), { calendarSeconds: 60 });
  e.start();
  await settle();
  await clock.advance(8 * MIN + 30_000);
  await e.idle();
  assert.deepEqual(e.meetingWarning, { meetingAt: start });
  cancelled = true;
  net.sent = [];
  await clock.advance(30_000);
  await e.idle();
  assert.equal(e.meetingWarning, null);
  assert.equal(e.status, 'available');
  assert.deepEqual(packets(), [['color', GREEN, FULL, 1000], ['power', FULL, 1000]], 'the normal apply replaces the fade');
  net.sent = [];
  await clock.advance(5 * MIN);
  assert.ok(packets().every((p) => p[0] !== 'color' || p[1] === GREEN), 'nothing fades to red later');
});

test('a call starting during the fade replaces it at once (SPEC 6.7 item 4)', async () => {
  const start = T0 + 10 * MIN;
  const e = warned(() => icsOf([['meeting', start, start + 30 * MIN]]), inputOn);
  e.start();
  await settle();
  await clock.advance(9 * MIN);
  await e.idle();
  assert.ok(e.meetingWarning);
  net.sent = [];
  await e.report(call());
  assert.equal(e.status, 'inCall');
  assert.equal(e.meetingWarning, null);
  await e.idle(); // the answer to the report does not wait for the bulb's acknowledgements (SPEC 13.3 item 1)
  assert.deepEqual(packets(), [['color', RED, FULL, 1000], ['power', FULL, 1000]]);
});

test('no warning between back-to-back meetings, and none while another status shows (SPEC 6.7 item 1)', async () => {
  const first = T0 + 10 * MIN;
  const e = warned(() => icsOf([['first', first, first + 30 * MIN], ['second', first + 30 * MIN, first + 60 * MIN],
    ['maybe', first + 70 * MIN, first + 100 * MIN, ['STATUS:TENTATIVE']], ['third', first + 100 * MIN, first + 120 * MIN]]));
  e.start();
  await settle();
  await clock.advance(first + 30 * MIN - clock.t);
  await e.idle();
  assert.equal(e.status, 'inMeeting');
  net.sent = [];
  await clock.advance(70 * MIN);
  await e.idle();
  assert.equal(e.status, 'inMeeting', 'the third meeting, after the tentative one');
  const fades = packets().filter((p) => p[0] === 'color' && p[3] > 1000);
  assert.deepEqual(fades, [], 'no fade before the second meeting (back to back) or the third (tentative showed)');
});

test('a short gap between meetings: the warning begins with Available, from the Available color (SPEC 6.7 items 2 and 3)', async () => {
  const end = T0 + 10 * MIN;
  const e = warned(() => icsOf([['first', T0 - 20 * MIN, end], ['second', end + MIN, end + 30 * MIN]]));
  e.start();
  await settle();
  await e.idle();
  assert.equal(e.status, 'inMeeting');
  net.sent = [];
  await clock.advance(10 * MIN);
  await e.idle();
  assert.equal(e.status, 'available');
  assert.deepEqual(e.meetingWarning, { meetingAt: end + MIN });
  assert.deepEqual(packets().slice(-3), [['color', GREEN, FULL, 0], ['power', FULL, 0], ['color', RED, FULL, 60_000]]);
  assert.ok(packets().slice(0, -3).every((p) => p[0] === 'power' || (p[1] === RED && p[3] === 0)), 'before it, only refreshes of red');
});

test('the warning off sends no fade, and an In a meeting color of Off has nothing to fade to (SPEC 6.7 item 1)', async () => {
  for (const extra of [{ meetingWarningSeconds: 0 }, { colors: { inMeeting: 'off' } }]) {
    net.sent = [];
    const start = T0 + 10 * MIN;
    clock.t = T0;
    const e = warned(() => icsOf([['meeting', start, start + 30 * MIN]]), extra);
    e.start();
    await settle();
    await clock.advance(10 * MIN);
    await e.idle();
    assert.equal(e.meetingWarning, null);
    assert.deepEqual(packets().filter((p) => p[0] === 'color' && p[3] > 1000), [], JSON.stringify(extra));
    e.stop();
  }
});

test('the warning begins on time while a calendar check waits on a slow server (SPEC 6.7 item 2, 8.1 item 3)', async () => {
  const start = T0 + 5 * MIN;
  const e = make({ calendars: [{ type: 'url', name: 'Rota', url: FEED, calendarSeconds: 60 }], lifx: { enabled: true, host: DOOR.host },
    meetingWarningSeconds: 60 });
  net.bulbs = [{ ...DOOR }];
  const feed = icsOf([['meeting', start, start + 30 * MIN]]);
  fake.on('https://calendar.example.com/', (_call, index) => (index === 0 ? text(feed) : new Promise<Response>(() => undefined)));
  e.start();
  await settle();
  await clock.advance(4 * MIN - 1);
  assert.equal(e.meetingWarning, null);
  await clock.advance(1);
  await e.idle();
  assert.deepEqual(e.meetingWarning, { meetingAt: start }, 'begun on time while the second check waits');
  assert.deepEqual(packets().slice(-2), [['power', FULL, 0], ['color', RED, FULL, 60_000]]);
});

// Build 3.2: several bulbs (SPEC 13.3, C8 of the build prompt): every send goes to every chosen bulb.

const STATUS_LIGHT = { serial: 'd073d5000004', label: 'Status Light', host: '192.168.4.21', answers: true };

/** As `packets`, for any bulb. */
function packetsTo(host: string): Packet[] {
  return net.sent.filter((s) => s.to === host).flatMap((s): Packet[] => {
    const h = parseHeader(s.buf)!;
    if (h.type === MSG.SetColor) {
      return [['color', s.buf.readUInt16LE(37), s.buf.readUInt16LE(41), s.buf.readUInt32LE(45)]];
    }
    return h.type === MSG.SetPower ? [['power', s.buf.readUInt16LE(36), s.buf.readUInt32LE(38)]] : [];
  });
}

test('two bulbs show the status together: the change, the refresh, the warning fade and the Working switch off reach both (SPEC 13.3)', async () => {
  const start = T0 + 10 * MIN;
  const e = warned(() => icsOf([['meeting', start, start + 30 * MIN]]),
    { lifx: { enabled: true, host: `${DOOR.host}, ${STATUS_LIGHT.host}`, refreshSeconds: 60 }, workingSwitch: { enabled: true } });
  net.bulbs = [{ ...DOOR }, { ...STATUS_LIGHT }];
  e.start();
  await settle();
  await e.idle();
  assert.equal(log.lines('info')[0], 'Busy Light 0.1.0-beta.1: 1 calendar, light on (2 bulbs), 3 sensors.');
  const both = (expected: Packet[], what: string) => {
    assert.deepEqual(packetsTo(DOOR.host), expected, `${what}: Office Door`);
    assert.deepEqual(packetsTo(STATUS_LIGHT.host), expected, `${what}: Status Light`);
    net.sent = [];
  };
  both([['color', GREEN, FULL, 1000], ['power', FULL, 1000]], 'the first status');
  assert.deepEqual(readState(dir)!.lights!.map((l) => [l.host, l.found, l.lastSent, l.answered]), [
    [DOOR.host, 'configured', '#00FF00', true], [STATUS_LIGHT.host, 'configured', '#00FF00', true],
  ]);
  await clock.advance(60_000);
  await e.idle();
  both([['color', GREEN, FULL, 0], ['power', FULL, 0]], 'the refresh');
  await clock.advance(7 * MIN - 1);
  net.sent = [];
  await clock.advance(1);
  await e.idle();
  both([['power', FULL, 0], ['color', RED, FULL, 120_000]], 'the meeting warning');
  await e.setWorking(false);
  await e.idle();
  both([['power', 0, 1000]], 'the Working switch turned off');
});

test('the 5 minute discovery for a missing bulb finds a chosen one at a new address, which is sent the color at once (SPEC 13.2 item 4)', async () => {
  make({ calendars: [{ type: 'url', name: 'Rota', url: FEED }], lifx: { enabled: true, bulbs: [DOOR.serial, 'Status Light'], refreshSeconds: 0 } });
  fake.on('https://calendar.example.com/', () => text(icsOf([])));
  net.bulbs = [{ ...DOOR }];
  await engine!.light.start();
  await engine!.tick();
  assert.equal(lifxColors().filter((s) => s.to === DOOR.host).length, 1);
  // Office Door is power cycled and gets a new address; Status Light is still switched off at the wall.
  net.bulbs = [{ ...DOOR, host: '192.168.4.77' }];
  net.sent = [];
  clock.t = T0 + 5 * MIN;
  await engine!.tick();
  assert.deepEqual(engine!.light.hosts, ['192.168.4.77']);
  assert.deepEqual(lifxColors().map((s) => [s.to, s.buf.readUInt32LE(45)]), [['192.168.4.77', 1000]], 'at once, with no refresh due');
});

test('one silent bulb\'s tries do not hold up the next color on the bulb that answers (SPEC 13.3 item 1)', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const sentTo: [string, string][] = [];
  class Gated extends LifxClient {
    override async sendColor(host: string, _serial: string | null, color: string): Promise<boolean> {
      sentTo.push([host, color]);
      if (host === STATUS_LIGHT.host) {
        await gate; // switched off at the wall: three tries of each packet, about 3 seconds
        return false;
      }
      return true;
    }
  }
  const { config } = parseConfig({ platform: 'BusyLight', calendars: [{ type: 'url', name: 'Rota', url: FEED }],
    lifx: { enabled: true, host: `${STATUS_LIGHT.host}, ${DOOR.host}` }, overrideSwitch: true });
  engine = new BusyLightEngine({ config, storageDir: dir, log: log.log, version: '0.1.0-beta.5', clock, lifx: new Gated() });
  fake.on('https://calendar.example.com/', () => text(icsOf([])));
  const ticking = engine.tick();
  await settle();
  const door = () => sentTo.filter(([h]) => h === DOOR.host).map(([, c]) => c);
  assert.deepEqual(door(), ['#00FF00'], 'Available reached Office Door at once');
  await engine.setOverride(true);
  await settle();
  assert.deepEqual(door(), ['#00FF00', config.colors.doNotDisturb], 'Do not disturb too, while Status Light is still trying');
  assert.deepEqual(sentTo.filter(([h]) => h === STATUS_LIGHT.host).map(([, c]) => c), ['#00FF00'], 'Status Light has it waiting');
  release();
  await ticking;
  await engine.idle();
  assert.deepEqual(sentTo.filter(([h]) => h === STATUS_LIGHT.host).map(([, c]) => c), ['#00FF00', config.colors.doNotDisturb],
    'then Status Light is sent the newest color, once');
});

// Build 3.3: the review fixes (A1, A2 and A4 of the build prompt).

test('the calendars going stale during the fade: Unknown sends the Available color once, then nothing (SPEC 6.7 item 4, 6.5 item 4)', async () => {
  const start = T0 + 17 * MIN;
  const statuses: Status[] = [];
  const e = make({ calendars: [{ type: 'url', name: 'Rota', url: FEED }], lifx: { enabled: true, host: DOOR.host, refreshSeconds: 60 },
    meetingWarningSeconds: 300 }, statuses);
  net.bulbs = [{ ...DOOR }];
  let up = true;
  fake.on('https://calendar.example.com/', () => (up ? text(icsOf([['meeting', start, start + 30 * MIN]])) : text('', 500)));
  e.start();
  await settle();
  await e.idle();
  up = false;
  await clock.advance(12 * MIN);
  await e.idle();
  assert.deepEqual(e.meetingWarning, { meetingAt: start }, 'the warning is running');
  assert.deepEqual(packets().slice(-2), [['power', FULL, 0], ['color', RED, FULL, 300_000]]);
  net.sent = [];
  await clock.advance(3 * MIN);
  await e.idle();
  assert.deepEqual(statuses, ['available', 'unknown'], 'the events went stale 15 minutes after the last check that worked');
  assert.equal(e.meetingWarning, null);
  assert.deepEqual(packets(), [['color', GREEN, FULL, 1000], ['power', FULL, 1000]], 'the Available color once, with the 1 second fade');
  net.sent = [];
  await clock.advance(30 * MIN);
  await e.idle();
  assert.deepEqual(packets(), [], 'then nothing: no refresh, and nothing at the meeting\'s start');
  assert.deepEqual(statuses, ['available', 'unknown']);
});

test('a meeting read inside the warning time starts its fade at once while another calendar is still being read (SPEC 6.7 item 2)', async () => {
  const e = make({ calendars: [{ type: 'url', name: 'Rota', url: FEED, calendarSeconds: 60 }, { type: 'url', name: 'Team', url: OTHER, calendarSeconds: 60 }],
    lifx: { enabled: true, host: DOOR.host, refreshSeconds: 0 }, meetingWarningSeconds: 300 });
  net.bulbs = [{ ...DOOR }];
  const start = T0 + 5 * MIN; // read at T0 + 1 minute, 4 minutes ahead
  let added = false;
  fake.on('https://calendar.example.com/', () => text(icsOf(added ? [['meeting', start, start + 30 * MIN]] : [])));
  fake.on('https://rota.example.net/', (_call, index) => (index === 0 ? text(icsOf([])) : new Promise<Response>(() => undefined)));
  e.start();
  await settle();
  await e.idle();
  assert.equal(e.status, 'available');
  net.sent = [];
  added = true;
  await clock.advance(MIN);
  await e.idle();
  assert.equal(fake.callsTo('https://rota.example.net/').length, 2, 'Team is still being read');
  assert.deepEqual(e.meetingWarning, { meetingAt: start }, 'begun at once, not when the slow check ends');
  assert.deepEqual(packets(), [['power', FULL, 0], ['color', RED, FULL, 4 * MIN]], 'the fade over the time left');
});

test('the startup line counts the bulbs configured, not those remembered in light.json (SPEC 12)', async () => {
  // Floor and Status Light chosen, and light.json still remembering one bulb at an old address, as on the Pi.
  fs.writeFileSync(`${dir}/light.json`, JSON.stringify({ serial: DOOR.serial, label: DOOR.label, host: '192.168.4.99' }));
  make({ calendars: [{ type: 'url', name: 'Rota', url: FEED }], lifx: { enabled: true, bulbs: [DOOR.serial, STATUS_LIGHT.serial] } });
  fake.on('https://calendar.example.com/', () => text(icsOf([])));
  engine!.start();
  assert.equal(log.lines('info')[0], 'Busy Light 0.1.0-beta.1: 1 calendar, light on (2 bulbs), 3 sensors.');
  await settle();
  engine!.stop();

  log = fakeLog();
  make({ calendars: [{ type: 'url', name: 'Rota', url: FEED }], lifx: { enabled: true, host: `${DOOR.host}, ${STATUS_LIGHT.host}` } });
  engine!.start();
  assert.equal(log.lines('info')[0], 'Busy Light 0.1.0-beta.1: 1 calendar, light on (2 bulbs), 3 sensors.', 'two addresses in lifx.host');
  await settle();
  engine!.stop();

  log = fakeLog();
  make({ calendars: [{ type: 'url', name: 'Rota', url: FEED }], lifx: { enabled: true, bulbs: [DOOR.serial] } });
  engine!.start();
  assert.equal(log.lines('info')[0], 'Busy Light 0.1.0-beta.1: 1 calendar, light on at 192.168.4.99, 3 sensors.', 'one bulb at its remembered address');
  await settle();
});
