import { copyFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The page banner is served from the plugin's own public folder, never from an external host (SPEC section 11.2).
 * The copy is made here so assets/ stays the one source of the artwork; the copy is gitignored and published with
 * the page. The page's own scripts are compiled by `tsc -p homebridge-ui` into homebridge-ui/public/js.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
copyFileSync(resolve(root, 'assets/generac-banner.png'), resolve(root, 'homebridge-ui/public/generac-banner.png'));
