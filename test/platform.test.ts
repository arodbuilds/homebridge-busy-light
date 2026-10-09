import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import * as hap from '@homebridge/hap-nodejs';
import type { API, Logging, PlatformConfig } from 'homebridge';
import { LifxClient } from '../src/lifx.js';
import { SENSOR_KEYS } from '../src/model.js';
import type { SensorKey, Status } from '../src/model.js';
import { packageVersion } from '../src/names.js';
import { BusyLightPlatform, CALL_SWITCH_UUID_SEED, OVERRIDE_UUID_SEED, WORKING_SWITCH_UUID_SEED, sensorOn, sensorUuidSeed } from '../src/platform.js';
import type { PlatformDeps } from '../src/platform.js';
import { readState } from '../src/state.js';
import type { AddressDeps } from '../src/addresses.js';
import { addressChanged } from '../src/messages.js';
import type { ServerLike } from '../src/status-api.js';
import { FakeClock, FakeFetch, FakeMdns, FakeNetwork, fakeLog, icsOf, settle, text, tmpDir } from './helpers.js';

const { Characteristic: C, Service: S } = hap;

/** Enough of PlatformAccessory for the platform: a name, a UUID, a context and HAP services. */
class FakeAccessory {
  context: Record<string, unknown> = {};
  services: hap.Service[] = [new S.AccessoryInformation()];

  constructor(public displayName: string, public UUID: string) {}

  getService(type: { UUID: string } | string): hap.Service | undefined {
    return this.services.find((s) => (typeof type === 'string' ? s.displayName === type : s.UUID === type.UUID));
  }

  addService(type: typeof hap.Service, name?: string): hap.Service {
    const service = new (type as unknown as new (name?: string) => hap.Service)(name);
    this.services.push(service);
    return service;
  }
}

class FakeApi extends EventEmitter {
  hap = hap;
  platformAccessory = FakeAccessory;
  registered: FakeAccessory[] = [];
  unregistered: FakeAccessory[] = [];
  updated = 0;

  constructor(private readonly dir: string) {
    super();
  }

  user = { storagePath: () => this.dir };

  registerPlatformAccessories(plugin: string, platform: string, accessories: FakeAccessory[]): void {
    assert.equal(plugin, 'homebridge-busy-light');
    assert.equal(platform, 'BusyLight');
    this.registered.push(...accessories);
  }

  unregisterPlatformAccessories(_plugin: string, _platform: string, accessories: FakeAccessory[]): void {
    this.unregistered.push(...accessories);
  }

  updatePlatformAccessories(): void {
    this.updated++;
  }
}

const T0 = Date.UTC(2026, 9, 8, 15);
let dir: string;
let fake: FakeFetch;
let platforms: BusyLightPlatform[] = [];

beforeEach(() => {
  dir = tmpDir('busy-light-platform');
  fake = new FakeFetch();
  fake.on('https://calendar.example.com/', () => text(icsOf([['call', T0 - 60_000, T0 + 600_000]])));
});
afterEach(() => {
  for (const p of platforms) {
    p.engine?.stop();
    p.addressWatcher?.stop();
    p.inputServer?.stop();
  }
  platforms = [];
  fake.restore();
  fs.rmSync(dir, { recursive: true, force: true });
});

function launch(config: Record<string, unknown>, cached: FakeAccessory[] = [], clock = new FakeClock(T0), extra: Partial<PlatformDeps> = {}): {
  platform: BusyLightPlatform; api: FakeApi; log: ReturnType<typeof fakeLog>;
} {
  const api = new FakeApi(dir);
  const log = fakeLog();
  const platform = new BusyLightPlatform(log.log as unknown as Logging, { platform: 'BusyLight', ...config } as PlatformConfig,
    api as unknown as API, {
      clock,
      lifx: new LifxClient({ socket: new FakeNetwork().factory, timings: { replyMs: 5, collectMs: 10 }, interfaces: () => ({}) }),
      ...extra,
    });
  for (const accessory of cached) {
    platform.configureAccessory(accessory as unknown as Parameters<BusyLightPlatform['configureAccessory']>[0]);
  }
  api.emit('didFinishLaunching');
  platforms.push(platform);
  return { platform, api, log };
}

