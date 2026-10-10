import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressDeps } from '../src/addresses.js';
import { USAGE, defaultStoragePath, main } from '../src/commands.js';
import { BusyLightEngine } from '../src/engine.js';
import { LifxClient, MSG, hexToHsb, parseHeader } from '../src/lifx.js';
import { parseConfig } from '../src/config.js';
import { ADMIN_HELP_URL, formatTime } from '../src/messages.js';
import { signature } from '../src/status-api.js';
import { FakeFetch, FakeMdns, FakeNetwork, icsOf, json, mdnsAnswer, mdnsQueryOf, networkError, text, tmpDir } from './helpers.js';

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

/** The host's network as the `input` command sees it, replaced in tests (SPEC 15 item 20): no UDP, no resolver. */
const silentMdns = new FakeMdns();
let addresses: AddressDeps = { createSocket: silentMdns.factory, mdnsWaitMs: 10, lookup: async () => [] };

async function run(...argv: string[]): Promise<{ code: number; out: string[]; err: string[] }> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main([...argv, '-U', storage], {
    out: (l) => out.push(l),
    err: (l) => err.push(l),
    now: () => T0,
    sleep: async () => undefined,
    lifx: new LifxClient({ socket: net.factory, timings: { replyMs: 40, collectMs: 100 }, interfaces: () => ({}) }),
    addresses,
  });
  for (const line of [...out, ...err]) {
    assert.ok(!line.includes('synthetic-secret-path') && !line.includes('synthetic-query'), line);
    assert.ok(!line.includes('synthetic-app-password') && !line.includes('synthetic-device-code'), line);
    assert.ok(!line.includes('Synthetic'), `no event title: ${line}`);
  }
  return { code, out, err };
}

test('help names the reading window for check, as SPEC 10.2 item 6 gives it (build 3.3)', () => {
  const spec = fs.readFileSync(path.resolve(import.meta.dirname, '..', '..', 'SPEC.md'), 'utf8');
  const quoted = /the usage line for `check` names the window: `([^`]+)`/.exec(spec)![1];
  assert.ok(USAGE.some((line) => /^ {2}check +/.test(line) && line.endsWith(quoted)), quoted);
});

test('help lists the commands', async () => {
  const { code, out } = await run('help');
  assert.equal(code, 0);
  assert.deepEqual(out, USAGE);
  assert.ok(!USAGE.some((line) => /beta/i.test(line)), 'no beta wording from version 1.0.0');
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
    'Family (iCloud): sign-in needed (iCloud did not accept the Apple Account email and app-specific password).',
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

test('status shows an until time with its day when it is not today (SPEC 10.2 item 1)', async () => {
  writeConfig({ calendars: [{ type: 'url', name: 'Rota', url: FEED }] });
  fs.mkdirSync(path.join(storage, 'busy-light'));
  const tomorrow = new Date(new Date(T0).getFullYear(), new Date(T0).getMonth(), new Date(T0).getDate() + 1, 9).getTime();
  fs.writeFileSync(path.join(storage, 'busy-light', 'state.json'), JSON.stringify({
    version: 1, updatedAt: new Date(T0).toISOString(), status: 'available', reason: { source: null, until: new Date(tomorrow).toISOString() },
    override: false, sources: [], signIn: null,
    light: { enabled: false, label: null, host: null, found: null, lastSent: null, lastSentAt: null, answered: null },
  }));
  const { out } = await run('status');
  assert.equal(out[0], `Status: Available (until tomorrow at ${formatTime(tomorrow)}).`);
});

test('status says not working while the Working switch is off (SPEC 10.2 item 1)', async () => {
  writeConfig({});
  fs.mkdirSync(path.join(storage, 'busy-light'));
  fs.writeFileSync(path.join(storage, 'busy-light', 'state.json'), JSON.stringify({
    version: 1, updatedAt: new Date(T0).toISOString(), status: 'notWorking', reason: null, override: false, sources: [], signIn: null,
    light: { enabled: false, label: null, host: null, found: null, lastSent: null, lastSentAt: null, answered: null },
  }));
  const { code, out } = await run('status');
  assert.equal(code, 0);
  assert.deepEqual(out.slice(0, 2), ['Status: Not working (the Working switch is off).', `Updated ${formatTime(T0)}.`]);
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
    [1, ['More than one LIFX bulb was found: Desk, Office Door. Choose the bulbs to use in the plugin settings.']]);
});

test('status prints one Light line per bulb from lights (SPEC 10.2 item 1, from build 3.2)', async () => {
  writeConfig({});
  fs.mkdirSync(path.join(storage, 'busy-light'));
  fs.writeFileSync(path.join(storage, 'busy-light', 'state.json'), JSON.stringify({
    version: 1, updatedAt: new Date(T0).toISOString(), status: 'available', reason: null, override: false, sources: [], signIn: null,
    lights: [
      { enabled: true, label: 'Office Door', host: DOOR.host, found: 'discovered', lastSent: '#00FF00', lastSentAt: new Date(T0).toISOString(),
        answered: true },
      { enabled: true, label: 'Desk', host: DESK.host, found: 'remembered', lastSent: '#00FF00', lastSentAt: new Date(T0).toISOString(),
        answered: false },
    ],
  }));
  const { code, out } = await run('status');
  assert.equal(code, 0);
  assert.deepEqual(out.slice(-3), [
    `Light: Office Door at ${DOOR.host}, last sent #00FF00 at ${formatTime(T0)}, answered.`,
    `Light: Desk at ${DESK.host}, last sent #00FF00 at ${formatTime(T0)}, no answer.`,
    '  Desk is not answering, so it may still show an old color.',
  ]);
});

