import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { USAGE, defaultStoragePath, main } from '../src/commands.js';
import { BusyLightEngine } from '../src/engine.js';
import { LifxClient, MSG, hexToHsb, parseHeader } from '../src/lifx.js';
import { parseConfig } from '../src/config.js';
import { ADMIN_HELP_URL, formatTime } from '../src/messages.js';
import { FakeFetch, FakeNetwork, icsOf, json, text, tmpDir } from './helpers.js';

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 8, 15);
const FEED = 'https://calendar.example.com/private/synthetic-secret-path/basic.ics?key=synthetic-query';
const TENANT = '11111111-2222-3333-4444-555555555555';
const CLIENT = '66666666-7777-8888-9999-000000000000';
const BASE = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0`;
const DOOR = { serial: 'd073d5000001', label: 'Office Door', host: '192.168.4.50', answers: true };
const DESK = { serial: 'd073d5000002', label: 'Desk', host: '192.168.4.51', answers: true };

let storage: string;
let fake: FakeFetch;
let net: FakeNetwork;

beforeEach(() => {
  storage = tmpDir('busy-light-cli');
  fake = new FakeFetch();
  net = new FakeNetwork();
});
afterEach(() => {
  fake.restore();
  fs.rmSync(storage, { recursive: true, force: true });
});

function writeConfig(block: Record<string, unknown>): void {
  fs.writeFileSync(path.join(storage, 'config.json'), JSON.stringify({
    bridge: { name: 'Homebridge' },
    platforms: [{ platform: 'config', name: 'Config' }, { platform: 'BusyLight', ...block }],
  }));
}

async function run(...argv: string[]): Promise<{ code: number; out: string[]; err: string[] }> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main([...argv, '-U', storage], {
    out: (l) => out.push(l),
    err: (l) => err.push(l),
    now: () => T0,
    sleep: async () => undefined,
    lifx: new LifxClient({ socket: net.factory, timings: { replyMs: 40, collectMs: 100 }, interfaces: () => ({}) }),
  });
  for (const line of [...out, ...err]) {
    assert.ok(!line.includes('synthetic-secret-path') && !line.includes('synthetic-query'), line);
    assert.ok(!line.includes('synthetic-app-password') && !line.includes('synthetic-device-code'), line);
    assert.ok(!line.includes('Synthetic'), `no event title: ${line}`);
  }
  return { code, out, err };
}

test('help lists the commands', async () => {
  const { code, out } = await run('help');
  assert.equal(code, 0);
  assert.deepEqual(out, USAGE);
  const unknown = await run('frobnicate');
  assert.equal(unknown.code, 1);
  assert.deepEqual(unknown.err, USAGE);
});

test('the default storage path', () => {
  assert.equal(defaultStoragePath([storage, '/nonexistent/other']), storage);
  assert.equal(defaultStoragePath(['/nonexistent/var', '/nonexistent/home']), '/nonexistent/home');
});

test('check: every source once, the events active now as times and showAs, then the status', async () => {
  writeConfig({ calendars: [{ type: 'url', name: 'Rota', url: FEED }] });
  fake.on('https://calendar.example.com/', () => text(icsOf([
    ['meeting', T0 - 30 * MIN, T0 + 30 * MIN],
    ['later', T0 + 120 * MIN, T0 + 150 * MIN],
    ['leave', Date.UTC(2026, 9, 8), Date.UTC(2026, 9, 9), ['TRANSP:TRANSPARENT']],
  ])));
  const { code, out } = await run('check');
  assert.equal(code, 0);
  assert.deepEqual(out, [
    'Rota (Calendar URL): connected, 3 events in the window.',
    `  Now: ${formatTime(Date.UTC(2026, 9, 8))} to ${formatTime(Date.UTC(2026, 9, 9))}, free.`,
    `  Now: ${formatTime(T0 - 30 * MIN)} to ${formatTime(T0 + 30 * MIN)}, busy.`,
    `Status: In a meeting (Rota, until ${formatTime(T0 + 30 * MIN)}).`,
  ]);
  assert.equal(fs.existsSync(path.join(storage, 'busy-light', 'state.json')), false, 'check touches neither HomeKit nor the state file');
  assert.equal(net.sent.length, 0, 'nor the bulb');
});

test('check: a failing source and a Microsoft source with no sign-in', async () => {
  writeConfig({ calendars: [
    { type: 'url', name: 'Rota', url: FEED },
    { type: 'microsoft', name: 'Work', tenantId: TENANT, clientId: CLIENT },
    { type: 'icloud', name: 'Family', appleId: 'person@example.com', appPassword: 'synthetic-app-password' },
  ] });
  fake.on('https://calendar.example.com/', () => text('', 404));
  fake.on('https://caldav.icloud.com/', () => text('', 401));
  fake.on(BASE, () => assert.fail('check never starts a sign-in'));
  const { code, out } = await run('check');
  assert.equal(code, 1);
  assert.deepEqual(out, [
    'Rota (Calendar URL): not reachable (calendar.example.com answered HTTP 404).',
    'Work (Microsoft 365): sign-in needed (not signed in).',
    '  Run "homebridge-busy-light login Work" to sign in.',
    'Family (iCloud): sign-in needed (iCloud did not accept the Apple ID and app-specific password).',
    'Status unknown: none of your calendars could be read.',
  ]);
});

test('check: no calendars, no platform, no config', async () => {
  writeConfig({});
  assert.deepEqual(await run('check'), { code: 1, out: ['No calendars are set up yet. Open the plugin settings to add one.'], err: [] });
  fs.writeFileSync(path.join(storage, 'config.json'), JSON.stringify({ platforms: [] }));
  assert.deepEqual((await run('check')).err, [`No BusyLight platform in ${path.join(storage, 'config.json')}.`]);
  fs.rmSync(path.join(storage, 'config.json'));
  assert.equal((await run('check')).code, 1);
});

test('status prints the state file in plain words', async () => {
  writeConfig({ calendars: [{ type: 'url', name: 'Rota', url: FEED }, { type: 'microsoft', name: 'Work', tenantId: TENANT, clientId: CLIENT }],
    lifx: { enabled: true, host: DOOR.host } });
  const { config } = parseConfig({ calendars: [{ type: 'url', name: 'Rota', url: FEED }], lifx: { enabled: true, host: DOOR.host } });
  fake.on('https://calendar.example.com/', () => text(icsOf([['meeting', T0 - 30 * MIN, T0 + 30 * MIN]])));
  net.bulbs = [{ ...DOOR }];
  const engine = new BusyLightEngine({
    config, storageDir: path.join(storage, 'busy-light'), version: '0.1.0-beta.1', clock: { now: () => T0, setTimeout: () => 0,
      clearTimeout: () => undefined, setInterval: () => 0, clearInterval: () => undefined },
    log: { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined },
    lifx: new LifxClient({ socket: net.factory, timings: { replyMs: 40 } }),
  });
  fs.mkdirSync(path.join(storage, 'busy-light'));
  await engine.tick();
  const { code, out } = await run('status');
  assert.equal(code, 0);
  assert.deepEqual(out, [
    `Status: In a meeting (Rota, until ${formatTime(T0 + 30 * MIN)}).`,
    `Updated ${formatTime(T0)}.`,
    `Rota (Calendar URL): connected, 1 event, checked ${formatTime(T0)}.`,
    `Light: ${DOOR.host}, last sent #FF0000 at ${formatTime(T0)}, answered.`,
  ]);
});

