import { test } from 'node:test';
import assert from 'node:assert/strict';
import ICAL from 'ical.js';
import { MAX_ITERATIONS, classify, outOfOfficePattern, readIcs } from '../src/ics.js';
import { xmlBlocks, xmlText } from '../src/xml.js';
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

test('a minutely series started in 2000 gives the window\'s occurrences, well inside the cap (SPEC 5.4 item 3)', () => {
  const text = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:every-minute', 'DTSTART:20000101T000000Z',
    'DTEND:20000101T000030Z', 'RRULE:FREQ=MINUTELY', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  let limited = 0;
  const started = Date.now();
  const events = readIcs(text, now - DAY, now + DAY, { ...opts, onRepeatLimit: () => limited++ });
  assert.equal(events.length, 2 * 24 * 60, 'every minute of the two-day window');
  assert.equal(limited, 0);
  assert.ok(Date.now() - started < 2000);
});

test('a series repeating every second reaches the cap, which says so once per read (SPEC 5.4 item 3)', () => {
  const series = (uid: string) => ['BEGIN:VEVENT', `UID:${uid}`, 'DTSTART:20261001T000000Z', 'DTEND:20261001T000001Z', 'RRULE:FREQ=SECONDLY', 'END:VEVENT'];
  const text = ['BEGIN:VCALENDAR', 'VERSION:2.0', ...series('one'), ...series('two'), 'END:VCALENDAR'].join('\r\n');
  let limited = 0;
  readIcs(text, now - DAY, now + DAY, { ...opts, onRepeatLimit: () => limited++ });
  assert.equal(limited, 1);
  assert.equal(MAX_ITERATIONS, 20_000);
});

test('an hourly series started in 2023 gives today\'s occurrences (SPEC 5.4 item 3)', () => {
  const text = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:hourly', 'SUMMARY:Synthetic hourly check-in', 'DTSTART:20230102T090000Z',
    'DTEND:20230102T091000Z', 'RRULE:FREQ=HOURLY', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const events = read(text, now);
  assert.equal(events.length, 48);
  assert.deepEqual(events.map((e) => e.start).sort((a, b) => a - b).slice(0, 2), [at(2026, 10, 7, 15), at(2026, 10, 7, 16)]);
  assert.ok(events.every((e) => new Date(e.start).getUTCMinutes() === 0 && e.end - e.start === 10 * 60_000));
});

test('a series that ended before the window is not walked, by UNTIL or by COUNT (SPEC 5.4 item 3)', () => {
  const series = (uid: string, rule: string) => ['BEGIN:VEVENT', `UID:${uid}`, 'DTSTART:20160104T140000Z', 'DTEND:20160104T143000Z',
    `RRULE:${rule}`, 'END:VEVENT'];
  const text = ['BEGIN:VCALENDAR', 'VERSION:2.0', ...series('until', 'FREQ=DAILY;UNTIL=20190601T000000Z'), ...series('count', 'FREQ=DAILY;COUNT=1000'),
    ...series('open', 'FREQ=DAILY'), 'END:VCALENDAR'].join('\r\n');
  const events = read(text, now);
  assert.deepEqual(events.map((e) => e.start).sort((a, b) => a - b), [at(2026, 10, 8, 14), at(2026, 10, 9, 14)], 'the open series only');
});

