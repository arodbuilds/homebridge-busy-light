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
import { LightController, REDISCOVER_MS, lightFile, matchesBulb, readRememberedBulbs, withRemembered } from '../src/light.js';
import { FakeNetwork, fakeLog, settle, tmpDir } from './helpers.js';
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

/** The first entry of the state file's `lights`, as `light` was for one bulb. */
const first = (light: LightController) => light.lights()[0];
/** The first bulb's address, or null while none is chosen. */
const hostOf = (light: LightController) => light.hosts[0] ?? null;
/** A send's outcome for the tests of one bulb: whether every bulb answered, or null when there was none to send to. */
async function sent(light: LightController, color: string, durationMs: number): Promise<boolean | null> {
  const results = await light.send(color, durationMs);
  return results.length === 0 ? null : results.every((r) => r.answered);
}

test('choosing: exactly one bulb is used and remembered', async () => {
  net.bulbs = [{ ...DOOR }];
  const { light, log } = controller();
  await light.start();
  assert.deepEqual(first(light), {
    enabled: true, label: 'Office Door', serial: DOOR.serial, host: DOOR.host, found: 'discovered', lastSent: null, lastSentAt: null, answered: null,
  });
  assert.deepEqual(log.lines('info'), ['LIFX bulbs found: Office Door (192.168.4.50). Using Office Door.']);
  assert.deepEqual(JSON.parse(fs.readFileSync(lightFile(dir), 'utf8')), { bulbs: [{ serial: DOOR.serial, label: 'Office Door', host: DOOR.host }] });
  assert.equal(await sent(light, '#FF0000', 1000), true);
  const state = first(light);
  assert.equal(state.lastSent, '#FF0000');
  assert.equal(state.answered, true);
  assert.equal(state.lastSentAt, new Date(clock).toISOString());
});

test('choosing: several bulbs without lifx.bulbs use none', async () => {
  net.bulbs = [{ ...DOOR }, { ...DESK }];
  const { light, log } = controller();
  await light.start();
  assert.equal(hostOf(light), null);
  assert.deepEqual(log.lines('warn'), ['More than one LIFX bulb was found: Desk, Office Door. Choose the bulbs to use in the plugin settings.']);
  assert.equal(await sent(light, '#FF0000', 1000), null);
  assert.equal(fs.existsSync(lightFile(dir)), false);
});

test('choosing: several bulbs with lifx.bulb by name, or by serial', async () => {
  net.bulbs = [{ ...DOOR }, { ...DESK }];
  const byName = controller({ bulbs: ['office DOOR'] });
  await byName.light.start();
  assert.equal(hostOf(byName.light), DOOR.host);
  assert.deepEqual(byName.log.lines('info'), ['LIFX bulbs found: Desk (192.168.4.51), Office Door (192.168.4.50). Using Office Door.']);

  const bySerial = controller({ bulbs: ['D0:73:D5:00:00:02'] });
  await bySerial.light.start();
  assert.equal(hostOf(bySerial.light), DESK.host);
  assert.equal(first(bySerial.light).label, 'Desk');
});

test('choosing: lifx.bulb that matches no bulb', async () => {
  net.bulbs = [{ ...DESK }];
  const { light, log } = controller({ bulbs: ['Office Door'] });
  await light.start();
  assert.equal(hostOf(light), null);
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
  assert.equal(hostOf(light), DOOR.host);
  assert.equal(log.lines('warn').length, 1, 'the no bulb line is not repeated');
});

test('choosing: lifx.host is used with no discovery and tagged packets', async () => {
  net.bulbs = [{ ...DOOR }];
  const { light } = controller({ hosts: [DOOR.host], bulbs: ['ignored'] });
  await light.start();
  assert.deepEqual(first(light).found, 'configured');
  assert.equal(await sent(light, '#FF0000', 1000), true);
  assert.ok(!net.sent.some((s) => parseHeader(s.buf)!.type === MSG.GetService));
  assert.ok(net.sent.every((s) => parseHeader(s.buf)!.tagged));
});

test('the remembered IP is tried first, with no discovery', async () => {
  fs.writeFileSync(lightFile(dir), JSON.stringify({ serial: DOOR.serial, label: 'Office Door', host: DOOR.host }));
  net.bulbs = [{ ...DOOR }];
  const { light } = controller();
  await light.start();
  assert.equal(first(light).found, 'remembered');
  assert.equal(await sent(light, '#FF0000', 1000), true);
  assert.equal(net.sent.filter((s) => parseHeader(s.buf)!.type === MSG.GetService).length, 0);
  assert.ok(net.sent.every((s) => s.to === DOOR.host && !parseHeader(s.buf)!.tagged));
});