test('status shows a waiting code and a refusal with the instructions', async () => {
  fs.mkdirSync(path.join(storage, 'busy-light'));
  fs.writeFileSync(path.join(storage, 'busy-light', 'state.json'), JSON.stringify({
    version: 1, updatedAt: new Date(T0).toISOString(), status: 'unknown', reason: null, override: true,
    sources: [
      { id: 'work', name: 'Work', type: 'microsoft', state: 'signInNeeded', lastChecked: new Date(T0).toISOString(), events: 0,
        error: 'your organization has not approved the permissions', help: ADMIN_HELP_URL },
      { id: 'home', name: 'Home', type: 'microsoft', state: 'signInNeeded', lastChecked: null, events: null, error: 'waiting for sign-in' },
    ],
    signIn: { id: 'home', verificationUri: 'https://microsoft.com/devicelogin', userCode: 'ABCD1234', expiresAt: new Date(T0 + 900_000).toISOString() },
    light: { enabled: false, label: null, host: null, found: null, lastSent: null, lastSentAt: null, answered: null },
  }));
  const { code, out } = await run('status');
  assert.equal(code, 0);
  assert.deepEqual(out, [
    'Status unknown: none of your calendars could be read.',
    'The override switch is on.',
    `Updated ${formatTime(T0)}.`,
    `Work (Microsoft 365): sign-in needed (your organization has not approved the permissions), 0 events, checked ${formatTime(T0)}.`,
    `  Instructions to send your Microsoft 365 administrator: ${ADMIN_HELP_URL}`,
    'Home (Microsoft 365): sign-in needed (waiting for sign-in), checked never.',
    'Home: Microsoft sign-in needed. Open https://microsoft.com/devicelogin and enter the code ABCD1234.',
    'Light: not used.',
  ]);
});

