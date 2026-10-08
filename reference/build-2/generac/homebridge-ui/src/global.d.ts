import type { IHomebridgePluginUi } from '@homebridge/plugin-ui-utils/ui.interface';

declare global {
  interface Window {
    /** Injected by the Homebridge UI into the settings iframe. */
    homebridge: IHomebridgePluginUi;
  }
}