test('a remembered IP that does not answer sends discovery out at once', async () => {
  fs.writeFileSync(lightFile(dir), JSON.stringify({ serial: DOOR.serial, label: 'Office Door', host: '192.168.4.40' }));
  net.bulbs = [{ ...DOOR }];
  const { light, log } = controller();
  assert.equal(await sent(light, '#FF0000', 1000), true, 'the color reached the bulb at its new address');
  assert.equal(hostOf(light), DOOR.host);
  assert.equal(first(light).found, 'discovered');
  assert.equal(JSON.parse(fs.readFileSync(lightFile(dir), 'utf8')).bulbs[0].host, DOOR.host);
  assert.deepEqual(log.lines('warn'), ['The LIFX bulb at 192.168.4.40 did not answer.']);
});

test('a remembered bulb that does not fit lifx.bulbs is not used', async () => {
  fs.writeFileSync(lightFile(dir), JSON.stringify({ serial: DOOR.serial, label: 'Office Door', host: DOOR.host }));
  net.bulbs = [{ ...DOOR }, { ...DESK }];
  const { light } = controller({ bulbs: ['Desk'] });
  await light.start();
  assert.equal(hostOf(light), DESK.host);
});

test('rediscovery after three silent sends when the bulb has a new IP', async () => {
  net.bulbs = [{ ...DOOR }];
  const { light, log } = controller();
  await light.start();
  net.bulbs = [{ ...DOOR, host: '192.168.4.77' }];
  clock += REDISCOVER_MS;
  assert.equal(await sent(light, '#FF0000', 0), false);
  assert.equal(await sent(light, '#FF0000', 0), false);
  assert.equal(hostOf(light), DOOR.host, 'two silent sends do not rediscover');
  assert.equal(await sent(light, '#FF0000', 0), true, 'the third silent send rediscovers and resends');
  assert.equal(hostOf(light), '192.168.4.77');
  assert.deepEqual(log.lines('warn'), ['The LIFX bulb at 192.168.4.50 did not answer.']);
  assert.deepEqual(log.lines('debug'), ['The LIFX bulb at 192.168.4.50 did not answer.', 'The LIFX bulb at 192.168.4.50 did not answer.'],
    'repeats are debug');
  assert.deepEqual(log.lines('info'), [
    'LIFX bulbs found: Office Door (192.168.4.50). Using Office Door.',
    'LIFX bulbs found: Office Door (192.168.4.77). Using Office Door.',
    'The LIFX bulb at 192.168.4.77 is answering again.',
  ]);
  assert.equal(JSON.parse(fs.readFileSync(lightFile(dir), 'utf8')).bulbs[0].host, '192.168.4.77');
});

test('a silent bulb that comes back', async () => {
  net.bulbs = [{ ...DOOR, answers: false }];
  const { light, log } = controller({ hosts: [DOOR.host] });
  assert.equal(await sent(light, '#FF0000', 0), false);
  assert.equal(await sent(light, '#FF0000', 0), false);
  net.bulbs[0].answers = true;
  assert.equal(await sent(light, '#FF0000', 0), true);
  assert.deepEqual(log.lines('warn'), ['The LIFX bulb at 192.168.4.50 did not answer.']);
  assert.deepEqual(log.lines('info'), ['The LIFX bulb at 192.168.4.50 is answering again.']);
});

test('the CLI never writes light.json', async () => {
  net.bulbs = [{ ...DOOR }];
  const { light } = controller({}, fakeLog(), false);
  await light.start();
  assert.equal(hostOf(light), DOOR.host);
  assert.equal(fs.existsSync(lightFile(dir)), false);
});

test('a disabled light sends nothing', async () => {
  net.bulbs = [{ ...DOOR }];
  const { light } = controller({ enabled: false });
  assert.equal(await sent(light, '#FF0000', 0), null);
  assert.equal(await light.maintain(), false);
  assert.equal(net.sent.length, 0);
});

// Build 3.2: a chosen bulb is never replaced by another unless lifx.bulb names it (SPEC 13.2 item 4).

