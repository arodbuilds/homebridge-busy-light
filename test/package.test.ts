import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packageVersion, PLATFORM_NAME, PLUGIN_NAME } from '../src/names.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

test('package.json follows SPEC section 3', () => {
  assert.equal(pkg.name, PLUGIN_NAME);
  assert.equal(pkg.displayName, 'Busy Light');
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.private, undefined);
  assert.equal(pkg.main, 'dist/index.js');
  assert.deepEqual(pkg.bin, { 'homebridge-busy-light': 'dist/cli.js' });
  assert.equal(pkg.license, 'Apache-2.0');
  assert.equal(pkg.author, 'Alex Rodriguez (https://alex-rodriguez.com)');
  assert.deepEqual(pkg.engines, { node: '^20.18.0 || ^22.10.0 || ^24.0.0', homebridge: '^1.8.0 || ^2.0.0-beta.0' });
  assert.deepEqual(pkg.files, [
    'dist', 'homebridge-ui/public', 'homebridge-ui/server.js', 'config.schema.json', 'LICENSE', 'NOTICE', 'README.md', 'CHANGELOG.md', 'SECURITY.md',
  ]);
  assert.ok(pkg.keywords.includes('homebridge-plugin'));
  assert.ok(pkg.keywords.includes('busylight'));
});

test('runtime dependencies are limited to ical.js and, from build 2, @homebridge/plugin-ui-utils', () => {
  assert.deepEqual(Object.keys(pkg.dependencies).sort(), ['@homebridge/plugin-ui-utils', 'ical.js']);
});

test('the settings page is built by build:ui and served from homebridge-ui (SPEC section 11)', () => {
  assert.equal(pkg.scripts.build, 'rimraf ./dist && tsc && npm run build:ui');
  assert.equal(pkg.scripts['build:ui'], 'rimraf ./homebridge-ui/public/js && tsc -p homebridge-ui && node scripts/build-ui.mjs');
  const schema = JSON.parse(fs.readFileSync(path.join(root, 'config.schema.json'), 'utf8'));
  assert.equal(schema.customUi, true);
  assert.ok(fs.existsSync(path.join(root, 'homebridge-ui', 'server.js')));
  assert.ok(fs.existsSync(path.join(root, 'homebridge-ui', 'public', 'busy-light-banner.png')), 'the build copies the banner beside the bundle');
});

test('names and version', () => {
  assert.equal(PLATFORM_NAME, 'BusyLight');
  assert.equal(packageVersion(), pkg.version);
});
