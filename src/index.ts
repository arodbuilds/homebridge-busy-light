import type { API } from 'homebridge';
import { BusyLightPlatform } from './platform.js';
import { PLATFORM_NAME } from './names.js';

export default (api: API): void => {
  api.registerPlatform(PLATFORM_NAME, BusyLightPlatform);
};
