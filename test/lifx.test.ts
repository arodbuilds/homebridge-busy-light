import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import type os from 'node:os';
import { defaultConfig } from '../src/config.js';
import type { LifxConfig } from '../src/config.js';
import {
  KELVIN, LifxClient, MSG, SOURCE_ID, buildGetLabel, buildGetService, buildSetColor, buildSetPower, header, hexToHsb,
  interfaceBroadcasts, normalizeSerial, parseHeader, parseStateLabel,
} from '../src/lifx.js';
import { LightController, REDISCOVER_MS, lightFile, matchesBulb } from '../src/light.js';
import { FakeNetwork, fakeLog, tmpDir } from './helpers.js';
import type { FakeBulb } from './helpers.js';

const interfaces = (): NodeJS.Dict<os.NetworkInterfaceInfo[]> => ({
  lo: [{ address: '127.0.0.1', netmask: '255.0.0.0', family: 'IPv4', mac: '00:00:00:00:00:00', internal: true, cidr: '127.0.0.1/8' }],
  eth0: [{ address: '192.168.4.10', netmask: '255.255.255.0', family: 'IPv4', mac: '02:00:00:00:00:01', internal: false, cidr: '192.168.4.10/24' }],
});

const timings = { replyMs: 40, collectMs: 100 };
const DOOR: FakeBulb = { serial: 'd073d5000001', label: 'Office Door', host: '192.168.4.50', answers: true };
const DESK: FakeBulb = { serial: 'd073d5000002', label: 'Desk', host: '192.168.4.51', answers: true };