const KITCHEN: FakeBulb = { serial: 'd073d5000003', label: 'Kitchen', host: '192.168.4.52', answers: true };
const colorsTo = (host: string) => net.sent.filter((s) => s.to === host && [MSG.SetColor, MSG.SetPower].includes(parseHeader(s.buf)!.type as 102 | 117));

test('the office bulb goes silent and a kitchen bulb answers: the kitchen bulb is never sent a color (SPEC 13.2 item 4)', async () => {
  net.bulbs = [{ ...DOOR }];
  const { light, log } = controller();
  await light.start();
  assert.equal(await sent(light, '#00FF00', 1000), true);
  // The office bulb is switched off at the wall; a kitchen bulb is the only one that answers.
  net.bulbs = [{ ...KITCHEN }];
  for (let round = 0; round < 3; round++) {
    clock += REDISCOVER_MS;
    for (let i = 0; i < 3; i++) {
      assert.equal(await sent(light, '#FF0000', 0), false);
    }
  }
  assert.ok(net.sent.filter((s) => parseHeader(s.buf)!.type === MSG.GetService).length > 3, 'discovery kept looking');
  assert.deepEqual(colorsTo(KITCHEN.host), []);
  assert.equal(hostOf(light), DOOR.host);
  assert.equal(first(light).label, 'Office Door');
  assert.deepEqual(JSON.parse(fs.readFileSync(lightFile(dir), 'utf8')), { bulbs: [{ serial: DOOR.serial, label: 'Office Door', host: DOOR.host }] });
  assert.ok(!log.all().some((l) => l.includes('Kitchen')), 'no line says the kitchen bulb is used');

  // The office bulb comes back at a new address: discovery finds it by its serial number.
  net.bulbs = [{ ...KITCHEN }, { ...DOOR, host: '192.168.4.77' }];
  clock += REDISCOVER_MS;
  assert.equal(await sent(light, '#FF0000', 0), true);
  assert.equal(hostOf(light), '192.168.4.77');
  assert.deepEqual(colorsTo(KITCHEN.host), []);
});

test('a remembered office bulb that does not answer is kept when only a kitchen bulb answers (SPEC 13.2 item 4)', async () => {
  fs.writeFileSync(lightFile(dir), JSON.stringify({ serial: DOOR.serial, label: 'Office Door', host: DOOR.host }));
  net.bulbs = [{ ...KITCHEN }];
  const { light } = controller();
  assert.equal(await sent(light, '#FF0000', 1000), false, 'the first send fails and discovery runs at once');
  assert.equal(hostOf(light), DOOR.host);
  assert.equal(first(light).found, 'remembered');
  assert.deepEqual(colorsTo(KITCHEN.host), []);
  assert.equal(await light.maintain(), false, 'a bulb is chosen, so nothing new to send');
});

test('lifx.bulb naming a bulb by name moves to the bulb that has that name when the chosen one is gone (SPEC 13.2 item 4)', async () => {
  net.bulbs = [{ ...DESK }];
  const { light } = controller({ bulbs: ['Desk'] });
  await light.start();
  assert.equal(hostOf(light), DESK.host);
  const NEW_DESK: FakeBulb = { serial: 'd073d5000009', label: 'Desk', host: '192.168.4.59', answers: true };
  net.bulbs = [{ ...KITCHEN }, { ...NEW_DESK }];
  clock += REDISCOVER_MS;
  for (let i = 0; i < 2; i++) {
    assert.equal(await sent(light, '#FF0000', 0), false);
  }
  assert.equal(await sent(light, '#FF0000', 0), true, 'the third silent send rediscovers and moves to the bulb named Desk');
  assert.equal(hostOf(light), NEW_DESK.host);
  assert.deepEqual(colorsTo(KITCHEN.host), []);
});

// Build 3.2: several bulbs (SPEC 13.3, C8 of the build prompt): every chosen bulb shows the status, each on its own.

const STATUS: FakeBulb = { serial: 'd073d5000004', label: 'Status Light', host: '192.168.4.21', answers: true };
const powersTo = (host: string) => net.sent.filter((s) => s.to === host && parseHeader(s.buf)!.type === MSG.SetPower);

