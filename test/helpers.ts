/**
 * Shared test doubles. Nothing here touches the network: tests that need HTTP install a fake `fetch` that answers
 * from routes and throws on anything else.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// Fixtures live next to the TS source; tests run from build-test/, so walk up.
export const fixturesDir = path.resolve(here, '..', '..', 'test', 'fixtures');

export function fixture(name: string): string {
  return fs.readFileSync(path.join(fixturesDir, name), 'utf8');
}

/** Every SUMMARY in the iCalendar fixtures: none of these may ever reach a log line or the state file. */
export function fixtureTitles(): string[] {
  const titles = new Set<string>();
  for (const name of fs.readdirSync(fixturesDir)) {
    const text = fs.readFileSync(path.join(fixturesDir, name), 'utf8');
    for (const m of text.matchAll(/^SUMMARY[^:\r\n]*:(.+?)\r?$/gm)) {
      titles.add(m[1].trim());
    }
  }
  return [...titles];
}

export function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
}
