import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  addressChanged,
  callSwitchTimeout, calendarsNotInUse, inputClockOff, inputFailed, inputNotLocal, inputPlainKeyOff, inputStarted, inputWrongKey,
  formatTime, formatWhen, listedCalendarGone, repeatLimit, senderCleared, senderExpired, senderReports, statusLine, workingOff, workingOn,
} from '../src/messages.js';

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

test('the build 3 status input lines are verbatim from SPEC section 12', () => {
  assert.equal(inputStarted(8582), specLine('Input started').replace('{port}', '8582'));
  const [inUse, other] = specLines('Input failed');
  assert.equal(inputFailed(8582, null), inUse.replace('{port}', '8582'));
  assert.equal(inputFailed(8582, 'EACCES'), `Status input could not start${other.replace('{short reason}', 'EACCES')}`);
  assert.equal(inputWrongKey('192.168.4.20'), specLine('Wrong key').replace('{ip}', '192.168.4.20'));
  assert.equal(inputClockOff('192.168.4.20', 301), specLine('Clock off').replace('{ip}', '192.168.4.20').replace('{n}', '301'));
  assert.equal(inputPlainKeyOff('192.168.4.20'), specLine('Plain key off').replace('{ip}', '192.168.4.20'));
  assert.equal(inputNotLocal('203.0.113.9'), specLine('Not local').replace('{ip}', '203.0.113.9'));
});

test('the address change line is verbatim from SPEC section 12', () => {
  assert.equal(addressChanged('192.168.4.10', '192.168.4.23'),
    specLine('Address changed').replace('{old}', '192.168.4.10').replace('{new}', '192.168.4.23'));
});

test('the On a Call timeout line is verbatim from SPEC section 12, singular for 1', () => {
  assert.equal(callSwitchTimeout('Busy Light', 3), specLine('Call switch timeout').replace('{name}', 'Busy Light').replace('{n}', '3'));
  assert.equal(callSwitchTimeout('Busy Light', 1), 'Busy Light On a Call turned itself off after 1 hour.');
});

test('the Repeat limit line is verbatim from SPEC section 12', () => {
  assert.equal(repeatLimit('Rota'), specLine('Repeat limit').replace('{name}', 'Rota'));
});

test('until times carry their day when they are not today (SPEC 12 {when}, 11.3 G)', () => {
  // Thursday October 8, 2026, 3:00 PM on the host's clock.
  const now = new Date(2026, 9, 8, 15).getTime();
  const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute).getTime();
  assert.equal(formatWhen(at(8, 16, 30), now), formatTime(at(8, 16, 30)), 'today: the time alone');
  assert.equal(formatWhen(at(9, 9), now), `tomorrow at ${formatTime(at(9, 9))}`);
  assert.equal(formatWhen(at(10, 9), now), `Saturday at ${formatTime(at(10, 9))}`);
  assert.equal(formatWhen(at(12, 9), now), `Monday at ${formatTime(at(12, 9))}`);
  assert.equal(formatWhen(at(14, 9), now), `Wednesday at ${formatTime(at(14, 9))}`, 'within the next 6 days');
  assert.equal(formatWhen(at(15, 9), now), `October 15 at ${formatTime(at(15, 9))}`, 'a week on');
  assert.equal(formatWhen(new Date(2026, 10, 2, 9).getTime(), now), `November 2 at ${formatTime(new Date(2026, 10, 2, 9).getTime())}`);
  // Across midnight: 11:50 PM until 12:10 AM is tomorrow.
  assert.equal(formatWhen(at(9, 0, 10), at(8, 23, 50)), `tomorrow at ${formatTime(at(9, 0, 10))}`);
  const [line] = specLines('Status change');
  assert.ok(line.endsWith('until {when}).'));
  assert.equal(statusLine('Available', { source: null, until: at(9, 9) }, now), `Status: Available (until tomorrow at ${formatTime(at(9, 9))}).`);
  assert.equal(statusLine('In a meeting', { source: 'Work', until: at(8, 15, 30) }, now), `Status: In a meeting (Work, until ${formatTime(at(8, 15, 30))}).`);
});

test('the Working lines are verbatim from SPEC section 12', () => {
  assert.equal(workingOff('Busy Light'), specLine('Working off').replace('{name}', 'Busy Light'));
  assert.equal(workingOn('Busy Light'), specLine('Working on').replace('{name}', 'Busy Light'));
});

test('log and CLI times read h:mm AM and h:mm PM whatever the host\'s locale (SPEC 12, build 3.3)', () => {
  const original = Intl.DateTimeFormat;
  // A host whose locale writes "9:00 am", as the Pi's did.
  Intl.DateTimeFormat = function (_locales?: string | string[], options?: Intl.DateTimeFormatOptions) {
    return new original('en-GB', options);
  } as unknown as typeof Intl.DateTimeFormat;
  try {
    assert.notEqual(new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(2026, 9, 12, 9)), '9:00 AM');
    assert.equal(formatTime(new Date(2026, 9, 12, 9).getTime()), '9:00 AM');
    assert.equal(formatTime(new Date(2026, 9, 12, 0, 5).getTime()), '12:05 AM');
    assert.equal(formatTime(new Date(2026, 9, 12, 12).getTime()), '12:00 PM');
    assert.equal(formatTime(new Date(2026, 9, 12, 21, 30).getTime()), '9:30 PM');
    // Friday October 9, 2026, 3:00 PM, with nothing until Monday morning.
    assert.equal(statusLine('Available', { source: null, until: new Date(2026, 9, 12, 9).getTime() }, new Date(2026, 9, 9, 15).getTime()),
      'Status: Available (until Monday at 9:00 AM).');
  } finally {
    Intl.DateTimeFormat = original;
  }
});