const uuid = (key: SensorKey) => hap.uuid.generate(sensorUuidSeed(key));
/** The platform's services come from the same HAP module at run time; only the type declarations differ. */
const service = (platform: BusyLightPlatform, key: SensorKey) => platform.sensorServices().get(key) as unknown as hap.Service;
const detected = (platform: BusyLightPlatform, key: SensorKey) =>
  service(platform, key).getCharacteristic(C.OccupancyDetected).value === C.OccupancyDetected.OCCUPANCY_DETECTED;

test('the default sensors are the three roll-ups, named from the platform name', () => {
  const { api } = launch({});
  assert.deepEqual(api.registered.map((a) => a.displayName), ['Busy Light Available', 'Busy Light Busy', 'Busy Light Out of Office']);
  const info = api.registered[0].getService(S.AccessoryInformation)!;
  assert.equal(info.getCharacteristic(C.Manufacturer).value, 'Busy Light');
  assert.equal(info.getCharacteristic(C.Model).value, 'Status sensor');
  assert.equal(info.getCharacteristic(C.SerialNumber).value, 'available');
  assert.equal(info.getCharacteristic(C.FirmwareRevision).value, packageVersion());
  assert.equal(api.registered[1].getService(S.OccupancySensor)!.getCharacteristic(C.Name).value, 'Busy Light Busy');
});

test('every sensor of section 7, with stable UUIDs from the key', () => {
  const { api } = launch({ name: 'Door', sensors: [...SENSOR_KEYS] });
  assert.deepEqual(api.registered.map((a) => a.displayName), [
    'Door Available', 'Door Busy', 'Door Out of Office', 'Door In a Meeting', 'Door In a Call', 'Door Do Not Disturb',
    'Door Busy in Teams', 'Door Tentative', 'Door Away', 'Door Offline', 'Door Meeting Soon',
  ]);
  assert.deepEqual(api.registered.map((a) => a.UUID), SENSOR_KEYS.map(uuid));
  assert.equal(uuid('available'), hap.uuid.generate('busy-light:sensor:available'));
  assert.equal(uuid('meetingSoon'), hap.uuid.generate('busy-light:sensor:meeting-soon'), 'as SPEC 7 item 3 gives it');
});

test('renaming keeps the accessories and their UUIDs', () => {
  const first = launch({ name: 'Busy Light' });
  const cached = first.api.registered;
  const second = launch({ name: 'Studio' }, cached);
  assert.deepEqual(second.api.registered, [], 'nothing new is registered');
  assert.deepEqual(second.api.unregistered, []);
  assert.deepEqual(cached.map((a) => a.displayName), ['Studio Available', 'Studio Busy', 'Studio Out of Office']);
  assert.equal(cached[0].getService(S.OccupancySensor)!.getCharacteristic(C.Name).value, 'Studio Available');
});

test('accessories no longer wanted are unregistered at startup', () => {
  const stray = new FakeAccessory('Old', hap.uuid.generate('something else'));
  const offline = new FakeAccessory('Busy Light Offline', uuid('offline'));
  const available = new FakeAccessory('Busy Light Available', uuid('available'));
  const { api } = launch({ sensors: ['available'] }, [stray, offline, available]);
  assert.deepEqual(api.unregistered.map((a) => a.displayName).sort(), ['Busy Light Offline', 'Old']);
  assert.deepEqual(api.registered, []);
});

test('an empty sensors list creates no sensors', () => {
  const { api } = launch({ sensors: [] });
  assert.deepEqual(api.registered, []);
});

