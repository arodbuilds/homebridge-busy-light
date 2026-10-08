import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { calendarsNotInUse, listedCalendarGone, senderCleared, senderExpired, senderReports } from '../src/messages.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const spec = fs.readFileSync(path.join(root, 'SPEC.md'), 'utf8');

/** Every quoted line of a SPEC section 12 row, by its "When" column. */
function specLines(when: string): string[] {
  const section = spec.slice(spec.indexOf('## 12. Logging'), spec.indexOf('## 13.'));
  const row = section.split('\n').find((l) => l.startsWith(`| ${when} |`));
  assert.ok(row, when);
  return [...row.split('|')[3].matchAll(/`([^`]+)`/g)].map((m) => m[1]);
}

/** The line of a SPEC section 12 row, by its "When" column. */
function specLine(when: string): string {
  const section = spec.slice(spec.indexOf('## 12. Logging'), spec.indexOf('## 13.'));
  const row = section.split('\n').find((l) => l.startsWith(`| ${when} |`));
  assert.ok(row, when);
  return /`([^`]+)`/.exec(row.split('|')[3])![1];
}

test('the build 2 log lines are verbatim from SPEC section 12', () => {
  assert.equal(calendarsNotInUse('Family', ['Home', 'Work']),
    specLine('New calendars').replace('{name}', 'Family').replace('{a, b}', 'Home, Work'));
  assert.equal(listedCalendarGone('Work', 'Holidays'),
    specLine('Listed calendar gone').replace('{name}', 'Work').replace('{calendar}', 'Holidays'));
});

test('the build 3 sender lines are verbatim from SPEC section 12', () => {
  const sender = 'CallWatch on Alex’s iMac';
  const [plain, withApp] = specLines('Sender changed');
  assert.equal(senderReports(sender, 'In a call', null), plain.replace('{sender}', sender).replace('{Display name}', 'In a call'));
  assert.equal(senderReports(sender, 'In a call', 'Zoom'),
    withApp.replace('{sender}', sender).replace('{Display name}', 'In a call').replace('{app}', 'Zoom'));
  assert.equal(senderCleared(sender), specLine('Sender cleared').replace('{sender}', sender));
  assert.equal(senderExpired(sender), specLine('Sender expired').replace('{sender}', sender));
});
