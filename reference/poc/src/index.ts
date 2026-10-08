import type { API } from 'homebridge';
import { M365StatusPlatform, PLATFORM_NAME, PLUGIN_NAME } from './platform';

export default (api: API): void => {
  api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, M365StatusPlatform);
};