test('two bulbs chosen, by serial and by name, are both sent every color, untagged to each (SPEC 13.3 item 1)', async () => {
  net.bulbs = [{ ...DOOR }, { ...STATUS }, { ...DESK }];
  const { light, log } = controller({ bulbs: [STATUS.serial, 'office door'] });
  await light.start();
  assert.deepEqual(light.hosts, [STATUS.host, DOOR.host], 'in the order of lifx.bulbs');
  assert.deepEqual(log.lines('info'),
    ['LIFX bulbs found: Desk (192.168.4.51), Office Door (192.168.4.50), Status Light (192.168.4.21). Using Status Light, Office Door.']);
  assert.deepEqual(JSON.parse(fs.readFileSync(lightFile(dir), 'utf8')), { bulbs: [
    { serial: STATUS.serial, label: 'Status Light', host: STATUS.host }, { serial: DOOR.serial, label: 'Office Door', host: DOOR.host },
  ] });
  net.sent = [];
  assert.deepEqual(await light.send('#FF0000', 1000), [
    { label: 'Status Light', host: STATUS.host, answered: true }, { label: 'Office Door', host: DOOR.host, answered: true },
  ]);
  assert.deepEqual(net.typesTo(STATUS.host), [MSG.SetColor, MSG.SetPower]);
  assert.deepEqual(net.typesTo(DOOR.host), [MSG.SetColor, MSG.SetPower]);
  assert.deepEqual(net.typesTo(DESK.host), [], 'a bulb not chosen is sent nothing');
  assert.ok(net.sent.every((s) => !parseHeader(s.buf)!.tagged && parseHeader(s.buf)!.serial === (s.to === DOOR.host ? DOOR.serial : STATUS.serial)));
  assert.equal(net.sockets - net.closed, 0, 'one socket per bulb, each closed');
  await light.send('off', 0);
  assert.deepEqual([powersTo(STATUS.host).length, powersTo(DOOR.host).length], [2, 2], 'off goes to both');
  assert.deepEqual(light.lights().map((l) => [l.label, l.found, l.lastSent, l.answered]), [
    ['Status Light', 'discovered', 'off', true], ['Office Door', 'discovered', 'off', true],
  ]);
});

test('one silent bulb does not delay the other: the answering bulb has its color while the silent one still tries (SPEC 13.3 item 1)', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const done: string[] = [];
  class Gated extends LifxClient {
    override async sendColor(host: string): Promise<boolean> {
      if (host === STATUS.host) {
        await gate; // three tries of each packet, unanswered
        clock += 3000;
        done.push(host);
        return false;
      }
      done.push(host);
      return true;
    }
  }
  const log = fakeLog();
  const light = new LightController({ config: { ...defaultConfig().lifx, enabled: true, hosts: [STATUS.host, DOOR.host] }, client: new Gated(),
    log: log.log, storageDir: dir, now: () => clock });
  const t0 = clock;
  const sending = light.send('#FF0000', 1000);
  await settle();
  assert.deepEqual(done, [DOOR.host], 'the second bulb in the list did not wait for the first');
  assert.deepEqual(light.lights().map((l) => [l.host, l.answered, l.lastSentAt]), [
    [STATUS.host, null, null], [DOOR.host, true, new Date(t0).toISOString()],
  ]);
  release();
  assert.deepEqual((await sending).map((r) => r.answered), [false, true]);
  assert.deepEqual(log.lines('warn'), ['The LIFX bulb at 192.168.4.21 did not answer.'], 'the silent line is for that bulb alone');
});

test('lifx.host with several addresses: each is a bulb, sent tagged, with no discovery (SPEC 13.2 item 2.1)', async () => {
  net.bulbs = [{ ...DOOR }, { ...STATUS }];
  const { light } = controller({ hosts: [DOOR.host, STATUS.host] });
  await light.start();
  assert.deepEqual(light.lights().map((l) => [l.host, l.found]), [[DOOR.host, 'configured'], [STATUS.host, 'configured']]);
  assert.deepEqual((await light.send('#00FF00', 1000)).map((r) => r.answered), [true, true]);
  assert.ok(!net.sent.some((s) => parseHeader(s.buf)!.type === MSG.GetService));
  assert.ok(net.sent.every((s) => parseHeader(s.buf)!.tagged));
});

