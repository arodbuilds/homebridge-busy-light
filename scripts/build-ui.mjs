import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The page banner is served from the plugin's own public folder, never from another host (SPEC section 11.1). The
 * copy is made here so assets/ stays the one source of the artwork; the copy is gitignored and published with the
 * page. The footer mark is drawn inline from homebridge-ui/src/mark.ts, so no file is loaded for it. The page's own
 * scripts are compiled by `tsc -p homebridge-ui` into homebridge-ui/public/js.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(resolve(root, 'homebridge-ui/public'), { recursive: true });
copyFileSync(resolve(root, 'assets/busy-light-banner.png'), resolve(root, 'homebridge-ui/public/busy-light-banner.png'));