test('status names a bulb from light.json when an older state file has no name, and says it may show an old color (SPEC 10.2 item 1, build 3.3)',
  async () => {
    writeConfig({});
    fs.mkdirSync(path.join(storage, 'busy-light'));
    // A state file written before 1.0.0: no serial numbers, and one bulb without a name.
    fs.writeFileSync(path.join(storage, 'busy-light', 'state.json'), JSON.stringify({
      version: 1, updatedAt: new Date(T0).toISOString(), status: 'available', reason: null, override: false, sources: [], signIn: null,
      lights: [
        { enabled: true, label: null, host: '192.168.4.99', found: 'remembered', lastSent: '#FF0000', lastSentAt: new Date(T0).toISOString(),
          answered: false },
        { enabled: true, label: 'Status Light', host: '192.168.4.21', found: 'discovered', lastSent: '#00FF00', lastSentAt: new Date(T0).toISOString(),
          answered: true },
      ],
    }));
    fs.writeFileSync(path.join(storage, 'busy-light', 'light.json'), JSON.stringify({ bulbs: [
      { serial: 'd073d5000001', label: 'Floor', host: '192.168.4.99' }, { serial: 'd073d5000004', label: 'Status Light', host: '192.168.4.21' },
    ] }));
    const { code, out } = await run('status');
    assert.equal(code, 0);
    assert.deepEqual(out.slice(-3), [
      `Light: Floor at 192.168.4.99, last sent #FF0000 at ${formatTime(T0)}, no answer.`,
      '  Floor is not answering, so it may still show an old color.',
      `Light: Status Light at 192.168.4.21, last sent #00FF00 at ${formatTime(T0)}, answered.`,
    ]);
  });

test('status says a bulb of lifx.bulbs never found is not answering, by its serial number or its name (SPEC 10.2 item 1, the release review)', async () => {
  writeConfig({});
  fs.mkdirSync(path.join(storage, 'busy-light'));
  const missing = { enabled: true, host: null, found: null, lastSent: null, lastSentAt: null, answered: false };
  fs.writeFileSync(path.join(storage, 'busy-light', 'state.json'), JSON.stringify({
    version: 1, updatedAt: new Date(T0).toISOString(), status: 'available', reason: null, override: false, sources: [], signIn: null,
    lights: [
      { ...missing, label: null, serial: 'd073d5000003' },
      { enabled: true, label: 'Office Door', serial: DOOR.serial, host: DOOR.host, found: 'discovered', lastSent: '#00FF00',
        lastSentAt: new Date(T0).toISOString(), answered: true },
      { ...missing, label: 'Kitchen', serial: null },
    ],
  }));
  const { code, out } = await run('status');
  assert.equal(code, 0);
  assert.deepEqual(out.slice(-5), [
    'Light: d073d5000003, not found.',
    '  d073d5000003 is not answering, so it may still show an old color.',
    `Light: Office Door at ${DOOR.host}, last sent #00FF00 at ${formatTime(T0)}, answered.`,
    'Light: Kitchen, not found.',
    '  Kitchen is not answering, so it may still show an old color.',
  ]);
});