test('light.json: the old single object reads as one bulb, and a list of two is used with no discovery (SPEC 13.2 item 3)', async () => {
  fs.writeFileSync(lightFile(dir), JSON.stringify({ serial: DOOR.serial, label: 'Office Door', host: DOOR.host }));
  net.bulbs = [{ ...DOOR }, { ...STATUS }];
  const old = controller({ bulbs: [DOOR.serial] });
  await old.light.start();
  assert.deepEqual(old.light.lights().map((l) => [l.host, l.found]), [[DOOR.host, 'remembered']]);

  fs.writeFileSync(lightFile(dir), JSON.stringify({ bulbs: [{ serial: DOOR.serial, label: 'Office Door', host: DOOR.host },
    { serial: STATUS.serial, label: 'Status Light', host: STATUS.host }] }));
  net.sent = [];
  const { light } = controller({ bulbs: ['Status Light', DOOR.serial] });
  await light.start();
  assert.deepEqual(light.lights().map((l) => [l.label, l.found]), [['Status Light', 'remembered'], ['Office Door', 'remembered']]);
  assert.deepEqual((await light.send('#FF0000', 1000)).map((r) => r.answered), [true, true]);
  assert.equal(net.sent.filter((s) => parseHeader(s.buf)!.type === MSG.GetService).length, 0);
  // With no bulbs named, two remembered bulbs are not used: discovery decides (SPEC 17).
  const unnamed = controller();
  await unnamed.light.start();
  assert.deepEqual(unnamed.light.hosts, []);
  assert.deepEqual(unnamed.log.lines('warn'),
    ['More than one LIFX bulb was found: Office Door, Status Light. Choose the bulbs to use in the plugin settings.']);
});

test('one of two chosen bulbs missing is kept and retried, never replaced by one that answers, its line alone (SPEC 13.2 item 4)', async () => {
  net.bulbs = [{ ...DOOR }, { ...STATUS }];
  const { light, log } = controller({ bulbs: [DOOR.serial, 'Status Light'] });
  await light.start();
  assert.deepEqual(light.hosts, [DOOR.host, STATUS.host]);
  // Status Light is switched off at the wall; a kitchen bulb answers.
  net.bulbs = [{ ...DOOR }, { ...KITCHEN }];
  net.sent = [];
  for (let round = 0; round < 2; round++) {
    clock += REDISCOVER_MS;
    for (let i = 0; i < 3; i++) {
      assert.deepEqual((await light.send('#FF0000', 0)).map((r) => [r.host, r.answered]), [[DOOR.host, true], [STATUS.host, false]]);
    }
  }
  assert.ok(net.sent.some((s) => parseHeader(s.buf)!.type === MSG.GetService), 'the silent bulb sent discovery out');
  assert.deepEqual(colorsTo(KITCHEN.host), []);
  assert.deepEqual(light.hosts, [DOOR.host, STATUS.host], 'kept');
  assert.deepEqual(log.lines('warn'), [
    'The LIFX bulb at 192.168.4.21 did not answer.',
    'No LIFX bulb named Status Light was found. Bulbs found: Kitchen (192.168.4.52), Office Door (192.168.4.50).',
  ]);
  assert.equal(log.lines('info').at(-1), 'LIFX bulbs found: Kitchen (192.168.4.52), Office Door (192.168.4.50). Using Office Door.');
  // Back at a new address: found again by its serial number, and only it is sent the color again.
  net.bulbs = [{ ...DOOR }, { ...KITCHEN }, { ...STATUS, host: '192.168.4.88' }];
  clock += REDISCOVER_MS;
  net.sent = [];
  assert.deepEqual((await light.send('#FF0000', 0)).map((r) => [r.host, r.answered]), [[DOOR.host, true], ['192.168.4.88', true]]);
  assert.equal(colorsTo(DOOR.host).length, 2, 'the answering bulb is sent the color once (SetColor and SetPower)');
  assert.deepEqual(colorsTo(KITCHEN.host), []);
});

test('a bulb named but not found at startup is looked for every 5 minutes, and chosen later beside the first (SPEC 13.2 item 4)', async () => {
  net.bulbs = [{ ...DOOR }];
  const { light, log } = controller({ bulbs: [DOOR.serial, 'Status Light'] });
  await light.start();
  assert.deepEqual(light.hosts, [DOOR.host], 'the bulb found is used meanwhile');
  assert.deepEqual(log.lines('warn'), ['No LIFX bulb named Status Light was found. Bulbs found: Office Door (192.168.4.50).']);
  assert.equal(await light.maintain(), false, 'not before 5 minutes');
  net.bulbs = [{ ...DOOR }, { ...STATUS }];
  clock += REDISCOVER_MS;
  assert.equal(await light.maintain(), true, 'chosen later: the caller sends the current color');
  assert.deepEqual(light.hosts, [DOOR.host, STATUS.host]);
  clock += REDISCOVER_MS;
  assert.equal(await light.maintain(), false, 'every bulb found: no more discovery');
});

