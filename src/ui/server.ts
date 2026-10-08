/**
 * The settings page's server side (SPEC section 10.3). Started by the Homebridge UI as a child process through
 * homebridge-ui/server.js; the platform never loads this module. It reuses the plugin's own modules.
 */
import { HomebridgePluginUiServer } from '@homebridge/plugin-ui-utils';
import { packageVersion } from '../names.js';

type Handler = (payload: unknown) => Promise<unknown>;

export interface UiServerOptions {
  version?: string;
}

export class BusyLightUiHandlers {
  private readonly version: string;

  constructor(opts: UiServerOptions = {}) {
    this.version = opts.version ?? packageVersion();
  }

  /** The request paths of SPEC section 10.3 and their handlers, for HomebridgePluginUiServer.onRequest. */
  routes(): Record<string, Handler> {
    return {
      '/version': async () => ({ version: this.version }),
    };
  }
}

/** The process the Homebridge UI starts (homebridge-ui/server.js). */
export class BusyLightUiServer extends HomebridgePluginUiServer {
  constructor() {
    super();
    const handlers = new BusyLightUiHandlers();
    for (const [route, handler] of Object.entries(handlers.routes())) {
      this.onRequest(route, handler);
    }
    this.ready();
  }
}

export function startUiServer(): BusyLightUiServer {
  return new BusyLightUiServer();
}