let net: FakeNetwork;
let dir: string;
let clock: number;
beforeEach(() => {
  net = new FakeNetwork();
  dir = tmpDir('busy-light-lifx');
  clock = Date.UTC(2026, 9, 8, 15);
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const client = () => new LifxClient({ socket: net.factory, timings, interfaces });

function controller(lifx: Partial<LifxConfig> = {}, log = fakeLog(), remember = true): { light: LightController; log: ReturnType<typeof fakeLog> } {
  const config = { ...defaultConfig().lifx, enabled: true, ...lifx };
  return { light: new LightController({ config, client: client(), log: log.log, storageDir: dir, remember, now: () => clock }), log };
}

test('hex to HSB', () => {
  assert.deepEqual(hexToHsb('#FF0000'), { h: 0, s: 1, b: 1 });
  assert.ok(Math.abs(hexToHsb('00FF00')!.h - 1 / 3) < 1e-9);
  assert.ok(Math.abs(hexToHsb('#0000ff')!.h - 2 / 3) < 1e-9);
  assert.deepEqual(hexToHsb('#000000'), { h: 0, s: 0, b: 0 });
  assert.deepEqual(hexToHsb('#808080'), { h: 0, s: 0, b: 128 / 255 });
  assert.equal(hexToHsb('off'), null);
});

test('SetColor bytes, tagged', () => {
  const c = buildSetColor({ h: 0.5, s: 1, b: 1 }, 100, 1000, { serial: null, sequence: 7, ackRequired: true });
  assert.equal(c.length, 49);
  assert.equal(c.readUInt16LE(0), 49);
  assert.equal(c.readUInt16LE(2), 0x3400);
  assert.equal(c.readUInt32LE(4), SOURCE_ID);
  assert.notEqual(c.readUInt32LE(4), 0, 'the source is non-zero');
  assert.deepEqual([...c.subarray(8, 16)], [0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual([...c.subarray(16, 22)], [0, 0, 0, 0, 0, 0]);
  assert.equal(c.readUInt8(22), 2, 'ack_required');
  assert.equal(c.readUInt8(23), 7);
  assert.equal(c.readUInt16LE(32), 102);
  assert.equal(c.readUInt8(36), 0);
  assert.equal(c.readUInt16LE(37), 32768);
  assert.equal(c.readUInt16LE(39), 65535);
  assert.equal(c.readUInt16LE(41), 65535);
  assert.equal(c.readUInt16LE(43), KELVIN);
  assert.equal(c.readUInt32LE(45), 1000);
});

test('brightness scaling', () => {
  const red = hexToHsb('#FF0000')!;
  const at = (pct: number) => buildSetColor(red, pct, 0, { serial: null, sequence: 0, ackRequired: true }).readUInt16LE(41);
  assert.equal(at(100), 65535);
  assert.equal(at(50), 32768);
  assert.equal(at(1), 655);
  const dim = buildSetColor(hexToHsb('#800000')!, 50, 0, { serial: null, sequence: 0, ackRequired: true }).readUInt16LE(41);
  assert.equal(dim, Math.round((128 / 255) * 0.5 * 65535), 'the color brightness and the setting multiply');
});

test('SetPower bytes, untagged to a serial', () => {
  const p = buildSetPower(true, 0, { serial: 'd073d5000001', sequence: 9, ackRequired: true });
  assert.equal(p.length, 42);
  assert.equal(p.readUInt16LE(0), 42);
  assert.equal(p.readUInt16LE(2), 0x1400);
  assert.equal(p.subarray(8, 14).toString('hex'), 'd073d5000001');
  assert.deepEqual([...p.subarray(14, 16)], [0, 0]);
  assert.equal(p.readUInt16LE(32), 117);
  assert.equal(p.readUInt16LE(36), 65535);
  assert.equal(p.readUInt32LE(38), 0);
  assert.equal(buildSetPower(false, 1000, { serial: null, sequence: 0, ackRequired: true }).readUInt16LE(36), 0);
});

test('GetService and GetLabel bytes', () => {
  const s = buildGetService(3);
  assert.equal(s.length, 36);
  assert.equal(s.readUInt16LE(0), 36);
  assert.equal(s.readUInt16LE(2), 0x3400);
  assert.equal(s.readUInt16LE(32), 2);
  assert.deepEqual([...s.subarray(8, 16)], [0, 0, 0, 0, 0, 0, 0, 0]);
  const l = buildGetLabel('d073d5000001', 4);
  assert.equal(l.length, 36);
  assert.equal(l.readUInt16LE(2), 0x1400);
  assert.equal(l.readUInt16LE(32), 23);
  assert.equal(parseHeader(l)?.serial, 'd073d5000001');
  const label = header(68, MSG.StateLabel, { serial: 'd073d5000001', sequence: 4, ackRequired: false });
  Buffer.from('Café door', 'utf8').copy(label, 36);
  assert.equal(parseStateLabel(label), 'Café door');
});

test('serial numbers and names', () => {
  assert.equal(normalizeSerial('D0:73:D5:00:00:01'), 'd073d5000001');
  assert.equal(normalizeSerial('Office Door'), null);
  assert.ok(matchesBulb('office door', DOOR));
  assert.ok(matchesBulb('D073D5000001', DOOR));
  assert.ok(!matchesBulb('Desk', DOOR));
  assert.ok(matchesBulb('', DOOR));
});

test('interface broadcast addresses', () => {
  assert.deepEqual(interfaceBroadcasts(interfaces()), ['192.168.4.255']);
});

test('a color is SetColor then SetPower on, each acknowledged; off is SetPower off', async () => {
  net.bulbs = [{ ...DOOR }];
  assert.equal(await client().sendColor(DOOR.host, DOOR.serial, '#FF0000', 100, 1000), true);
  assert.deepEqual(net.typesTo(DOOR.host), [102, 117]);
  assert.ok(net.sent.every((s) => s.port === 56700));
  assert.equal(net.sockets, net.closed, 'one socket per send, closed afterwards');
  net.sent = [];
  assert.equal(await client().sendColor(DOOR.host, DOOR.serial, 'off', 100, 0), true);
  assert.deepEqual(net.typesTo(DOOR.host), [117]);
  assert.equal(net.sent[0].buf.readUInt16LE(36), 0);
});

test('acknowledgements are matched by sequence', async () => {
  net.bulbs = [{ ...DOOR }];
  net.wrongSequence = true;
  assert.equal(await client().sendColor(DOOR.host, DOOR.serial, '#FF0000', 100, 1000), false);
});

test('three tries, then the bulb did not answer', async () => {
  net.bulbs = [{ ...DOOR, answers: false }];
  assert.equal(await client().sendColor(DOOR.host, DOOR.serial, '#00FF00', 100, 0), false);
  assert.deepEqual(net.typesTo(DOOR.host), [102, 102, 102, 117, 117, 117]);
  const sequences = net.sent.map((s) => s.buf.readUInt8(23));
  assert.equal(new Set(sequences.slice(0, 3)).size, 1, 'a retry repeats the same packet');
});

test('tagged to an address, untagged to a known serial', async () => {
  net.bulbs = [{ ...DOOR }];
  await client().sendColor(DOOR.host, null, '#FF0000', 100, 0);
  assert.ok(net.sent.every((s) => parseHeader(s.buf)!.tagged && parseHeader(s.buf)!.serial === '000000000000'));
  net.sent = [];
  await client().sendColor(DOOR.host, DOOR.serial, '#FF0000', 100, 0);
  assert.ok(net.sent.every((s) => !parseHeader(s.buf)!.tagged && parseHeader(s.buf)!.serial === DOOR.serial));
});

test('discovery broadcasts three times and reads each bulb label', async () => {
  net.bulbs = [{ ...DOOR }, { ...DESK }];
  const bulbs = await client().discover();
  assert.deepEqual(bulbs, [
    { serial: DESK.serial, label: 'Desk', host: DESK.host },
    { serial: DOOR.serial, label: 'Office Door', host: DOOR.host },
  ]);
  assert.deepEqual(net.sent.filter((s) => parseHeader(s.buf)!.type === MSG.GetService).map((s) => s.to),
    ['255.255.255.255', '192.168.4.255', '255.255.255.255', '192.168.4.255', '255.255.255.255', '192.168.4.255']);
});

test('choosing: exactly one bulb is used and remembered', async () => {
  net.bulbs = [{ ...DOOR }];
  const { light, log } = controller();
  await light.start();
  assert.deepEqual(light.state(), {
    enabled: true, label: 'Office Door', host: DOOR.host, found: 'discovered', lastSent: null, lastSentAt: null, answered: null,
  });
  assert.deepEqual(log.lines('info'), ['LIFX bulbs found: Office Door (192.168.4.50). Using Office Door.']);
  assert.deepEqual(JSON.parse(fs.readFileSync(lightFile(dir), 'utf8')), { serial: DOOR.serial, label: 'Office Door', host: DOOR.host });
  assert.equal(await light.send('#FF0000', 1000), true);
  const state = light.state();
  assert.equal(state.lastSent, '#FF0000');
  assert.equal(state.answered, true);
  assert.equal(state.lastSentAt, new Date(clock).toISOString());
});

test('choosing: several bulbs without lifx.bulb use none', async () => {
  net.bulbs = [{ ...DOOR }, { ...DESK }];
  const { light, log } = controller();
  await light.start();
  assert.equal(light.host, null);
  assert.deepEqual(log.lines('warn'), ['More than one LIFX bulb was found: Desk, Office Door. Enter the name of the one to use in the plugin settings.']);
  assert.equal(await light.send('#FF0000', 1000), null);
  assert.equal(fs.existsSync(lightFile(dir)), false);
});

test('choosing: several bulbs with lifx.bulb by name, or by serial', async () => {
  net.bulbs = [{ ...DOOR }, { ...DESK }];
  const byName = controller({ bulb: 'office DOOR' });
  await byName.light.start();
  assert.equal(byName.light.host, DOOR.host);
  assert.deepEqual(byName.log.lines('info'), ['LIFX bulbs found: Desk (192.168.4.51), Office Door (192.168.4.50). Using Office Door.']);

  const bySerial = controller({ bulb: 'D0:73:D5:00:00:02' });
  await bySerial.light.start();
  assert.equal(bySerial.light.host, DESK.host);
  assert.equal(bySerial.light.state().label, 'Desk');
});

test('choosing: lifx.bulb that matches no bulb', async () => {
  net.bulbs = [{ ...DESK }];
  const { light, log } = controller({ bulb: 'Office Door' });
  await light.start();
  assert.equal(light.host, null);
  assert.deepEqual(log.lines('warn'), ['No LIFX bulb named Office Door was found. Bulbs found: Desk (192.168.4.51).']);
});

test('choosing: none found, and discovery again at most every 5 minutes', async () => {
  const { light, log } = controller();
  await light.start();
  assert.deepEqual(log.lines('warn'), ['No LIFX bulb was found on the network. Check that it is on, or enter its IP address in the plugin settings.']);
  const broadcasts = () => net.sent.filter((s) => parseHeader(s.buf)!.type === MSG.GetService).length;
  const after = broadcasts();
  clock += REDISCOVER_MS - 1;
  assert.equal(await light.maintain(), false);
  assert.equal(broadcasts(), after, 'not yet');
  net.bulbs = [{ ...DOOR }];
  clock += 1;
  assert.equal(await light.maintain(), true, 'a bulb was chosen, so the caller sends the color');
  assert.equal(light.host, DOOR.host);
  assert.equal(log.lines('warn').length, 1, 'the no bulb line is not repeated');
});

test('choosing: lifx.host is used with no discovery and tagged packets', async () => {
  net.bulbs = [{ ...DOOR }];
  const { light } = controller({ host: DOOR.host, bulb: 'ignored' });
  await light.start();
  assert.deepEqual(light.state().found, 'configured');
  assert.equal(await light.send('#FF0000', 1000), true);
  assert.ok(!net.sent.some((s) => parseHeader(s.buf)!.type === MSG.GetService));
  assert.ok(net.sent.every((s) => parseHeader(s.buf)!.tagged));
});

test('the remembered IP is tried first, with no discovery', async () => {
  fs.writeFileSync(lightFile(dir), JSON.stringify({ serial: DOOR.serial, label: 'Office Door', host: DOOR.host }));
  net.bulbs = [{ ...DOOR }];
  const { light } = controller();
  await light.start();
  assert.equal(light.state().found, 'remembered');
  assert.equal(await light.send('#FF0000', 1000), true);
  assert.equal(net.sent.filter((s) => parseHeader(s.buf)!.type === MSG.GetService).length, 0);
  assert.ok(net.sent.every((s) => s.to === DOOR.host && !parseHeader(s.buf)!.tagged));
});

test('a remembered IP that does not answer sends discovery out at once', async () => {
  fs.writeFileSync(lightFile(dir), JSON.stringify({ serial: DOOR.serial, label: 'Office Door', host: '192.168.4.40' }));
  net.bulbs = [{ ...DOOR }];
  const { light, log } = controller();
  assert.equal(await light.send('#FF0000', 1000), true, 'the color reached the bulb at its new address');
  assert.equal(light.host, DOOR.host);
  assert.equal(light.state().found, 'discovered');
  assert.equal(JSON.parse(fs.readFileSync(lightFile(dir), 'utf8')).host, DOOR.host);
  assert.deepEqual(log.lines('warn'), ['The LIFX bulb at 192.168.4.40 did not answer.']);
});

test('a remembered bulb that does not fit lifx.bulb is not used', async () => {
  fs.writeFileSync(lightFile(dir), JSON.stringify({ serial: DOOR.serial, label: 'Office Door', host: DOOR.host }));
  net.bulbs = [{ ...DOOR }, { ...DESK }];
  const { light } = controller({ bulb: 'Desk' });
  await light.start();
  assert.equal(light.host, DESK.host);
});

test('rediscovery after three silent sends when the bulb has a new IP', async () => {
  net.bulbs = [{ ...DOOR }];
  const { light, log } = controller();
  await light.start();
  net.bulbs = [{ ...DOOR, host: '192.168.4.77' }];
  clock += REDISCOVER_MS;
  assert.equal(await light.send('#FF0000', 0), false);
  assert.equal(await light.send('#FF0000', 0), false);
  assert.equal(light.host, DOOR.host, 'two silent sends do not rediscover');
  assert.equal(await light.send('#FF0000', 0), true, 'the third silent send rediscovers and resends');
  assert.equal(light.host, '192.168.4.77');
  assert.deepEqual(log.lines('warn'), ['The LIFX bulb at 192.168.4.50 did not answer.']);
  assert.deepEqual(log.lines('debug'), ['The LIFX bulb at 192.168.4.50 did not answer.', 'The LIFX bulb at 192.168.4.50 did not answer.'],
    'repeats are debug');
  assert.deepEqual(log.lines('info'), [
    'LIFX bulbs found: Office Door (192.168.4.50). Using Office Door.',
    'LIFX bulbs found: Office Door (192.168.4.77). Using Office Door.',
    'The LIFX bulb at 192.168.4.77 is answering again.',
  ]);
  assert.equal(JSON.parse(fs.readFileSync(lightFile(dir), 'utf8')).host, '192.168.4.77');
});

test('a silent bulb that comes back', async () => {
  net.bulbs = [{ ...DOOR, answers: false }];
  const { light, log } = controller({ host: DOOR.host });
  assert.equal(await light.send('#FF0000', 0), false);
  assert.equal(await light.send('#FF0000', 0), false);
  net.bulbs[0].answers = true;
  assert.equal(await light.send('#FF0000', 0), true);
  assert.deepEqual(log.lines('warn'), ['The LIFX bulb at 192.168.4.50 did not answer.']);
  assert.deepEqual(log.lines('info'), ['The LIFX bulb at 192.168.4.50 is answering again.']);
});

test('the CLI never writes light.json', async () => {
  net.bulbs = [{ ...DOOR }];
  const { light } = controller({}, fakeLog(), false);
  await light.start();
  assert.equal(light.host, DOOR.host);
  assert.equal(fs.existsSync(lightFile(dir)), false);
});

test('a disabled light sends nothing', async () => {
  net.bulbs = [{ ...DOOR }];
  const { light } = controller({ enabled: false });
  assert.equal(await light.send('#FF0000', 0), null);
  assert.equal(await light.maintain(), false);
  assert.equal(net.sent.length, 0);
});
