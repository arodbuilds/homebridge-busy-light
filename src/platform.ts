/**
 * The Homebridge platform (SPEC section 7): one occupancy sensor accessory per wanted sensor, the optional override
 * switch, and the engine that keeps them up to date.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { API, CharacteristicValue, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig, Service } from 'homebridge';
import { parseConfig } from './config.js';
import type { BusyLightConfig } from './config.js';
import { BusyLightEngine, systemClock } from './engine.js';
import type { Clock } from './engine.js';
import { ensureStorageDir } from './files.js';
import type { LifxClient } from './lifx.js';
import { withDebug } from './log.js';
import type { Log } from './log.js';
import { HOME_APP_SENDER } from './inputs.js';
import { callSwitchTimeout, validation } from './messages.js';
import { SENSOR_NAMES, SENSOR_STATUSES } from './model.js';
import type { SensorKey, Status } from './model.js';
import { PLATFORM_NAME, PLUGIN_NAME, RESET_MARKER, packageVersion } from './names.js';
import { StatusInputServer } from './status-api.js';
import type { InputServerOptions } from './status-api.js';

export const MANUFACTURER = 'Busy Light';
export const SENSOR_MODEL = 'Status sensor';
export const OVERRIDE_MODEL = 'Override switch';
export const CALL_SWITCH_MODEL = 'Call switch';

/** UUIDs come from the key, never the display name, so renaming keeps rooms and automations (SPEC 7 item 3). */
export function sensorUuidSeed(key: SensorKey): string {
  return `busy-light:sensor:${key}`;
}

export const OVERRIDE_UUID_SEED = 'busy-light:override';
export const CALL_SWITCH_UUID_SEED = 'busy-light:call-switch';

/** Whether a sensor detects occupancy for a status. Unknown turns every sensor off. */
export function sensorOn(key: SensorKey, status: Status | null): boolean {
  return status !== null && status !== 'unknown' && SENSOR_STATUSES[key].includes(status);
}

/** Test seams: a clock, a LIFX client, and the status input's server factory (so no test opens a socket). */
export interface PlatformDeps {
  clock?: Clock;
  lifx?: LifxClient;
  createServer?: InputServerOptions['createServer'];
}

export class BusyLightPlatform implements DynamicPlatformPlugin {
  readonly config: BusyLightConfig;
  engine: BusyLightEngine | null = null;
  /** The status API (SPEC 18.3), while `statusInput.enabled` is on. */
  inputServer: StatusInputServer | null = null;
  private readonly log: Log;
  private readonly cached = new Map<string, PlatformAccessory>();
  private readonly sensors = new Map<SensorKey, Service>();
  private overrideAccessory: PlatformAccessory | null = null;
  /** The On a Call switch (SPEC 18.9), when enabled. Its context holds `callOnAt`, the time it was turned on. */
  private callAccessory: PlatformAccessory | null = null;
  private callTimer: unknown = null;
  private readonly clock: Clock;

  constructor(
    log: Logging,
    rawConfig: PlatformConfig,
    private readonly api: API,
    private readonly deps: PlatformDeps = {},
  ) {
    const { config, issues } = parseConfig(rawConfig);
    this.config = config;
    this.clock = deps.clock ?? systemClock;
    this.log = withDebug(log, config.debug);
    for (const issue of issues) {
      this.log[issue.level](validation(issue.path, issue.message));
    }
    this.api.on('didFinishLaunching', () => {
      try {
        this.start();
      } catch (err) {
        this.log.error(`Could not start: ${(err as Error).message}`);
      }
    });
    this.api.on('shutdown', () => {
      this.inputServer?.stop();
      this.stopCallTimer();
      this.engine?.stop();
    });
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.cached.set(accessory.UUID, accessory);
  }

  start(): void {
    const storageDir = ensureStorageDir(this.api.user.storagePath());
    this.resetIfPending(storageDir);
    this.setupAccessories();
    this.engine = new BusyLightEngine({
      config: this.config,
      storageDir,
      log: this.log,
      version: packageVersion(),
      clock: this.deps.clock,
      lifx: this.deps.lifx,
      override: this.overrideAccessory?.context.override === true,
      onStatus: (status) => this.showStatus(status),
    });
    this.engine.start();
    this.restoreCallSwitch();
    if (this.config.statusInput.enabled) {
      this.inputServer = new StatusInputServer({
        config: this.config.statusInput,
        engine: this.engine,
        log: this.log,
        version: packageVersion(),
        storageDir,
        now: this.deps.clock?.now,
        createServer: this.deps.createServer,
      });
      const server = this.inputServer;
      this.engine.inputServerStatus = () => ({ ...server.state, id: server.id });
      void server.start().then(() => this.engine?.writeState());
    }
  }

