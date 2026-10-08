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
import { BusyLightPlatform, OVERRIDE_UUID_SEED, sensorOn, sensorUuidSeed } from '../src/platform.js';
import { readState } from '../src/state.js';
import { FakeClock, FakeFetch, FakeNetwork, fakeLog, icsOf, settle, text, tmpDir } from './helpers.js';

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
  }
  platforms = [];
  fake.restore();
  fs.rmSync(dir, { recursive: true, force: true });
});

function launch(config: Record<string, unknown>, cached: FakeAccessory[] = []): { platform: BusyLightPlatform; api: FakeApi; log: ReturnType<typeof fakeLog> } {
  const api = new FakeApi(dir);
  const log = fakeLog();
  const platform = new BusyLightPlatform(log.log as unknown as Logging, { platform: 'BusyLight', ...config } as PlatformConfig,
    api as unknown as API, {
      clock: new FakeClock(T0),
      lifx: new LifxClient({ socket: new FakeNetwork().factory, timings: { replyMs: 5, collectMs: 10 }, interfaces: () => ({}) }),
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
    'Door Busy in Teams', 'Door Tentative', 'Door Away', 'Door Offline',
  ]);
  assert.deepEqual(api.registered.map((a) => a.UUID), SENSOR_KEYS.map(uuid));
  assert.equal(uuid('available'), hap.uuid.generate('busy-light:sensor:available'));
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
  const started = Date.now();
  await override.getService(S.Switch)!.getCharacteristic(C.On).handleSetRequest(true);
  assert.ok(Date.now() - started < 150, 'a silent bulb takes over a second; the switch must not wait for it');
  await platform.engine!.idle();
  assert.equal(platform.engine!.status, 'doNotDisturb');
});