test('roll-up mapping', () => {
  const on = (status: Status) => SENSOR_KEYS.filter((k) => sensorOn(k, status));
  assert.deepEqual(on('available'), ['available']);
  assert.deepEqual(on('inMeeting'), ['busyAny', 'inMeeting']);
  assert.deepEqual(on('inCall'), ['busyAny', 'inCall']);
  assert.deepEqual(on('doNotDisturb'), ['busyAny', 'doNotDisturb']);
  assert.deepEqual(on('busy'), ['busyAny', 'busy']);
  assert.deepEqual(on('outOfOffice'), ['outOfOffice']);
  assert.deepEqual(on('tentative'), ['tentative'], 'no roll-up');
  assert.deepEqual(on('away'), ['away'], 'no roll-up');
  assert.deepEqual(on('offline'), ['offline'], 'no roll-up');
  assert.deepEqual(on('unknown'), []);
  assert.deepEqual(on('notWorking'), [], 'not working turns every sensor off (SPEC 6.6)');
});

test('the sensors follow the status, and Unknown turns them all off', async () => {
  const { platform } = launch({ sensors: [...SENSOR_KEYS], calendars: [{ type: 'url', name: 'Rota', url: 'https://calendar.example.com/a.ics' }] });
  await settle();
  await platform.engine!.idle();
  assert.equal(platform.engine!.status, 'inMeeting');
  assert.deepEqual(SENSOR_KEYS.filter((k) => detected(platform, k)), ['busyAny', 'inMeeting']);
  platform.showStatus('unknown');
  assert.deepEqual(SENSOR_KEYS.filter((k) => detected(platform, k)), []);
});

test('the override switch forces Do not disturb at once and survives a restart', async () => {
  const first = launch({ overrideSwitch: true, calendars: [{ type: 'url', name: 'Rota', url: 'https://calendar.example.com/a.ics' }] });
  await settle();
  await first.platform.engine!.idle();
  const override = first.api.registered.find((a) => a.UUID === hap.uuid.generate(OVERRIDE_UUID_SEED))!;
  assert.equal(override.displayName, 'Busy Light Override');
  assert.equal(override.getService(S.AccessoryInformation)!.getCharacteristic(C.SerialNumber).value, 'override');
  const on = override.getService(S.Switch)!.getCharacteristic(C.On);
  assert.equal(on.value, false);

  await on.handleSetRequest(true);
  await first.platform.engine!.idle();
  assert.equal(first.platform.engine!.status, 'doNotDisturb');
  assert.equal(override.context.override, true);
  assert.ok(first.api.updated > 0);
  assert.equal(readState(`${dir}/busy-light`)!.override, true);
  assert.ok(first.log.lines('info').includes('Status: Do not disturb.'));
  first.platform.engine!.stop();

  const second = launch({ overrideSwitch: true, calendars: [{ type: 'url', name: 'Rota', url: 'https://calendar.example.com/a.ics' }] },
    first.api.registered);
  await settle();
  await second.platform.engine!.idle();
  assert.equal(second.platform.engine!.status, 'doNotDisturb', 'the override is kept in the accessory context');

  await on.handleSetRequest(false);
  await second.platform.engine!.idle();
  assert.equal(second.platform.engine!.status, 'inMeeting');
});

test('validation lines are logged, and an invalid source does not stop the platform', async () => {
  const { log, platform } = launch({ calendars: [{ type: 'url', name: 'Rota', url: 'http://calendar.example.com/a.ics' }], pollSeconds: 5 });
  assert.deepEqual(log.lines('error'), ['calendars[0].url: must start with https:// or webcal://']);
  assert.deepEqual(log.lines('warn').slice(0, 2), [
    'pollSeconds: must be a whole number from 15 to 240',
    'No calendars are set up yet. Open the plugin settings to add one.',
  ]);
  assert.equal(platform.config.pollSeconds, 30);
});

test('storage lives in busy-light/ with mode 700', () => {
  launch({});
  assert.equal(fs.statSync(`${dir}/busy-light`).mode & 0o777, 0o700);
  assert.ok(fs.existsSync(`${dir}/busy-light/state.json`));
});

