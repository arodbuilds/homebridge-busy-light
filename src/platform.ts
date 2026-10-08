import type { API, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig } from 'homebridge';

/** Placeholder until the platform lands (build 1, scope item 9). */
export class BusyLightPlatform implements DynamicPlatformPlugin {
  private readonly cached: PlatformAccessory[] = [];

  constructor(
    private readonly log: Logging,
    private readonly config: PlatformConfig,
    private readonly api: API,
  ) {
    this.api.on('didFinishLaunching', () => {
      this.log.debug(`${this.cached.length} cached accessories, platform ${this.config.platform}`);
    });
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.cached.push(accessory);
  }
}