test('status without a state file fails', async () => {
  const { code, err } = await run('status');
  assert.equal(code, 1);
  assert.match(err[0], /^No state file in /);
});

test('login signs in the only Microsoft source and stores the token', async () => {
  writeConfig({ calendars: [{ type: 'microsoft', name: 'Work', tenantId: TENANT, clientId: CLIENT, useCalendar: false }] });
  fake.on(`${BASE}/devicecode`, (call) => {
    assert.equal(new URLSearchParams(call.body ?? '').get('scope'), 'offline_access Presence.Read');
    return json({
      device_code: 'synthetic-device-code', user_code: 'WXYZ5678', verification_uri: 'https://microsoft.com/devicelogin', expires_in: 900, interval: 5,
    });
  });
  fake.on(`${BASE}/token`, (_c, i) => (i === 0 ? json({ error: 'authorization_pending' }, 400)
    : json({ access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', expires_in: 3600 })));
  const { code, out } = await run('login');
  assert.equal(code, 0);
  assert.deepEqual(out, [
    'Work: Microsoft sign-in needed. Open https://microsoft.com/devicelogin and enter the code WXYZ5678.',
    'Work: signed in to Microsoft 365.',
  ]);
  const file = path.join(storage, 'busy-light', 'microsoft-work.json');
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).refreshToken, 'synthetic-refresh');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.ok(!out.join('\n').includes('synthetic-access') && !out.join('\n').includes('synthetic-refresh'));
});

test('login prints the refusal and the instructions address', async () => {
  writeConfig({ calendars: [{ type: 'microsoft', name: 'Work', tenantId: TENANT, clientId: CLIENT }] });
  fake.on(`${BASE}/devicecode`, () => json({ error: 'unauthorized_client', error_description: 'AADSTS700016: synthetic.' }, 400));
  const { code, out } = await run('login', 'work');
  assert.equal(code, 1);
  assert.deepEqual(out, [
    'Work: Microsoft did not allow the sign-in: the Directory (tenant) ID or Application (client) ID was not recognised. ' +
    `This needs your Microsoft 365 administrator. Instructions to send them: ${ADMIN_HELP_URL}`,
  ]);
});

test('login needs a name when there are several Microsoft sources', async () => {
  writeConfig({ calendars: [
    { type: 'microsoft', name: 'Work', tenantId: TENANT, clientId: CLIENT },
    { type: 'microsoft', name: 'Club', tenantId: TENANT, clientId: CLIENT, useTeamsStatus: false },
  ] });
  assert.deepEqual((await run('login')).err, ['Name the Microsoft 365 calendar to sign in to: Work, Club.']);
  assert.deepEqual((await run('login', 'Nope')).err, ['No Microsoft 365 calendar named Nope. Choose one of: Work, Club.']);
  writeConfig({});
  assert.deepEqual((await run('login')).err, ['No Microsoft 365 calendar is set up in the plugin settings.']);
});

test('lights lists every bulb found', async () => {
  net.bulbs = [{ ...DOOR }, { ...DESK }];
  const { code, out } = await run('lights');
  assert.equal(code, 0);
  assert.deepEqual(out, [
    'Searching for LIFX bulbs...',
    'Desk: serial number d073d5000002, IP address 192.168.4.51',
    'Office Door: serial number d073d5000001, IP address 192.168.4.50',
  ]);
  net.bulbs = [];
  const none = await run('lights');
  assert.equal(none.code, 1);
  assert.equal(none.out[1], 'No LIFX bulb was found on the network. Check that it is on, or enter its IP address in the plugin settings.');
});

test('light sends the Available color to the only bulb, as the plugin would', async () => {
  writeConfig({ colors: { available: '#00FF7F' } });
  net.bulbs = [{ ...DOOR }];
  const { code, out } = await run('light');
  assert.equal(code, 0);
  assert.deepEqual(out, ['LIFX bulbs found: Office Door (192.168.4.50). Using Office Door.', 'The LIFX bulb at 192.168.4.50 answered.']);
  const color = net.sent.find((s) => parseHeader(s.buf)!.type === MSG.SetColor)!;
  assert.equal(color.buf.readUInt16LE(37), Math.round(hexToHsb('#00FF7F')!.h * 65535), 'the hue of the configured Available color');
  assert.notEqual(color.buf.readUInt16LE(37), Math.round(hexToHsb('#00FF00')!.h * 65535));
  assert.equal(fs.existsSync(path.join(storage, 'busy-light', 'light.json')), false, 'the CLI never writes light.json');
});

test('light by name, by IP address, with a color or off', async () => {
  writeConfig({});
  net.bulbs = [{ ...DOOR }, { ...DESK }];
  let result = await run('light', 'desk', '#ff0000');
  assert.deepEqual([result.code, result.out], [0, ['The LIFX bulb at 192.168.4.51 answered.']]);
  net.sent = [];
  result = await run('light', '192.168.4.50', 'off');
  assert.deepEqual([result.code, result.out], [0, ['The LIFX bulb at 192.168.4.50 answered.']]);
  assert.deepEqual(net.sent.map((s) => parseHeader(s.buf)!.type), [MSG.SetPower]);
  assert.ok(parseHeader(net.sent[0].buf)!.tagged, 'a bulb given by IP address is addressed tagged');
  result = await run('light', 'Kitchen');
  assert.deepEqual([result.code, result.out], [1, ['No LIFX bulb named Kitchen was found. Bulbs found: Desk (192.168.4.51), Office Door (192.168.4.50).']]);
});

test('light reports a bulb that does not answer, and several bulbs without a name', async () => {
  writeConfig({ lifx: { host: '192.168.4.60' } });
  let result = await run('light');
  assert.deepEqual([result.code, result.out], [1, ['The LIFX bulb at 192.168.4.60 did not answer.']]);
  writeConfig({});
  net.bulbs = [{ ...DOOR }, { ...DESK }];
  result = await run('light');
  assert.deepEqual([result.code, result.out],
    [1, ['More than one LIFX bulb was found: Desk, Office Door. Enter the name of the one to use in the plugin settings.']]);
});

test('review: check never starts a sign-in, even when the stored sign-in has expired', async () => {
  writeConfig({ calendars: [{ type: 'microsoft', name: 'Work', tenantId: TENANT, clientId: CLIENT }] });
  fs.mkdirSync(path.join(storage, 'busy-light'), { recursive: true });
  fs.writeFileSync(path.join(storage, 'busy-light', 'microsoft-work.json'),
    JSON.stringify({ refreshToken: 'synthetic-refresh', accessToken: '', expiresAt: new Date(0).toISOString() }));
  fake.on(`${BASE}/token`, () => json({ error: 'invalid_grant', error_description: 'AADSTS700082: synthetic.' }, 400));
  fake.on(`${BASE}/devicecode`, () => assert.fail('check never starts a sign-in'));
  const { code, out } = await run('check');
  assert.equal(code, 1);
  assert.deepEqual(out, [
    'Work (Microsoft 365): sign-in needed (not signed in).',
    '  Run "homebridge-busy-light login Work" to sign in.',
    'Status unknown: none of your calendars could be read.',
  ]);
});