test('review: the override switch answers HomeKit at once, without waiting for the bulb', async () => {
  const api = new FakeApi(dir);
  const platform = new BusyLightPlatform(fakeLog().log as unknown as Logging,
    { platform: 'BusyLight', overrideSwitch: true, lifx: { enabled: true, host: '192.168.4.99' } } as PlatformConfig, api as unknown as API, {
      clock: new FakeClock(T0),
      lifx: new LifxClient({ socket: new FakeNetwork().factory, timings: { replyMs: 200 }, interfaces: () => ({}) }),
    });
  platforms.push(platform);
  api.emit('didFinishLaunching');
  await settle();
  const override = api.registered.find((a) => a.UUID === hap.uuid.generate(OVERRIDE_UUID_SEED))!;
  await override.getService(S.Switch)!.getCharacteristic(C.On).handleSetRequest(true);
  // HomeKit has its answer. Had it waited for the apply, the queue would be done and this callback would run first;
  // a silent bulb keeps the apply going for over a second. An order, not a stopwatch, so a slow machine cannot fail it.
  let applied = false;
  void platform.engine!.idle().then(() => {
    applied = true;
  });
  await Promise.resolve();
  assert.equal(applied, false, 'the switch must not wait for the bulb');
  await platform.engine!.idle();
  assert.equal(platform.engine!.status, 'doNotDisturb');
});

test('a reset-pending marker unregisters every cached accessory at startup and is deleted (SPEC 7 item 6)', () => {
  const first = launch({ overrideSwitch: true });
  const cached = first.api.registered;
  (cached.find((a) => a.UUID === hap.uuid.generate(OVERRIDE_UUID_SEED))!).context.override = true;
  fs.writeFileSync(`${dir}/busy-light/reset-pending`, '2026-10-08T15:00:00.000Z\n');
  const second = launch({}, cached);
  assert.equal(second.api.unregistered.length, 4, 'every cached accessory, wanted or not');
  assert.deepEqual(second.api.registered.map((a) => a.displayName), ['Busy Light Available', 'Busy Light Busy', 'Busy Light Out of Office']);
  assert.ok(second.api.registered.every((a) => !cached.includes(a)), 'the sensors come back as new accessories');
  assert.equal(fs.existsSync(`${dir}/busy-light/reset-pending`), false);
  const third = launch({}, second.api.registered);
  assert.deepEqual(third.api.unregistered, [], 'without the marker nothing is removed');
  assert.deepEqual(third.api.registered, []);
});

// SPEC 15 item 18: the On a Call switch (18.9).

const HOUR = 3_600_000;
const callUuid = hap.uuid.generate(CALL_SWITCH_UUID_SEED);

function callSwitch(api: FakeApi): { accessory: FakeAccessory; on: hap.Characteristic } {
  const accessory = api.registered.find((a) => a.UUID === callUuid)!;
  return { accessory, on: accessory.getService(S.Switch)!.getCharacteristic(C.On) };
}

test('the On a Call switch: on reports In a call from the Home app, off withdraws it, HomeKit answered at once', async () => {
  const { platform, api } = launch({ callSwitch: { enabled: true } });
  await settle();
  const { accessory, on } = callSwitch(api);
  assert.equal(accessory.displayName, 'Busy Light On a Call');
  const info = accessory.getService(S.AccessoryInformation)!;
  assert.equal(info.getCharacteristic(C.Model).value, 'Call switch');
  assert.equal(info.getCharacteristic(C.SerialNumber).value, 'call-switch');
  assert.equal(info.getCharacteristic(C.Manufacturer).value, 'Busy Light');
  assert.equal(on.value, false);
  assert.equal(platform.engine!.status, 'available', 'no calendars with the switch on: not unknown');
  await on.handleSetRequest(true);
  assert.equal(accessory.context.callOnAt, T0);
  await settle();
  assert.equal(platform.engine!.status, 'inCall');
  assert.deepEqual(platform.engine!.inputs.list(T0).map((e) => [e.sender, e.status, e.app, e.via, e.auth, e.expiresAt]),
    [['Home app', 'inCall', null, 'switch', null, null]]);
  assert.equal(await on.handleGetRequest(), true);
  await on.handleSetRequest(false);
  await settle();
  assert.equal(accessory.context.callOnAt, null);
  assert.equal(platform.engine!.status, 'available');
});

