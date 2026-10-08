import { test } from 'node:test';
import assert from 'node:assert/strict';
import ICAL from 'ical.js';
import { classify, outOfOfficePattern, readIcs } from '../src/ics.js';
import { resolveStatus } from '../src/status.js';
import type { CalEvent } from '../src/status.js';
import { fixture, fixtureTitles } from './helpers.js';

const DAY = 86_400_000;
const opts = { source: 'Family', outOfOfficeWords: ['Out of office', 'OOO', 'Vacation', 'PTO'], ownerAddresses: ['person@example.com'] };
const at = (y: number, mo: number, d: number, h: number, mi = 0) => Date.UTC(y, mo - 1, d, h, mi);
const read = (text: string, now: number) => readIcs(text, now - DAY, now + DAY, opts);
const startingAt = (events: CalEvent[], start: number) => events.filter((e) => e.start === start);

// Thursday October 8, 2026, 11:00 in New York (EDT), 15:00 UTC.
const now = at(2026, 10, 8, 15);
const ics = fixture('calendar.ics');

test('the fixture reads into the expected events', () => {
  const events = read(ics, now);
  assert.equal(events.length, 9);
  assert.ok(events.every((e) => e.source === 'Family'));
  assert.deepEqual(Object.keys(events[0]).sort(), ['end', 'isAllDay', 'isCancelled', 'showAs', 'source', 'start'],
    'nothing else about an event is kept');
});

test('a weekly series in a time zone', () => {
  const events = read(ics, now);
  const sync = startingAt(events, at(2026, 10, 8, 15));
  assert.equal(sync.length, 1, 'only the sync starts at 11:00 Eastern: the other series moved this week');
  assert.equal(sync[0].end, at(2026, 10, 8, 15, 30));
  assert.equal(sync[0].showAs, 'busy');
  assert.equal(sync[0].isAllDay, false);
});

test('a moved occurrence belongs to its own series only', () => {
  const events = read(ics, now);
  const moved = startingAt(events, at(2026, 10, 8, 17));
  assert.equal(moved.length, 1, 'the one on one moved to 13:00 Eastern');
  assert.equal(moved[0].end, at(2026, 10, 8, 18));
  assert.equal(startingAt(events, at(2026, 10, 8, 15)).filter((e) => e.end - e.start === 3_600_000).length, 0,
    'the one on one is not also at its usual time');
});

test('free, declined, cancelled, tentative and out of office', () => {
  const events = read(ics, now);
  assert.equal(startingAt(events, at(2026, 10, 8, 16))[0].showAs, 'free');
  assert.equal(startingAt(events, at(2026, 10, 8, 18))[0].showAs, 'free', 'a declined invitation is free');
  const cancelled = startingAt(events, at(2026, 10, 8, 19))[0];
  assert.equal(cancelled.isCancelled, true);
  assert.equal(startingAt(events, at(2026, 10, 8, 20))[0].showAs, 'tentative');
  const leave = events.filter((e) => e.isAllDay);
  assert.equal(leave.length, 1);
  assert.equal(leave[0].showAs, 'oof', 'the out of office word applies even though the event is marked free');
  assert.equal(leave[0].start, new Date(2026, 9, 8).getTime(), 'all-day events are read in the host time zone');
  assert.equal(leave[0].end, new Date(2026, 9, 10).getTime());
});

test('events outside the window and unreadable events are left out', () => {
  const events = read(ics, now);
  assert.ok(events.every((e) => e.end > now - DAY && e.start < now + DAY));
  assert.ok(!events.some((e) => e.start === at(2026, 10, 8, 21) || e.end === at(2026, 10, 8, 21)), 'the bad event is skipped');
});

test('a daily series across the window', () => {
  const events = read(ics, now);
  const standups = events.filter((e) => e.end - e.start === 15 * 60_000);
  assert.deepEqual(standups.map((e) => e.start), [at(2026, 10, 8, 13), at(2026, 10, 9, 13)]);
});

test('daylight saving: before, across and after the November 1 change', () => {
  const before = read(ics, at(2026, 10, 29, 15));
  const sync = (events: CalEvent[], start: number) => startingAt(events, start).filter((e) => e.end - e.start === 30 * 60_000);
  assert.equal(sync(before, at(2026, 10, 29, 15)).length, 1, 'sync at 11:00 EDT is 15:00 UTC');
  assert.equal(startingAt(before, at(2026, 10, 29, 15)).length, 2, 'and the one on one is back at its usual time');
  assert.equal(startingAt(before, at(2026, 10, 29, 13)).length, 1, 'standup at 09:00 EDT is 13:00 UTC');

  const across = read(ics, at(2026, 11, 1, 12));
  const standups = across.filter((e) => e.end - e.start === 15 * 60_000).map((e) => e.start);
  assert.deepEqual(standups, [at(2026, 10, 31, 13), at(2026, 11, 1, 14)], 'one standup each side of the change');

  const after = read(ics, at(2026, 11, 5, 16));
  assert.equal(sync(after, at(2026, 11, 5, 16)).length, 1, 'sync at 11:00 EST is 16:00 UTC');
  assert.equal(sync(after, at(2026, 11, 5, 15)).length, 0);
  assert.equal(startingAt(after, at(2026, 11, 5, 14)).length, 1, 'standup at 09:00 EST is 14:00 UTC');
});

