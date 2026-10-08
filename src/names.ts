/**
 * Names and fixed values from SPEC section 3. Everything the plugin writes lives in
 * `<Homebridge storage path>/busy-light/`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PLUGIN_NAME = 'homebridge-busy-light';
export const PLATFORM_NAME = 'BusyLight';
export const DISPLAY_NAME = 'Busy Light';
export const STORAGE_DIR = 'busy-light';
/** Left in the storage directory by the settings page's Reset (SPEC 10.3 item 6); the platform acts on it at startup. */
export const RESET_MARKER = 'reset-pending';

let cachedVersion: string | null = null;

/** The package version, read from the nearest package.json named homebridge-busy-light. */
export function packageVersion(): string {
  if (cachedVersion) {
    return cachedVersion;
  }
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i++) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) as { name?: string; version?: string };
      if (pkg.name === PLUGIN_NAME && pkg.version) {
        cachedVersion = pkg.version;
        return cachedVersion;
      }
    } catch {
      // keep walking up
    }
    dir = path.dirname(dir);
  }
  return '0.0.0';
}