test('the safety timeout turns the switch off after the configured hours, with one line', async () => {
  const clock = new FakeClock(T0);
  const { platform, api, log } = launch({ callSwitch: { enabled: true, hours: 1 } }, [], clock);
  await settle();
  const { accessory, on } = callSwitch(api);
  await on.handleSetRequest(true);
  await settle();
  await clock.advance(HOUR - 1);
  assert.equal(on.value, true);
  await clock.advance(1);
  assert.equal(on.value, false);
  assert.equal(accessory.context.callOnAt, null);
  assert.equal(platform.engine!.status, 'available');
  assert.ok(log.lines('info').includes('Busy Light On a Call turned itself off after 1 hour.'));
});

test('after a restart the switch is restored with the time remaining, or turned off when the time has passed', async () => {
  const first = launch({ callSwitch: { enabled: true } });
  await settle();
  const cached = [...first.api.registered];
  first.platform.engine!.stop();
  const call = cached.find((a) => a.UUID === callUuid)!;

  call.context.callOnAt = T0 - HOUR;
  const clock = new FakeClock(T0);
  const second = launch({ callSwitch: { enabled: true } }, cached, clock);
  await settle();
  assert.equal(call.getService(S.Switch)!.getCharacteristic(C.On).value, true, 'restored on, from the accessory context');
  assert.equal(second.platform.engine!.status, 'inCall');
  await clock.advance(2 * HOUR);
  assert.equal(call.getService(S.Switch)!.getCharacteristic(C.On).value, false, 'off when the three hours are up');
  assert.ok(second.log.lines('info').includes('Busy Light On a Call turned itself off after 3 hours.'));
  second.platform.engine!.stop();

  call.context.callOnAt = T0 - 4 * HOUR;
  const third = launch({ callSwitch: { enabled: true } }, cached);
  await settle();
  assert.equal(call.context.callOnAt, null, 'the time had passed');
  assert.equal(call.getService(S.Switch)!.getCharacteristic(C.On).value, false);
  assert.equal(third.platform.engine!.status, 'available');
  assert.ok(third.log.lines('info').includes('Busy Light On a Call turned itself off after 3 hours.'));
});

test('the switch is removed when the configuration no longer enables it', async () => {
  const first = launch({ callSwitch: { enabled: true } });
  await settle();
  const cached = [...first.api.registered];
  first.platform.engine!.stop();
  const second = launch({}, cached);
  assert.deepEqual(second.api.unregistered.map((a) => a.UUID), [callUuid]);
  assert.equal(second.platform.callSwitchAccessory(), null);
});

// SPEC 18.11 item 6, 15 item 23: the address change notice, from the previous state file to the warning.

/** A server that listens without a socket (SPEC 15 item 16). */
function quietServer(): ServerLike {
  return {
    listen: (_options, listener) => setImmediate(listener),
    once: () => undefined,
    removeAllListeners: () => undefined,
    on: () => undefined,
    close: () => undefined,
  };
}

/** The host with `ip` as its only network address and no name the network confirms. */
function hostAt(ip: string): AddressDeps {
  return {
    hostname: () => 'homebridge',
    interfaces: () => ({ eth0: [{ address: ip, family: 'IPv4', internal: false, netmask: '255.255.255.0', mac: '', cidr: null }] }),
    createSocket: new FakeMdns().factory, mdnsWaitMs: 5, lookup: async () => [],
  };
}

const INPUT = { statusInput: { enabled: true, key: 'Synthetic-platform-key-000000000000000000000' } };

