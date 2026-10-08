import * as path from 'node:path';
import type { API, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig } from 'homebridge';
import { GraphClient, SignInRequiredError } from './graph';
import { ICloudSource, IcsFeedSource } from './caldav';
import { LifxBulb } from './lifx';
import { resolveStatus, STATUS_KEYS, STATUS_LABELS, type CalEvent, type PresenceInfo, type StatusKey } from './status';

export const PLUGIN_NAME = 'homebridge-m365-status';
export const PLATFORM_NAME = 'M365Status';

const DEFAULT_COLORS: Record<StatusKey, string> = {
  available: '#00FF00',
  inMeeting: '#FF0000',
  inCall: '#FF0000',
  doNotDisturb: '#FF0000',
  busy: '#FF6A00',
  tentative: '#FFD000',
  away: '#FFD000',
  outOfOffice: '#B400FF',
  offline: 'off',
};

const DEFAULT_SENSORS: StatusKey[] = ['available', 'inMeeting', 'inCall', 'doNotDisturb', 'busy', 'outOfOffice'];
const PRESENCE_MAX_AGE = 5 * 60000;

interface Source {
  name: string;
  fetch(now: number): Promise<CalEvent[]>;
  events: CalEvent[];
  fetchedAt: number;
  failing: boolean;
}

export class M365StatusPlatform implements DynamicPlatformPlugin {
  private readonly cached = new Map<string, PlatformAccessory>();
  private readonly sensors = new Map<StatusKey, PlatformAccessory>();
  private readonly sources: Source[] = [];
  private graph: GraphClient | null = null;
  private usePresence = false;
  private presence: PresenceInfo | null = null;
  private presenceAt = 0;
  private presenceFailing = false;
  private bulb: LifxBulb | null = null;
  private current: StatusKey | null = null;
  private lastSent = 0;
  private busyTick = false;

  constructor(
    private readonly log: Logging,
    private readonly config: PlatformConfig,
    private readonly api: API,
  ) {
    this.api.on('didFinishLaunching', () => {
      try {
        this.start();
      } catch (e) {
        this.log.error(`Could not start: ${(e as Error).message}`);
      }
    });
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.cached.set(accessory.UUID, accessory);
  }

  private start(): void {
    const c = this.config;
    const ics = {
      oofKeywords: Array.isArray(c.outOfOfficeKeywords)
        ? c.outOfOfficeKeywords
        : ['Out of office', 'OOO', 'Vacation', 'PTO'],
      selfEmails: [c.icloud?.appleId, c.google?.email].filter((e): e is string => typeof e === 'string'),
    };
    const add = (name: string, fetch: (now: number) => Promise<CalEvent[]>) =>
      this.sources.push({ name, fetch, events: [], fetchedAt: 0, failing: false });

    // iCloud
    if (c.icloud?.enabled) {
      if (c.icloud.appleId && c.icloud.appPassword) {
        const src = new ICloudSource(c.icloud.appleId, c.icloud.appPassword, c.icloud.calendars ?? [], ics,
          (all, used) => {
            this.log.info(`iCloud calendars found: ${all.join(', ') || 'none'}`);
            this.log.info(`iCloud calendars in use: ${used.join(', ') || 'none (check the calendar names in settings)'}`);
          });
        add('iCloud', (now) => src.fetch(now));
      } else {
        this.log.warn('iCloud is enabled but the Apple ID or app-specific password is missing.');
      }
    }

    // Google
    if (c.google?.enabled) {
      const urls: string[] = Array.isArray(c.google.icalUrls) ? c.google.icalUrls : [];
      if (urls.some((u) => u && u.trim())) {
        const src = new IcsFeedSource(urls, ics);
        add('Google Calendar', (now) => src.fetch(now));
      } else {
        this.log.warn('Google Calendar is enabled but no secret iCal address is set.');
      }
    }

    // Microsoft 365
    const ms = c.microsoft;
    if (ms?.enabled) {
      if (ms.tenantId && ms.clientId) {
        this.usePresence = ms.presence !== false;
        const useCalendar = ms.calendar !== false;
        const graph = new GraphClient(
          this.log, ms.tenantId, ms.clientId,
          path.join(this.api.user.storagePath(), 'm365-status-tokens.json'),
          this.usePresence, useCalendar,
        );
        this.graph = graph;
        if (useCalendar) {
          add('Microsoft 365 calendar', (now) => graph.getEvents(now));
        }
        void graph.ensureSignedIn();
      } else {
        this.log.warn('Microsoft 365 is enabled but the tenant ID or client ID is missing.');
      }
    }

    if (this.sources.length === 0 && !this.usePresence) {
      this.log.warn('No calendar or presence source is set up yet. Open the plugin settings to add one.');
    }

    if (c.lifx?.enabled && c.lifx.host) {
      this.bulb = new LifxBulb(String(c.lifx.host).trim());
    }

    this.setupSensors();

    const pollMs = Math.max(15, Number(c.pollSeconds) || 30) * 1000;
    void this.tick();
    setInterval(() => void this.tick(), pollMs);
  }