test('the status from the fixture', () => {
  const events = read(ics, now);
  const o = { ignoreAllDayBusy: true };
  assert.deepEqual(resolveStatus(false, null, events, now, o).status, 'outOfOffice', 'the all-day leave decides');
  const timed = events.filter((e) => !e.isAllDay);
  assert.deepEqual(resolveStatus(false, null, timed, now, o), { status: 'inMeeting', reason: { source: 'Family', until: at(2026, 10, 8, 15, 30) } });
});

test('one unreadable recurrence rule does not drop the calendar', () => {
  const badRule = ['BEGIN:VEVENT', 'UID:single-bad-rule', 'SUMMARY:Synthetic unreadable rule', 'DTSTART:20261008T100000Z',
    'DTEND:20261008T110000Z', 'RRULE:FREQ=WEEKLY;BYDAY=XX', 'END:VEVENT'].join('\r\n');
  assert.throws(() => ICAL.parse(ics.replace('END:VCALENDAR', `${badRule}\r\nEND:VCALENDAR`)), 'ical.js rejects the whole file');
  const events = read(ics.replace('END:VCALENDAR', `${badRule}\nEND:VCALENDAR`), now);
  assert.equal(events.length, 9);
  assert.equal(startingAt(events, at(2026, 10, 8, 15)).length, 1, 'time zones still apply');
  assert.equal(startingAt(events, at(2026, 10, 8, 17)).length, 1, 'exceptions still apply');
});

test('CRLF line endings read the same', () => {
  assert.deepEqual(read(ics.replace(/\n/g, '\r\n'), now), read(ics, now));
});

test('data that is not a calendar throws', () => {
  assert.throws(() => read('<html>not a calendar</html>', now));
});

test('a changed occurrence without its series is a single event', () => {
  const text = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:orphan', 'RECURRENCE-ID:20261008T140000Z',
    'DTSTART:20261008T143000Z', 'DTEND:20261008T153000Z', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  assert.deepEqual(read(text, now), [{ showAs: 'busy', start: at(2026, 10, 8, 14, 30), end: at(2026, 10, 8, 15, 30), isAllDay: false,
    isCancelled: false, source: 'Family' }]);
});

test('a series stops at 20,000 iterations', () => {
  const text = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:every-minute', 'DTSTART:20000101T000000Z',
    'DTEND:20000101T000030Z', 'RRULE:FREQ=MINUTELY', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const started = Date.now();
  assert.deepEqual(read(text, now), [], 'the window is never reached');
  assert.ok(Date.now() - started < 10_000);
});

test('classification rules in order', () => {
  const oof = outOfOfficePattern(opts.outOfOfficeWords);
  const comp = (lines: string[]) => new ICAL.Component(ICAL.parse(['BEGIN:VEVENT', 'UID:x', 'DTSTART:20261008T100000Z', ...lines,
    'END:VEVENT'].join('\r\n')) as unknown[]);
  const c = (lines: string[]) => classify(comp(lines), oof, ['person@example.com']);
  assert.deepEqual(c(['STATUS:CANCELLED']), { showAs: 'busy', isCancelled: true });
  assert.deepEqual(c(['ATTENDEE;PARTSTAT=DECLINED:mailto:person@example.com', 'X-MICROSOFT-CDO-BUSYSTATUS:OOF']),
    { showAs: 'free', isCancelled: false }, 'declined comes before out of office');
  assert.deepEqual(c(['ATTENDEE;PARTSTAT=DECLINED:mailto:someone@example.net']), { showAs: 'busy', isCancelled: false });
  assert.deepEqual(c(['X-MICROSOFT-CDO-BUSYSTATUS:OOF', 'TRANSP:TRANSPARENT']), { showAs: 'oof', isCancelled: false });
  assert.deepEqual(c(['SUMMARY:PTO (synthetic)', 'TRANSP:TRANSPARENT']), { showAs: 'oof', isCancelled: false });
  assert.deepEqual(c(['X-MICROSOFT-CDO-BUSYSTATUS:FREE']), { showAs: 'free', isCancelled: false });
  assert.deepEqual(c(['X-MICROSOFT-CDO-BUSYSTATUS:TENTATIVE']), { showAs: 'tentative', isCancelled: false });
  assert.deepEqual(c(['STATUS:TENTATIVE', 'TRANSP:TRANSPARENT']), { showAs: 'free', isCancelled: false });
  assert.deepEqual(c([]), { showAs: 'busy', isCancelled: false });
});

test('out of office words match whole words without regard to case', () => {
  const oof = outOfOfficePattern(['Out of office', 'OOO', 'PTO', 'Vacation', 'a.b'])!;
  for (const yes of ['ooo', 'Synthetic OOO today', 'out of OFFICE', 'PTO: synthetic', 'Synthetic (vacation)', 'a.b']) {
    assert.ok(oof.test(yes), yes);
  }
  for (const no of ['Synthetic photoshoot', 'PTOs', 'Vacationing', 'Spoof', 'axb', 'OOOO']) {
    assert.ok(!oof.test(no), no);
  }
  assert.equal(outOfOfficePattern([]), null);
  assert.equal(outOfOfficePattern([' ']), null);
});

test('fixture titles are synthetic', () => {
  const titles = fixtureTitles();
  assert.ok(titles.length >= 8);
  assert.ok(titles.every((t) => t.startsWith('Synthetic')));
});