/** The review's feed (SPEC 15 item 25): 100 daily series that ended in 2019, 300 open daily series started in 2016, 100 weekly series, 5,000 single events. */
function reviewFeed(): string {
  const tz = ics.slice(ics.indexOf('BEGIN:VTIMEZONE'), ics.indexOf('END:VTIMEZONE') + 'END:VTIMEZONE'.length);
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Busy Light tests//Synthetic//EN', tz];
  const event = (uid: string, start: string, end: string, extra: string[]) => lines.push('BEGIN:VEVENT', `UID:${uid}`, `SUMMARY:Synthetic ${uid}`,
    `DTSTART;TZID=America/New_York:${start}`, `DTEND;TZID=America/New_York:${end}`, ...extra, 'END:VEVENT');
  const two = (n: number) => String(n).padStart(2, '0');
  for (let i = 0; i < 100; i++) {
    event(`ended-${i}`, '20160104T090000', '20160104T093000', [i % 2 ? 'RRULE:FREQ=DAILY;UNTIL=20190601T000000Z' : 'RRULE:FREQ=DAILY;COUNT=1000']);
  }
  for (let i = 0; i < 300; i++) {
    const day = `201601${two(1 + (i % 28))}T${two(8 + (i % 9))}`;
    event(`open-${i}`, `${day}0000`, `${day}3000`, ['RRULE:FREQ=DAILY']);
  }
  for (let i = 0; i < 100; i++) {
    event(`weekly-${i}`, '20180105T100000', '20180105T110000', ['RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR']);
  }
  for (let i = 0; i < 5000; i++) {
    const d = new Date(Date.UTC(2020, 0, 1) + i * 9 * 3_600_000);
    const stamp = `${d.getUTCFullYear()}${two(d.getUTCMonth() + 1)}${two(d.getUTCDate())}T${two(d.getUTCHours())}`;
    event(`single-${i}`, `${stamp}0000`, `${stamp}4500`, []);
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

test('the review\'s feed reads in under 1 second (SPEC 5.4 item 3, 15 item 25)', () => {
  const feed = reviewFeed();
  const started = performance.now();
  const events = read(feed, now);
  const took = performance.now() - started;
  assert.ok(took < 1000, `took ${Math.round(took)} ms`);
  assert.equal(events.filter((e) => e.end - e.start === 30 * 60_000).length, 600, 'each open daily series twice in the window');
  assert.equal(events.filter((e) => e.end - e.start === 60 * 60_000).length, 100, 'Friday of each weekly series (Wednesday\'s ends as the window starts)');
});

test('the review\'s feed reads in under 1 second over the 7 day window too (SPEC 5, build 3.3)', () => {
  const feed = reviewFeed();
  const started = performance.now();
  const events = readIcs(feed, now - DAY, now + 7 * DAY, opts);
  const took = performance.now() - started;
  assert.ok(took < 1000, `took ${Math.round(took)} ms`);
  assert.equal(events.filter((e) => e.end - e.start === 30 * 60_000).length, 2400, 'each open daily series on each of the 8 days');
  assert.equal(events.filter((e) => e.end - e.start === 60 * 60_000).length, 300, 'Friday, Monday and Wednesday of each weekly series');
});

// Build 3.1's reader, kept as the reference (SPEC 5.4 item 3.6): every series walked from DTSTART in full, with no cap.

function walkInFull(text: string, from: number, to: number): CalEvent[] {
  const oof = outOfOfficePattern(opts.outOfOfficeWords);
  const out: CalEvent[] = [];
  const push = (comp: InstanceType<typeof ICAL.Component>, s: InstanceType<typeof ICAL.Time>, e: InstanceType<typeof ICAL.Time>) => {
    const start = s.toJSDate().getTime();
    const end = e.toJSDate().getTime();
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start && end > from && start < to) {
      out.push({ ...classify(comp, oof, opts.ownerAddresses), start, end, isAllDay: s.isDate, source: opts.source });
    }
  };
  const root = new ICAL.Component(ICAL.parse(text) as unknown[]);
  const masters = root.getAllSubcomponents('vevent').filter((v) => !v.hasProperty('recurrence-id'));
  const changes = root.getAllSubcomponents('vevent').filter((v) => v.hasProperty('recurrence-id'));
  for (const master of masters) {
    const uid = master.getFirstPropertyValue('uid');
    try {
      const event = new ICAL.Event(master, { exceptions: changes.filter((c) => c.getFirstPropertyValue('uid') === uid) });
      if (!event.isRecurring()) {
        push(master, event.startDate, event.endDate);
        continue;
      }
      const iterator = event.iterator();
      for (let next = iterator.next(); next; next = iterator.next()) {
        const details = event.getOccurrenceDetails(next);
        if (details.startDate.toJSDate().getTime() >= to && next.toJSDate().getTime() >= to) {
          break;
        }
        push(details.item.component, details.startDate, details.endDate);
      }
    } catch {
      // As the reader: an event that cannot be read is skipped.
    }
  }
  return out;
}

const sorted = (events: CalEvent[]) => events.map((e) => `${e.start} ${e.end} ${e.showAs} ${e.isAllDay} ${e.isCancelled}`).sort();

test('every fixture reads as walking each series in full, at windows across more than a year (SPEC 5.4 item 3.6)', () => {
  const calendars = [ics, ...['default-ns-report-home.xml', 'prefixed-report-work.xml'].flatMap((f) => xmlBlocks(fixture(`caldav/${f}`), 'calendar-data')
    .map(xmlText).filter((text) => text.includes('BEGIN:VCALENDAR')))];
  assert.ok(calendars.length >= 4, 'the fixture and the calendar objects of the CalDAV reports');
  let compared = 0;
  for (const text of calendars) {
    for (let t = at(2026, 1, 1, 3); t < at(2027, 3, 1, 0); t += 71 * 3_600_000) {
      assert.deepEqual(sorted(read(text, t)), sorted(walkInFull(text, t - DAY, t + DAY)), new Date(t).toISOString());
      compared++;
    }
  }
  assert.ok(compared > 600);
});

test('generated series of every frequency read as walking them in full, across daylight saving changes (SPEC 5.4 item 3.6)', () => {
  const tz = ics.slice(ics.indexOf('BEGIN:VTIMEZONE'), ics.indexOf('END:VTIMEZONE') + 'END:VTIMEZONE'.length);
  const rules = [
    'FREQ=DAILY', 'FREQ=DAILY;INTERVAL=3;BYHOUR=9,17', 'FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR', 'FREQ=WEEKLY', 'FREQ=WEEKLY;BYDAY=MO,WE,FR',
    'FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH', 'FREQ=WEEKLY;WKST=SU;INTERVAL=2;BYDAY=SU,SA', 'FREQ=MONTHLY', 'FREQ=MONTHLY;INTERVAL=2;BYDAY=2TU',
    'FREQ=MONTHLY;BYDAY=-1FR', 'FREQ=MONTHLY;BYMONTHDAY=15,-1', 'FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1', 'FREQ=YEARLY',
    'FREQ=YEARLY;BYMONTH=10;BYDAY=2TH', 'FREQ=YEARLY;BYWEEKNO=41;BYDAY=TH', 'FREQ=YEARLY;BYYEARDAY=281,282', 'FREQ=HOURLY;INTERVAL=5',
    'FREQ=HOURLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9,10,11', 'FREQ=MINUTELY;INTERVAL=45', 'FREQ=DAILY;UNTIL=20261009T000000Z', 'FREQ=DAILY;COUNT=400',
    'FREQ=WEEKLY;BYDAY=TH;COUNT=30', 'FREQ=WEEKLY;BYDAY=TH;UNTIL=20261231', 'FREQ=MONTHLY;COUNT=12',
    // From the review before the pull request: monthly rules with BYMONTH, and yearly days a start may not be on.
    'FREQ=MONTHLY;BYMONTH=3,6,9,12;BYDAY=-1FR', 'FREQ=MONTHLY;BYMONTH=10,11', 'FREQ=MONTHLY;INTERVAL=2;BYMONTH=1,4,10;BYMONTHDAY=8,9',
    'FREQ=MONTHLY;BYMONTH=10;BYDAY=TH;BYSETPOS=2', 'FREQ=YEARLY;BYMONTH=10;BYMONTHDAY=8,9', 'FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29',
  ];
  // Starts far enough back for the walk to start late, and near enough for the full walk it is compared with to stay
  // quick: a month's last day, a daylight saving day in UTC (with an EXDATE), and for monthly and yearly series a
  // February 29.
  const starts = (rule: string) => (/HOURLY|MINUTELY/.test(rule) ? ['20260830T113000', '20260831T013000']
    : /MONTHLY|YEARLY/.test(rule) ? ['20250131T113000', '20251102T013000', '20240229T013000']
      : ['20260131T113000', '20251102T013000']);
  let compared = 0;
  for (const rule of rules) {
    for (const [i, start] of starts(rule).entries()) {
      const end = `${start.slice(0, 9)}${String((Number(start.slice(9, 11)) + 1) % 24).padStart(2, '0')}${start.slice(11)}`;
      const when = i === 1 ? [`DTSTART:${start}Z`, `DTEND:${end}Z`, 'EXDATE:20261008T013000Z']
        : [`DTSTART;TZID=America/New_York:${start}`, `DTEND;TZID=America/New_York:${end}`, 'EXDATE;TZID=America/New_York:20261008T113000'];
      const text = ['BEGIN:VCALENDAR', 'VERSION:2.0', tz, 'BEGIN:VEVENT', 'UID:generated', 'SUMMARY:Synthetic series', ...when, `RRULE:${rule}`,
        'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
      for (let t = at(2026, 9, 20, 2); t < at(2026, 11, 25, 0); t += 7.5 * DAY) {
        assert.deepEqual(sorted(read(text, t)), sorted(walkInFull(text, t - DAY, t + DAY)), `${rule} from ${start} at ${new Date(t).toISOString()}`);
        compared++;
      }
    }
  }
  const allDay = ['FREQ=DAILY', 'FREQ=WEEKLY;BYDAY=FR', 'FREQ=MONTHLY;BYMONTHDAY=9', 'FREQ=YEARLY', 'FREQ=DAILY;INTERVAL=4'];
  for (const rule of allDay) {
    const text = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:all-day', 'SUMMARY:Synthetic all day', 'DTSTART;VALUE=DATE:20231009',
      'DTEND;VALUE=DATE:20231010', `RRULE:${rule}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    for (let t = at(2026, 9, 20, 2); t < at(2026, 11, 25, 0); t += 2.5 * DAY) {
      assert.deepEqual(sorted(read(text, t)), sorted(walkInFull(text, t - DAY, t + DAY)), `${rule} at ${new Date(t).toISOString()}`);
      compared++;
    }
  }
  assert.ok(compared > 400);
});

// The review before the pull request (SPEC 5.4 item 3.2): ical.js steps a monthly rule through its BYMONTH list by
// position, whatever month the walk starts in, and a yearly rule started on a day that is not one of its own reads
// that day's month and day again, so neither is started late.

test('a monthly rule with BYMONTH keeps every occurrence: the last Friday of each quarter, and twice a year on the 15th (SPEC 5.4 item 3.2)', () => {
  const series = (start: string, rule: string) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:by-month', 'SUMMARY:Synthetic review',
    `DTSTART:${start}`, `DTEND:${start.slice(0, 9)}140000Z`, `RRULE:${rule}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const quarter = series('20150327T130000Z', 'FREQ=MONTHLY;BYMONTH=3,6,9,12;BYDAY=-1FR');
  assert.deepEqual(walkInFull(quarter, at(2026, 3, 26, 12), at(2026, 3, 28, 12)).map((e) => e.start), [at(2026, 3, 27, 13)]);
  assert.deepEqual(read(quarter, at(2026, 3, 27, 12)).map((e) => e.start), [at(2026, 3, 27, 13)], 'Friday March 27, 2026');
  const halfYear = series('20150615T130000Z', 'FREQ=MONTHLY;BYMONTH=6,12');
  assert.deepEqual(walkInFull(halfYear, at(2026, 6, 14, 12), at(2026, 6, 16, 12)).map((e) => e.start), [at(2026, 6, 15, 13)]);
  assert.deepEqual(read(halfYear, at(2026, 6, 15, 12)).map((e) => e.start), [at(2026, 6, 15, 13)], 'June 15, 2026');
});

test('a yearly February 29 rule whose start is not on it gains no March 1 (SPEC 5.4 item 3.2)', () => {
  const text = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:leap-day', 'SUMMARY:Synthetic leap day', 'DTSTART:20180726T090000Z',
    'DTEND:20180726T100000Z', 'RRULE:FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  assert.deepEqual(walkInFull(text, at(2027, 2, 28, 12), at(2027, 3, 2, 12)), [], 'nothing in 2027, a year without February 29');
  assert.deepEqual(read(text, at(2027, 3, 1, 12)), []);
  assert.deepEqual(read(text, at(2028, 2, 29, 12)).map((e) => e.start), [at(2028, 2, 29, 9)], 'February 29, 2028');
});

test('a weekly Friday meeting whose next occurrence moved to Thursday shows on Thursday, and not on Friday (SPEC 5.4 item 2)', () => {
  const tz = ics.slice(ics.indexOf('BEGIN:VTIMEZONE'), ics.indexOf('END:VTIMEZONE') + 'END:VTIMEZONE'.length);
  const feed = (master: string[], change: string[]) => ['BEGIN:VCALENDAR', 'VERSION:2.0', tz,
    'BEGIN:VEVENT', 'UID:friday-sync', 'SUMMARY:Synthetic Friday sync', ...master, 'RRULE:FREQ=WEEKLY;BYDAY=FR', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:friday-sync', 'SUMMARY:Synthetic Friday sync', ...change, 'DTSTART:20261015T140000Z', 'DTEND:20261015T143000Z', 'END:VEVENT',
    'END:VCALENDAR'].join('\r\n');
  const utc = ['DTSTART:20260904T150000Z', 'DTEND:20260904T153000Z'];
  const eastern = ['DTSTART;TZID=America/New_York:20260904T110000', 'DTEND;TZID=America/New_York:20260904T113000'];
  const cases = {
    'the same form': feed(utc, ['RECURRENCE-ID:20261016T150000Z']),
    'a RECURRENCE-ID in the series\' time zone': feed(utc, ['RECURRENCE-ID;TZID=America/New_York:20261016T110000']),
    'a RECURRENCE-ID in UTC': feed(eastern, ['RECURRENCE-ID:20261016T150000Z']),
    'the date in EXDATE as well': feed([...utc, 'EXDATE:20261016T150000Z'], ['RECURRENCE-ID:20261016T150000Z']),
  };
  const thursday = at(2026, 10, 15, 14);
  const friday = at(2026, 10, 16, 15);
  for (const [name, text] of Object.entries(cases)) {
    // Wednesday evening: the window ends on Thursday, before the Friday the occurrence moved from.
    assert.deepEqual(read(text, at(2026, 10, 14, 20)).map((e) => e.start), [thursday], name);
    // Thursday evening: the window holds both days.
    assert.deepEqual(read(text, at(2026, 10, 15, 20)).map((e) => e.start), [thursday], name);
    // The week after, the series is back on Friday.
    assert.deepEqual(read(text, at(2026, 10, 22, 20)).map((e) => e.start), [at(2026, 10, 23, 15)], name);
  }
  assert.deepEqual(walkInFull(cases['a RECURRENCE-ID in the series\' time zone'], at(2026, 10, 13, 20), at(2026, 10, 15, 20)), [],
    'build 3.1 lost it');
  assert.ok(friday > thursday);
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

test('a declined invitation by the EMAIL parameter, and working elsewhere, are free (SPEC 6.4 rules 2 and 4)', () => {
  const comp = (lines: string[]) => new ICAL.Component(ICAL.parse(['BEGIN:VEVENT', 'UID:x', 'DTSTART:20261008T100000Z', ...lines,
    'END:VEVENT'].join('\r\n')) as unknown[]);
  const c = (lines: string[]) => classify(comp(lines), null, ['person@example.com']);
  assert.deepEqual(c(['ATTENDEE;EMAIL=Person@Example.com;PARTSTAT=DECLINED:urn:uuid:00000000-0000-0000-0000-000000000001']),
    { showAs: 'free', isCancelled: false });
  assert.deepEqual(c(['ATTENDEE;EMAIL=person@example.com;PARTSTAT=ACCEPTED:urn:uuid:00000000-0000-0000-0000-000000000001']),
    { showAs: 'busy', isCancelled: false });
  assert.deepEqual(c(['ATTENDEE;EMAIL=someone@example.net;PARTSTAT=DECLINED:urn:uuid:00000000-0000-0000-0000-000000000002']),
    { showAs: 'busy', isCancelled: false });
  assert.deepEqual(c(['X-MICROSOFT-CDO-BUSYSTATUS:WORKINGELSEWHERE']), { showAs: 'free', isCancelled: false });
  assert.deepEqual(c(['X-MICROSOFT-CDO-BUSYSTATUS:workingElsewhere']), { showAs: 'free', isCancelled: false });
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
