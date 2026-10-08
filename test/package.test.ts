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
  assert.deepEqual(pkg.files, ['dist', 'config.schema.json', 'LICENSE', 'NOTICE', 'README.md', 'CHANGELOG.md', 'SECURITY.md']);
  assert.ok(pkg.keywords.includes('homebridge-plugin'));
  assert.ok(pkg.keywords.includes('busylight'));
});

test('runtime dependencies are limited to ical.js', () => {
  assert.deepEqual(Object.keys(pkg.dependencies), ['ical.js']);
});

test('names and version', () => {
  assert.equal(PLATFORM_NAME, 'BusyLight');
  assert.equal(packageVersion(), pkg.version);
});