// Build 3.2, from the review before the pull request: rediscovery and the bulbs' own lanes (SPEC 13.2 item 4, 13.3).

const setColorsTo = (host: string) => net.sent.filter((s) => s.to === host && parseHeader(s.buf)!.type === MSG.SetColor);

test('two chosen bulbs that both moved are each sent the color at the address the one rediscovery finds (SPEC 13.3 item 2)', async () => {
  net.bulbs = [{ ...DOOR }, { ...STATUS }];
  const { light } = controller({ bulbs: [DOOR.serial, STATUS.serial] });
  await light.start();
  // A power cut: both bulbs come back at new addresses.
  net.bulbs = [{ ...DOOR, host: '192.168.4.77' }, { ...STATUS, host: '192.168.4.88' }];
  clock += REDISCOVER_MS;
  await light.send('#FF0000', 0);
  await light.send('#FF0000', 0);
  net.sent = [];
  const results = await light.send('#FF0000', 0);
  await light.settled();
  assert.deepEqual(light.hosts, ['192.168.4.77', '192.168.4.88']);
  assert.deepEqual(results.map((r) => [r.host, r.answered]), [['192.168.4.77', true], ['192.168.4.88', true]]);
  assert.deepEqual([setColorsTo('192.168.4.77').length, setColorsTo('192.168.4.88').length], [1, 1], 'each once');
  assert.equal(net.sent.filter((s) => parseHeader(s.buf)!.type === MSG.GetService).length / 2, 3, 'one discovery for both');
});

test('a bulb chosen by the discovery another bulb\'s silent send sent out is sent the last color (SPEC 13.3 item 4)', async () => {
  net.bulbs = [{ ...DOOR }];
  const { light } = controller({ bulbs: [DOOR.serial, 'Status Light'] });
  await light.start();
  assert.deepEqual(light.hosts, [DOOR.host]);
  // Office Door is switched off at the wall; Status Light is switched on.
  net.bulbs = [{ ...STATUS }];
  clock += REDISCOVER_MS;
  for (let i = 0; i < 3; i++) {
    await light.send('#FF0000', 0);
  }
  await light.settled();
  assert.deepEqual(light.hosts, [DOOR.host, STATUS.host]);
  assert.equal(setColorsTo(STATUS.host).length, 1, 'chosen later and sent the last color at once');
  assert.equal(setColorsTo(STATUS.host)[0].buf.readUInt32LE(45), 1000, 'with the 1 second fade (SPEC 8.2 item 4)');
  assert.equal(await light.maintain(), false, 'nothing left to look for');
});

test('two entries of lifx.bulbs naming the same bulb: no discovery at a restart, and none every 5 minutes after (SPEC 13.2 items 2 to 4)', async () => {
  const discoveries = () => net.sent.filter((s) => parseHeader(s.buf)!.type === MSG.GetService).length;
  fs.writeFileSync(lightFile(dir), JSON.stringify({ bulbs: [{ serial: DOOR.serial, label: 'Office Door', host: DOOR.host }] }));
  net.bulbs = [{ ...DOOR }];
  const remembered = controller({ bulbs: ['Office Door', DOOR.serial] });
  await remembered.light.start();
  assert.equal(discoveries(), 0, 'the remembered bulb fits both entries');
  fs.rmSync(lightFile(dir));
  const { light } = controller({ bulbs: ['office door', DOOR.serial] });
  await light.start();
  assert.deepEqual(light.hosts, [DOOR.host]);
  const after = discoveries();
  for (let i = 0; i < 3; i++) {
    clock += REDISCOVER_MS;
    await light.maintain();
  }
  assert.equal(discoveries(), after, 'every bulb wanted is found');
});