test('address change: the address from the previous state file, a new one at startup, one warning, and the change in the state file', async () => {
  fs.mkdirSync(`${dir}/busy-light`, { recursive: true });
  fs.writeFileSync(`${dir}/busy-light/state.json`, JSON.stringify({
    version: 1, updatedAt: new Date(T0 - 3_600_000).toISOString(), status: 'available', reason: null, override: false, sources: [], signIn: null, light: null,
    statusInput: { enabled: true, port: 8582, listening: true, error: null, id: null, advertised: '192.168.4.10', addressChange: null },
  }));
  const { platform, log } = launch(INPUT, [], new FakeClock(T0), { createServer: quietServer, addresses: hostAt('192.168.4.23') });
  await settle();
  await new Promise((resolve) => setTimeout(resolve, 50));
  await settle();
  assert.deepEqual(log.lines('warn').filter((l) => l.startsWith('Homebridge')), [addressChanged('192.168.4.10', '192.168.4.23')]);
  const state = readState(`${dir}/busy-light`)!.statusInput!;
  assert.equal(state.advertised, '192.168.4.23');
  assert.deepEqual(state.addressChange, { from: '192.168.4.10', to: '192.168.4.23', at: new Date(T0).toISOString() });
  platform.addressWatcher!.stop();
});

test('address change: with the status input off, the record of the previous state file is kept and nothing is checked', async () => {
  const change = { from: '192.168.4.9', to: '192.168.4.10', at: new Date(T0 - 86_400_000).toISOString() };
  fs.mkdirSync(`${dir}/busy-light`, { recursive: true });
  fs.writeFileSync(`${dir}/busy-light/state.json`, JSON.stringify({
    version: 1, updatedAt: new Date(T0).toISOString(), status: 'available', reason: null, override: false, sources: [], signIn: null, light: null,
    statusInput: { enabled: true, port: 8582, listening: true, error: null, id: null, advertised: '192.168.4.10', addressChange: change },
  }));
  const mdns = new FakeMdns();
  const { platform } = launch({}, [], new FakeClock(T0), { addresses: { ...hostAt('192.168.4.23'), createSocket: mdns.factory } });
  await settle();
  platform.engine!.writeState();
  const state = readState(`${dir}/busy-light`)!.statusInput!;
  assert.equal(state.advertised, '192.168.4.10');
  assert.deepEqual(state.addressChange, change);
  assert.equal(platform.addressWatcher, null);
  assert.equal(mdns.sent.length, 0);
});

// Build 3.2: the Working switch (SPEC 6.6, 7 item 9).

const workingUuid = hap.uuid.generate(WORKING_SWITCH_UUID_SEED);

test('the Working switch: starts on, off turns every sensor off and the status to not working, on resolves at once', async () => {
  const rota = { type: 'url', name: 'Rota', url: 'https://calendar.example.com/a.ics' };
  const first = launch({ workingSwitch: { enabled: true }, sensors: [...SENSOR_KEYS], overrideSwitch: true, calendars: [rota] });
  await settle();
  await first.platform.engine!.idle();
  const accessory = first.api.registered.find((a) => a.UUID === workingUuid)!;
  assert.equal(accessory.displayName, 'Busy Light Working');
  const info = accessory.getService(S.AccessoryInformation)!;
  assert.equal(info.getCharacteristic(C.Manufacturer).value, 'Busy Light');
  assert.equal(info.getCharacteristic(C.Model).value, 'Working switch');
  assert.equal(info.getCharacteristic(C.SerialNumber).value, 'working-switch');
  assert.equal(info.getCharacteristic(C.FirmwareRevision).value, packageVersion());
  const on = accessory.getService(S.Switch)!.getCharacteristic(C.On);
  assert.equal(on.value, true, 'it starts on');
  assert.equal(first.platform.engine!.status, 'inMeeting');

  await on.handleSetRequest(false);
  assert.equal(accessory.context.working, false, 'stored at once');
  await first.platform.engine!.idle();
  assert.equal(first.platform.engine!.status, 'notWorking');
  assert.deepEqual(SENSOR_KEYS.filter((k) => detected(first.platform, k)), [], 'every sensor off, Available too');
  const override = first.api.registered.find((a) => a.UUID === hap.uuid.generate(OVERRIDE_UUID_SEED))!;
  await override.getService(S.Switch)!.getCharacteristic(C.On).handleSetRequest(true);
  await first.platform.engine!.idle();
  assert.equal(first.platform.engine!.status, 'notWorking', 'above the override');
  assert.equal(readState(`${dir}/busy-light`)!.status, 'notWorking');
  assert.ok(first.log.lines('info').includes('Busy Light Working turned off. The light stays off until it is turned on.'));
  first.platform.engine!.stop();

  // Kept across a restart, with the line once.
  const second = launch({ workingSwitch: { enabled: true }, sensors: [...SENSOR_KEYS], overrideSwitch: true, calendars: [rota] },
    first.api.registered);
  await settle();
  await second.platform.engine!.idle();
  assert.equal(second.platform.engine!.status, 'notWorking');
  assert.equal(on.value, false);
  assert.deepEqual(second.log.lines('info').filter((l) => l.includes('Working')),
    ['Busy Light Working turned off. The light stays off until it is turned on.']);
  await on.handleSetRequest(true);
  await second.platform.engine!.idle();
  assert.equal(second.platform.engine!.status, 'doNotDisturb', 'on resolves at once: the override is on');
  assert.ok(second.log.lines('info').includes('Busy Light Working turned on.'));
  second.platform.engine!.stop();

  // Removed with the checkbox, and the plugin behaves as working.
  const third = launch({ sensors: [...SENSOR_KEYS], overrideSwitch: true, calendars: [rota] }, first.api.registered);
  await settle();
  await third.platform.engine!.idle();
  assert.deepEqual(third.api.unregistered.map((a) => a.displayName), ['Busy Light Working']);
  assert.equal(third.platform.engine!.status, 'doNotDisturb');
});