test('light with no bulb given sends to every chosen bulb, one answer line each, in the order of lifx.bulbs (SPEC 10.2 item 5)', async () => {
  writeConfig({ lifx: { bulbs: ['Desk', DOOR.serial] } });
  net.bulbs = [{ ...DOOR }, { ...DESK }];
  let result = await run('light', 'off');
  assert.deepEqual([result.code, result.out], [0, [
    'LIFX bulbs found: Desk (192.168.4.51), Office Door (192.168.4.50). Using Desk, Office Door.',
    'The LIFX bulb at 192.168.4.51 answered.',
    'The LIFX bulb at 192.168.4.50 answered.',
  ]]);
  writeConfig({ lifx: { host: `${DOOR.host}, 192.168.4.60` } });
  result = await run('light');
  assert.deepEqual([result.code, result.out], [1, ['The LIFX bulb at 192.168.4.50 answered.', 'The LIFX bulb at 192.168.4.60 did not answer.']],
    'a bulb that did not answer makes it exit 1');
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

// SPEC 15 item 20: input, input --setup-code and input test.

/** A synthetic status input key (43 characters, as the settings page makes them). */
const KEY = 'cliTestKey-0123456789abcdefghijklmnopqrstuv';
const ID = 'q3Lr8vT0cXw2mN5a';
const PI_NETWORK: AddressDeps = {
  hostname: () => 'homebridge',
  interfaces: () => ({
    lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true, netmask: '255.0.0.0', mac: '00:00:00:00:00:00', cidr: '127.0.0.1/8' }],
    eth0: [{ address: '192.168.4.10', family: 'IPv4', internal: false, netmask: '255.255.255.0', mac: '02:00:00:00:00:01', cidr: '192.168.4.10/24' }],
  }),
  createSocket: silentMdns.factory,
  mdnsWaitMs: 10,
  lookup: async (name) => (name === 'homebridge.local' ? [{ address: '192.168.4.10', family: 4 }] : []),
};

function writeInputs(): void {
  fs.mkdirSync(path.join(storage, 'busy-light'), { recursive: true });
  fs.writeFileSync(path.join(storage, 'busy-light', 'instance.json'), JSON.stringify({ id: ID }));
  fs.writeFileSync(path.join(storage, 'busy-light', 'state.json'), JSON.stringify({
    version: 1, updatedAt: new Date(T0).toISOString(), status: 'inCall', reason: { source: 'Mac', until: null }, override: false, sources: [],
    signIn: null, light: { enabled: false, label: null, host: null, found: null, lastSent: null, lastSentAt: null, answered: null },
    statusInput: { enabled: true, port: 8582, listening: true, error: null, id: ID },
    inputs: [
      { sender: 'CallWatch on Alex’s iMac', status: 'inCall', app: 'Microsoft Teams', via: 'api', auth: 'signed',
        lastHeard: new Date(T0).toISOString(), expiresAt: new Date(T0 + 180_000).toISOString(), active: true },
      { sender: 'Home app', status: 'inCall', app: null, via: 'switch', auth: null, lastHeard: new Date(T0 - 3_600_000).toISOString(),
        expiresAt: new Date(T0 - 60_000).toISOString(), active: false, ended: 'cleared' },
      { sender: 'Test on my laptop', status: 'busy', app: null, via: 'api', auth: 'plain', lastHeard: new Date(T0 - 60_000).toISOString(),
        expiresAt: new Date(T0 + 120_000).toISOString(), active: true },
    ],
  }));
}

test('input: on or off, the port, the id, the addresses by host name and IP, and the senders from the state file', async () => {
  addresses = PI_NETWORK;
  writeConfig({ statusInput: { enabled: true, key: KEY }, callSwitch: { enabled: true, hours: 1 } });
  writeInputs();
  const { code, out, err } = await run('input');
  assert.equal(code, 0);
  assert.deepEqual(err, []);
  assert.deepEqual(out, [
    'Status input: on, port 8582.',
    'On a Call switch: on, turns itself off after 1 hour.',
    `Instance id: ${ID}.`,
    'Address: http://homebridge.local:8582',
    'Address: http://192.168.4.10:8582',
    'Apps reporting now:',
    `  CallWatch on Alex’s iMac: In a call from Microsoft Teams, signed, last heard ${formatTime(T0)}, active.`,
    `  Home app: In a call, last heard ${formatTime(T0 - 3_600_000)}, cleared.`,
    `  Test on my laptop: Busy, plain key, last heard ${formatTime(T0 - 60_000)}, active.`,
  ]);
  assert.ok(!out.join('\n').includes(KEY), 'no key without --setup-code');
});