  private setupSensors(): void {
    const wanted: StatusKey[] = (Array.isArray(this.config.sensors) ? this.config.sensors : DEFAULT_SENSORS)
      .filter((k: string): k is StatusKey => (STATUS_KEYS as readonly string[]).includes(k));
    const prefix = String(this.config.name || 'My Status');
    const { Service, Characteristic } = this.api.hap;
    const keep = new Set<string>();
    for (const key of wanted) {
      const uuid = this.api.hap.uuid.generate(`${PLUGIN_NAME}:${key}`);
      keep.add(uuid);
      const name = `${prefix} ${STATUS_LABELS[key]}`;
      let acc = this.cached.get(uuid);
      if (!acc) {
        acc = new this.api.platformAccessory(name, uuid);
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [acc]);
      }
      acc.getService(Service.AccessoryInformation)!
        .setCharacteristic(Characteristic.Manufacturer, 'arodbuilds')
        .setCharacteristic(Characteristic.Model, 'Status Sensor')
        .setCharacteristic(Characteristic.SerialNumber, key);
      const svc = acc.getService(Service.OccupancySensor) ?? acc.addService(Service.OccupancySensor, name);
      svc.updateCharacteristic(Characteristic.OccupancyDetected, 0);
      this.sensors.set(key, acc);
    }
    const stale = [...this.cached.values()].filter((a) => !keep.has(a.UUID));
    if (stale.length) {
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, stale);
    }
  }

  private async tick(): Promise<void> {
    if (this.busyTick) {
      return;
    }
    this.busyTick = true;
    try {
      const now = Date.now();
      const calMs = Math.max(60, Number(this.config.calendarSeconds) || 180) * 1000;

      if (this.graph && this.usePresence) {
        try {
          this.presence = await this.graph.getPresence();
          this.presenceAt = now;
          if (this.presenceFailing) {
            this.log.info('Teams presence is working again.');
          }
          this.presenceFailing = false;
        } catch (e) {
          this.onError('Teams presence', e, this.presenceFailing);
          this.presenceFailing = true;
        }
      }

      for (const src of this.sources) {
        if (now - src.fetchedAt < calMs) {
          continue;
        }
        src.fetchedAt = now;
        try {
          src.events = await src.fetch(now);
          if (src.failing) {
            this.log.info(`${src.name} is working again.`);
          }
          src.failing = false;
          this.log.debug(`${src.name}: ${src.events.length} events near now`);
        } catch (e) {
          this.onError(src.name, e, src.failing);
          src.failing = true;
        }
      }

      const presence = this.usePresence && now - this.presenceAt < PRESENCE_MAX_AGE ? this.presence : null;
      const events = this.sources.flatMap((s) => s.events);
      const status = resolveStatus(presence, events, now, {
        ignoreAllDayBusy: this.config.ignoreAllDayBusy !== false,
      });
      await this.apply(status, now);
    } finally {
      this.busyTick = false;
    }
  }

  private onError(what: string, e: unknown, alreadyFailing: boolean): void {
    if (e instanceof SignInRequiredError) {
      void this.graph?.ensureSignedIn();
      return;
    }
    const msg = `${what} could not be read: ${(e as Error).message}`;
    if (alreadyFailing) {
      this.log.debug(msg);
    } else {
      this.log.warn(`${msg}. Keeping the last known value and retrying.`);
    }
  }

  private async apply(status: StatusKey, now: number): Promise<void> {
    const changed = status !== this.current;
    if (changed) {
      this.log.info(`Status: ${STATUS_LABELS[status]}`);
      this.current = status;
      const { Service, Characteristic } = this.api.hap;
      for (const [key, acc] of this.sensors) {
        acc.getService(Service.OccupancySensor)
          ?.updateCharacteristic(Characteristic.OccupancyDetected, key === status ? 1 : 0);
      }
    }
    const refreshMs = Math.max(0, Number(this.config.lifx?.refreshSeconds) || 0) * 1000;
    if (this.bulb && (changed || (refreshMs > 0 && now - this.lastSent >= refreshMs))) {
      const color = String(this.config.colors?.[status] || DEFAULT_COLORS[status]);
      try {
        await this.bulb.set(color, Number(this.config.lifx?.brightness) || 100, changed ? 1000 : 0);
        this.lastSent = now;
      } catch (e) {
        this.log.warn(`Could not reach the LIFX bulb: ${(e as Error).message}`);
      }
    }
  }
}