test('the Working switch answers HomeKit at once, without waiting for the bulb', async () => {
  const api = new FakeApi(dir);
  const platform = new BusyLightPlatform(fakeLog().log as unknown as Logging,
    { platform: 'BusyLight', workingSwitch: { enabled: true }, lifx: { enabled: true, host: '192.168.4.99' } } as PlatformConfig, api as unknown as API, {
      clock: new FakeClock(T0),
      lifx: new LifxClient({ socket: new FakeNetwork().factory, timings: { replyMs: 200 }, interfaces: () => ({}) }),
    });
  platforms.push(platform);
  api.emit('didFinishLaunching');
  await settle();
  const accessory = api.registered.find((a) => a.UUID === workingUuid)!;
  await accessory.getService(S.Switch)!.getCharacteristic(C.On).handleSetRequest(false);
  let applied = false;
  void platform.engine!.idle().then(() => {
    applied = true;
  });
  await Promise.resolve();
  assert.equal(applied, false, 'the switch must not wait for the bulb');
  await platform.engine!.idle();
  assert.equal(platform.engine!.status, 'notWorking');
});

test('the Meeting Soon sensor detects occupancy during the meeting warning (SPEC 6.7 item 5)', async () => {
  const start = T0 + 10 * 60_000;
  fake.on('https://calendar.example.com/', () => text(icsOf([['meeting', start, start + 1_800_000]])));
  const clock = new FakeClock(T0);
  const { platform, api } = launch({ sensors: ['available', 'meetingSoon'], meetingWarningSeconds: 180,
    calendars: [{ type: 'url', name: 'Rota', url: 'https://calendar.example.com/a.ics' }] }, [], clock);
  await settle();
  await platform.engine!.idle();
  assert.equal(api.registered.find((a) => a.UUID === uuid('meetingSoon'))!.displayName, 'Busy Light Meeting Soon');
  assert.deepEqual([detected(platform, 'available'), detected(platform, 'meetingSoon')], [true, false]);
  await clock.advance(7 * 60_000);
  await platform.engine!.idle();
  assert.deepEqual([detected(platform, 'available'), detected(platform, 'meetingSoon')], [true, true], 'still Available, and the meeting is soon');
  await clock.advance(3 * 60_000);
  await platform.engine!.idle();
  assert.deepEqual([detected(platform, 'available'), detected(platform, 'meetingSoon')], [false, false]);
});