test('input on the Pi: the name resolves to 127.0.0.1 locally, and the CLI confirms it by multicast DNS itself (SPEC 18.11)', async () => {
  const mdns = new FakeMdns();
  mdns.answer = (query) => {
    const { id, name } = mdnsQueryOf(query);
    return [mdnsAnswer(id, name, [{ name, address: '192.168.4.10' }])];
  };
  addresses = { ...PI_NETWORK, createSocket: mdns.factory, lookup: async () => [{ address: '127.0.0.1', family: 4 }] };
  writeConfig({ statusInput: { enabled: true, key: KEY } });
  const { code, out } = await run('input');
  assert.equal(code, 0);
  assert.deepEqual(out.filter((l) => l.startsWith('Address:')), ['Address: http://homebridge.local:8582', 'Address: http://192.168.4.10:8582']);
  assert.equal(mdns.sent.length, 1, 'one query, sent by the CLI');
});

test('input with the status input off and nothing reported yet', async () => {
  addresses = { ...PI_NETWORK, lookup: async () => [{ address: '192.168.4.99', family: 4 }] };
  writeConfig({});
  const { code, out } = await run('input');
  assert.equal(code, 0);
  assert.deepEqual(out, [
    'Status input: off (port 8582 when on).',
    'On a Call switch: off.',
    'Instance id: none yet (it is created when the status input first starts).',
    'Address: http://192.168.4.10:8582',
    'Apps reporting now:',
    '  No app has reported in the last 12 hours.',
  ], 'a name that resolves elsewhere is not the host name');
});

test('input --setup-code prints the warning line, then the code with the host name, or the first address', async () => {
  addresses = PI_NETWORK;
  writeConfig({ statusInput: { enabled: true, key: KEY, port: 9000 } });
  writeInputs();
  const first = await run('input', '--setup-code');
  assert.equal(first.code, 0);
  let { out } = first;
  assert.deepEqual(out.slice(-2), [
    'The setup code contains your key. Treat it like a password.',
    `busylight://homebridge.local:9000/?key=${KEY}&id=${ID}`,
  ]);
  assert.equal(out.filter((l) => l.includes(KEY)).length, 1, 'the key is only in the setup code');
  addresses = { ...PI_NETWORK, lookup: () => new Promise(() => undefined), timeoutMs: 20 };
  ({ out } = await run('input', '--setup-code'));
  assert.equal(out.at(-1), `busylight://192.168.4.10:9000/?key=${KEY}&id=${ID}`, 'a name that times out: the first address');
  writeConfig({});
  const off = await run('input', '--setup-code');
  assert.equal(off.code, 1);
  assert.deepEqual(off.err, ['There is no setup code yet: turn on the status input in the plugin settings, save, and restart Homebridge.']);
  assert.equal((await run('input', '--nonsense')).code, 1);
});

test('input test sends a signed In a call for 30 seconds from Busy Light test to 127.0.0.1, and prints the answer', async () => {
  writeConfig({ statusInput: { enabled: true, key: KEY } });
  fake.on('http://127.0.0.1:8582/v1/status', (call) => {
    assert.equal(call.method, 'POST');
    assert.deepEqual(JSON.parse(call.body!), { sender: 'Busy Light test', status: 'inCall', ttlSeconds: 30 });
    assert.equal(call.headers['content-type'], 'application/json');
    assert.equal(call.headers.authorization, `BusyLight-HMAC-SHA256 ts=${T0}, sig=${signature(KEY, 'POST', '/v1/status', String(T0), call.body!)}`);
    assert.ok(!JSON.stringify(call).includes(KEY), 'the key never crosses the wire');
    return json({ accepted: true, expiresAt: new Date(T0 + 30_000).toISOString(), status: 'inCall' });
  });
  const ok = await run('input', 'test');
  assert.equal(ok.code, 0);
  assert.deepEqual(ok.out, [`Busy Light received the test: {"accepted":true,"expiresAt":"${new Date(T0 + 30_000).toISOString()}","status":"inCall"}`]);

  fake.on('http://127.0.0.1:8582/v1/status', () => json({ error: 'unauthorized', message: 'Missing or wrong key.' }, 401));
  const wrong = await run('input', 'test');
  assert.equal(wrong.code, 1);
  assert.deepEqual(wrong.err, ['The test failed (unauthorized, HTTP 401): Missing or wrong key.']);

  fake.on('http://127.0.0.1:8582/v1/status', () => networkError('ECONNREFUSED'));
  const down = await run('input', 'test');
  assert.deepEqual(down.err, ['The test failed (notListening): Nothing is listening on port 8582.']);

  writeConfig({});
  const off = await run('input', 'test');
  assert.equal(off.code, 1);
  assert.deepEqual(off.err, ['The status input is off. Turn it on in the plugin settings, save, and restart Homebridge.']);
});