  /**
   * After Reset on the settings page (SPEC 7 item 6, 10.3 item 6): every cached accessory is unregistered, so the
   * sensors and the switch come back fresh, and the marker is deleted.
   */
  private resetIfPending(storageDir: string): void {
    const marker = path.join(storageDir, RESET_MARKER);
    if (!fs.existsSync(marker)) {
      return;
    }
    const cached = [...this.cached.values()];
    if (cached.length) {
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, cached);
    }
    this.cached.clear();
    fs.rmSync(marker, { force: true });
  }

  /** Creates or restores the wanted accessories and unregisters the rest (SPEC 7 item 6). */
  setupAccessories(): void {
    const { Service: S, Characteristic: C } = this.api.hap;
    const keep = new Set<string>();
    const version = packageVersion();

    for (const key of this.config.sensors) {
      const uuid = this.api.hap.uuid.generate(sensorUuidSeed(key));
      const name = `${this.config.name} ${SENSOR_NAMES[key]}`;
      keep.add(uuid);
      const accessory = this.accessory(uuid, name);
      accessory.getService(S.AccessoryInformation)!
        .setCharacteristic(C.Manufacturer, MANUFACTURER)
        .setCharacteristic(C.Model, SENSOR_MODEL)
        .setCharacteristic(C.SerialNumber, key)
        .setCharacteristic(C.FirmwareRevision, version);
      const service = accessory.getService(S.OccupancySensor) ?? accessory.addService(S.OccupancySensor, name);
      this.name(service, name);
      service.updateCharacteristic(C.OccupancyDetected, C.OccupancyDetected.OCCUPANCY_NOT_DETECTED);
      this.sensors.set(key, service);
    }

    if (this.config.overrideSwitch) {
      const uuid = this.api.hap.uuid.generate(OVERRIDE_UUID_SEED);
      const name = `${this.config.name} Override`;
      keep.add(uuid);
      const accessory = this.accessory(uuid, name);
      accessory.context.override = accessory.context.override === true;
      accessory.getService(S.AccessoryInformation)!
        .setCharacteristic(C.Manufacturer, MANUFACTURER)
        .setCharacteristic(C.Model, OVERRIDE_MODEL)
        .setCharacteristic(C.SerialNumber, 'override')
        .setCharacteristic(C.FirmwareRevision, version);
      const service = accessory.getService(S.Switch) ?? accessory.addService(S.Switch, name);
      this.name(service, name);
      service.updateCharacteristic(C.On, accessory.context.override);
      service.getCharacteristic(C.On)
        .onGet(() => accessory.context.override === true)
        .onSet((value: CharacteristicValue) => this.setOverride(value === true));
      this.overrideAccessory = accessory;
    }

    if (this.config.callSwitch.enabled) {
      const uuid = this.api.hap.uuid.generate(CALL_SWITCH_UUID_SEED);
      const name = `${this.config.name} On a Call`;
      keep.add(uuid);
      const accessory = this.accessory(uuid, name);
      if (typeof accessory.context.callOnAt !== 'number') {
        accessory.context.callOnAt = null;
      }
      accessory.getService(S.AccessoryInformation)!
        .setCharacteristic(C.Manufacturer, MANUFACTURER)
        .setCharacteristic(C.Model, CALL_SWITCH_MODEL)
        .setCharacteristic(C.SerialNumber, 'call-switch')
        .setCharacteristic(C.FirmwareRevision, version);
      const service = accessory.getService(S.Switch) ?? accessory.addService(S.Switch, name);
      this.name(service, name);
      service.updateCharacteristic(C.On, accessory.context.callOnAt !== null);
      service.getCharacteristic(C.On)
        .onGet(() => accessory.context.callOnAt !== null)
        .onSet((value: CharacteristicValue) => this.setCall(value === true));
      this.callAccessory = accessory;
    }

    const stale = [...this.cached.values()].filter((a) => !keep.has(a.UUID));
    if (stale.length) {
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, stale);
      for (const a of stale) {
        this.cached.delete(a.UUID);
      }
    }
  }

  private accessory(uuid: string, name: string): PlatformAccessory {
    let accessory = this.cached.get(uuid);
    if (!accessory) {
      accessory = new this.api.platformAccessory(name, uuid);
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      this.cached.set(uuid, accessory);
    } else if (accessory.displayName !== name) {
      accessory.displayName = name;
      this.api.updatePlatformAccessories([accessory]);
    }
    return accessory;
  }

  /** The service name, and ConfiguredName where the service supports it (Homebridge 2, SPEC 7 item 7). */
  // TODO(alex): HAP-NodeJS 2.2 lists ConfiguredName on neither OccupancySensor nor Switch, so this sets Name only.
  // Many Homebridge 2 plugins add it as an optional characteristic anyway; say if that is wanted.
  private name(service: Service, name: string): void {
    const C = this.api.hap.Characteristic;
    service.setCharacteristic(C.Name, name);
    const configured = C.ConfiguredName;
    if (configured && (service.testCharacteristic(configured) || service.optionalCharacteristics.some((c) => c.UUID === configured.UUID))) {
      service.setCharacteristic(configured, name);
    }
  }

  /** Stores the switch and answers HomeKit at once; the status and the bulb follow without holding up the Home app. */
  private setOverride(on: boolean): void {
    if (this.overrideAccessory) {
      this.overrideAccessory.context.override = on;
      this.api.updatePlatformAccessories([this.overrideAccessory]);
    }
    void this.engine?.setOverride(on);
  }

  /**
   * The On a Call switch turned on or off from HomeKit (SPEC 18.9 item 2). HomeKit is answered at once; the report and
   * the status follow. Turning it on again while it is on starts the safety period again.
   */
  private setCall(on: boolean): void {
    const accessory = this.callAccessory;
    if (!accessory) {
      return;
    }
    accessory.context.callOnAt = on ? this.clock.now() : null;
    this.api.updatePlatformAccessories([accessory]);
    this.stopCallTimer();
    if (on) {
      this.startCallTimer(accessory.context.callOnAt as number);
      void this.engine?.report({ sender: HOME_APP_SENDER, status: 'inCall', app: null, via: 'switch', auth: null, ttlMs: null });
    } else {
      void this.engine?.clearInput(HOME_APP_SENDER, null);
    }
  }

  /** After a restart: the switch is on again with the time remaining, or turned off when the time has passed (18.9 item 3). */
  private restoreCallSwitch(): void {
    const onAt = this.callAccessory?.context.callOnAt;
    if (typeof onAt !== 'number') {
      return;
    }
    if (this.clock.now() >= onAt + this.callHoursMs) {
      this.callTimedOut();
      return;
    }
    this.startCallTimer(onAt);
    void this.engine?.report({ sender: HOME_APP_SENDER, status: 'inCall', app: null, via: 'switch', auth: null, ttlMs: null });
  }

  private get callHoursMs(): number {
    return this.config.callSwitch.hours * 3_600_000;
  }

  private startCallTimer(onAt: number): void {
    this.callTimer = this.clock.setTimeout(() => {
      this.callTimer = null;
      this.callTimedOut();
    }, Math.max(0, onAt + this.callHoursMs - this.clock.now()));
  }

  private stopCallTimer(): void {
    if (this.callTimer !== null) {
      this.clock.clearTimeout(this.callTimer);
      this.callTimer = null;
    }
  }

  /** The safety timeout (SPEC 18.9 item 3): the switch turns itself off and its report is withdrawn. */
  private callTimedOut(): void {
    const accessory = this.callAccessory;
    if (!accessory) {
      return;
    }
    accessory.context.callOnAt = null;
    this.api.updatePlatformAccessories([accessory]);
    accessory.getService(this.api.hap.Service.Switch)?.updateCharacteristic(this.api.hap.Characteristic.On, false);
    this.log.info(callSwitchTimeout(this.config.name, this.config.callSwitch.hours));
    void this.engine?.clearInput(HOME_APP_SENDER, null);
  }

  /** The On a Call switch's accessory (tests). */
  callSwitchAccessory(): PlatformAccessory | null {
    return this.callAccessory;
  }

  /** Every sensor follows the status; unknown turns them all off. */
  showStatus(status: Status): void {
    const C = this.api.hap.Characteristic;
    for (const [key, service] of this.sensors) {
      service.updateCharacteristic(C.OccupancyDetected,
        sensorOn(key, status) ? C.OccupancyDetected.OCCUPANCY_DETECTED : C.OccupancyDetected.OCCUPANCY_NOT_DETECTED);
    }
  }

  /** The sensors currently in use, by key (for tests). */
  sensorServices(): Map<SensorKey, Service> {
    return this.sensors;
  }
}