test('a bulb given by its address in lifx.host is not named from light.json, and a serial number matches by itself alone (SPEC 10.1 item 5, the second review)',
  async () => {
    // light.json from an earlier discovery, when Desk had this address. With lifx.host set the plugin never runs discovery,
    // so light.json is never rewritten, and the address may now belong to another bulb.
    fs.writeFileSync(lightFile(dir), JSON.stringify({ bulbs: [{ serial: DESK.serial, label: 'Desk', host: DOOR.host }] }));
    net.bulbs = [{ ...DOOR, answers: false }];
    const { light } = controller({ hosts: [DOOR.host] });
    await light.start();
    await light.send('#FF0000', 1000);
    assert.deepEqual(withRemembered(light.lights(), readRememberedBulbs(dir)).map((l) => [l.label, l.serial, l.host, l.found, l.answered]),
      [[null, null, DOOR.host, 'configured', false]]);

    const entry = { enabled: true, label: null, host: DOOR.host, found: 'remembered' as const, lastSent: null, lastSentAt: null, answered: false };
    const remembered = [{ serial: DESK.serial, label: 'Desk', host: DOOR.host }, { serial: DOOR.serial, label: 'Office Door', host: '192.168.4.40' }];
    assert.deepEqual(withRemembered([{ ...entry, serial: DOOR.serial }], remembered).map((l) => [l.label, l.serial]), [['Office Door', DOOR.serial]],
      'by its serial number, not by the address another bulb had');
    assert.deepEqual(withRemembered([{ ...entry, serial: null }], remembered).map((l) => [l.label, l.serial]), [[null, null]], 'a null serial stays unnamed');
    assert.deepEqual(withRemembered([entry], remembered).map((l) => [l.label, l.serial]), [['Desk', DESK.serial]],
      'a state file written before 1.0.0, with no serial, by its address');
  });

test('a bulb of lifx.bulbs never found has an entry marked not answering after a search, in the order of lifx.bulbs (SPEC 10.1 item 5, the release review)',
  async () => {
    const MISSING = 'd073d5000003';
    net.bulbs = [{ ...DOOR }];
    const { light, log } = controller({ bulbs: [MISSING, DOOR.serial] });
    const starting = light.start();
    assert.deepEqual(light.lights().map((l) => [l.host, l.answered]), [[null, null]], 'while the first search runs: not found yet');
    await starting;
    const row = (l: { label: string | null; serial?: string | null; host: string | null; found: string | null; answered: boolean | null }) =>
      [l.label, l.serial, l.host, l.found, l.answered];
    assert.deepEqual(light.lights().map(row), [[null, MISSING, null, null, false], ['Office Door', DOOR.serial, DOOR.host, 'discovered', null]]);
    assert.deepEqual(withRemembered(light.lights(), readRememberedBulbs(dir)).map(row)[0], [null, MISSING, null, null, false], 'nothing in light.json');
    assert.deepEqual(log.lines('warn'), [`No LIFX bulb named ${MISSING} was found. Bulbs found: Office Door (${DOOR.host}).`],
      'the log line is unchanged');
    assert.deepEqual((await light.send('#FF0000', 1000)).map((r) => r.host), [DOOR.host], 'only the bulb found is sent the color');

    // Found later: rediscovery chooses it, and its entry is the bulb's own.
    net.bulbs = [{ ...DOOR }, { serial: MISSING, label: 'Floor', host: '192.168.4.52', answers: true }];
    clock += REDISCOVER_MS;
    assert.equal(await light.maintain(), true);
    assert.deepEqual(light.lights().map(row),
      [['Floor', MISSING, '192.168.4.52', 'discovered', null], ['Office Door', DOOR.serial, DOOR.host, 'discovered', true]]);
  });

test('a bulb never found that lifx.bulbs names keeps its name, and with no bulb found each bulb wanted has an entry (SPEC 10.1 item 5, the release review)',
  async () => {
    net.bulbs = [{ ...DOOR }];
    const named = controller({ bulbs: ['Kitchen', DOOR.serial] });
    await named.light.start();
    assert.deepEqual(named.light.lights().map((l) => [l.label, l.serial, l.host, l.answered]),
      [['Kitchen', null, null, false], ['Office Door', DOOR.serial, DOOR.host, null]]);
    net.bulbs = [];
    fs.rmSync(lightFile(dir), { force: true });
    const none = controller({ bulbs: [DOOR.serial, DESK.serial] });
    await none.light.start();
    assert.deepEqual(none.light.lights().map((l) => [l.label, l.serial, l.host, l.answered]),
      [[null, DOOR.serial, null, false], [null, DESK.serial, null, false]],
      'in place of the one entry with no address');
    // Without lifx.bulbs, a search that finds no bulb still gives the one entry with no address.
    const unnamed = controller();
    await unnamed.light.start();
    assert.deepEqual(unnamed.light.lights().map((l) => [l.host, l.answered]), [[null, null]]);
  });
