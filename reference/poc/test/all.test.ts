import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { resolveStatus, type CalEvent } from '../src/status';
import { icsToEvents } from '../src/ics';
import { parseEvent } from '../src/graph';
import { xmlBlocks, xmlText } from '../src/caldav';
import { buildSetColor, buildSetPower, hexToHsb } from '../src/lifx';

const opts = { ignoreAllDayBusy: true };
const now = Date.UTC(2026, 9, 8, 15, 0, 0); // October 8, 2026, 15:00 UTC (a Thursday)
const ev = (showAs: string, extra: Partial<CalEvent> = {}): CalEvent => ({
  showAs, start: now - 600000, end: now + 600000, isAllDay: false, isCancelled: false, ...extra,
});

test('status precedence', () => {
  assert.equal(resolveStatus(null, [], now, opts), 'available');
  assert.equal(resolveStatus(null, [ev('busy')], now, opts), 'inMeeting');
  assert.equal(resolveStatus(null, [ev('busy'), ev('oof')], now, opts), 'outOfOffice');
  assert.equal(resolveStatus(null, [ev('tentative')], now, opts), 'tentative');
  assert.equal(resolveStatus(null, [ev('free')], now, opts), 'available');
  assert.equal(resolveStatus(null, [ev('busy', { isCancelled: true })], now, opts), 'available');
  assert.equal(resolveStatus(null, [ev('busy', { start: now + 1, end: now + 9 })], now, opts), 'available');
  assert.equal(resolveStatus(null, [ev('busy', { isAllDay: true })], now, opts), 'available');
  assert.equal(resolveStatus(null, [ev('busy', { isAllDay: true })], now, { ignoreAllDayBusy: false }), 'inMeeting');
  assert.equal(resolveStatus(null, [ev('oof', { isAllDay: true })], now, opts), 'outOfOffice');
  assert.equal(resolveStatus({ availability: 'Offline' }, [], now, opts), 'offline');
  assert.equal(resolveStatus({ availability: 'Available', activity: 'Available' }, [ev('busy')], now, opts), 'inMeeting');
  assert.equal(resolveStatus({ availability: 'Busy', activity: 'InACall' }, [ev('busy')], now, opts), 'inCall');
  assert.equal(resolveStatus({ availability: 'DoNotDisturb', activity: 'Presenting' }, [], now, opts), 'doNotDisturb');
  assert.equal(resolveStatus({ availability: 'Busy', activity: 'Busy' }, [], now, opts), 'busy');
  assert.equal(resolveStatus({ availability: 'Away', activity: 'Away' }, [], now, opts), 'away');
  assert.equal(resolveStatus({ availability: 'Available', outOfOffice: true }, [], now, opts), 'outOfOffice');
});

test('graph event parsing', () => {
  const e = parseEvent({
    showAs: 'busy', isAllDay: false,
    start: { dateTime: '2026-10-08T14:30:00.0000000' }, end: { dateTime: '2026-10-08T15:30:00.0000000' },
  });
  assert.equal(e.start, Date.UTC(2026, 9, 8, 14, 30));
  const allDay = parseEvent({
    showAs: 'oof', isAllDay: true,
    start: { dateTime: '2026-10-08T00:00:00.0000000' }, end: { dateTime: '2026-10-09T00:00:00.0000000' },
  });
  assert.equal(allDay.start, new Date(2026, 9, 8).getTime());
});

const ICS = [
  'BEGIN:VCALENDAR', 'VERSION:2.0',
  'BEGIN:VTIMEZONE', 'TZID:America/New_York',
  'BEGIN:DAYLIGHT', 'TZOFFSETFROM:-0500', 'TZOFFSETTO:-0400', 'TZNAME:EDT',
  'DTSTART:19700308T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU', 'END:DAYLIGHT',
  'BEGIN:STANDARD', 'TZOFFSETFROM:-0400', 'TZOFFSETTO:-0500', 'TZNAME:EST',
  'DTSTART:19701101T020000', 'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU', 'END:STANDARD',
  'END:VTIMEZONE',
  // Weekly Thursday 11:00 Eastern (15:00 UTC in October), started in January
  'BEGIN:VEVENT', 'UID:weekly', 'SUMMARY:Team sync',
  'DTSTART;TZID=America/New_York:20260108T110000', 'DTEND;TZID=America/New_York:20260108T113000',
  'RRULE:FREQ=WEEKLY;BYDAY=TH', 'END:VEVENT',
  // Weekly Thursday 11:00, but this week's occurrence was moved to 13:00
  'BEGIN:VEVENT', 'UID:moved', 'SUMMARY:One on one',
  'DTSTART;TZID=America/New_York:20260108T110000', 'DTEND;TZID=America/New_York:20260108T120000',
  'RRULE:FREQ=WEEKLY;BYDAY=TH', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:moved', 'SUMMARY:One on one',
  'RECURRENCE-ID;TZID=America/New_York:20261008T110000',
  'DTSTART;TZID=America/New_York:20261008T130000', 'DTEND;TZID=America/New_York:20261008T140000',
  'END:VEVENT',
  'BEGIN:VEVENT', 'UID:free', 'SUMMARY:Lunch', 'TRANSP:TRANSPARENT',
  'DTSTART:20261008T160000Z', 'DTEND:20261008T170000Z', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:vac', 'SUMMARY:Family vacation', 'TRANSP:TRANSPARENT',
  'DTSTART;VALUE=DATE:20261008', 'DTEND;VALUE=DATE:20261010', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:declined', 'SUMMARY:Vendor demo',
  'ATTENDEE;PARTSTAT=DECLINED:mailto:Me@Example.com',
  'DTSTART:20261008T180000Z', 'DTEND:20261008T190000Z', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:old', 'SUMMARY:Long ago', 'DTSTART:20200101T100000Z', 'DTEND:20200101T110000Z', 'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

test('ics expansion and classification', () => {
  const day = 86400000;
  const events = icsToEvents(ICS, now - day, now + day, {
    oofKeywords: ['Vacation', 'OOO'], selfEmails: ['me@example.com'],
  });
  const at = (h: number, m = 0) => Date.UTC(2026, 9, 8, h, m);
  const find = (start: number) => events.filter((e) => e.start === start);

  const sync = find(at(15));
  assert.equal(sync.length, 1, 'weekly occurrence today at 15:00 UTC, and the moved series is not there');
  assert.equal(sync[0].showAs, 'busy');
  assert.equal(sync[0].end, at(15, 30));
  assert.equal(find(at(17)).length, 1, 'moved occurrence at 13:00 Eastern');
  assert.equal(find(at(16))[0].showAs, 'free');
  assert.equal(find(at(18))[0].showAs, 'free', 'declined invitation is free');
  const vac = events.find((e) => e.isAllDay)!;
  assert.equal(vac.showAs, 'oof');
  assert.equal(vac.start, new Date(2026, 9, 8).getTime());
  assert.equal(events.length, 5);
  assert.equal(resolveStatus(null, events.filter((e) => !e.isAllDay), now, opts), 'inMeeting');
});

test('xml helpers', () => {
  const xml = '<multistatus xmlns="DAV:"><response><href>/1/cal/</href><propstat><prop>' +
    '<cal:calendar-data xmlns:cal="urn:x">A &amp; B&#13;</cal:calendar-data></prop></propstat></response></multistatus>';
  assert.deepEqual(xmlBlocks(xmlBlocks(xml, 'response')[0], 'href'), ['/1/cal/']);
  assert.equal(xmlText(xmlBlocks(xml, 'calendar-data')[0]), 'A & B\r');
  assert.equal(xmlText('<![CDATA[x<y]]>'), 'x<y');
});

test('lifx packets', () => {
  assert.deepEqual(hexToHsb('#FF0000'), { h: 0, s: 1, b: 1 });
  assert.ok(Math.abs(hexToHsb('00FF00')!.h - 1 / 3) < 1e-9);
  assert.equal(hexToHsb('off'), null);
  const c = buildSetColor(0.5, 1, 0.5, 3500, 1000);
  assert.equal(c.length, 49);
  assert.equal(c.readUInt16LE(0), 49);
  assert.equal(c.readUInt16LE(2), 0x3400);
  assert.equal(c.readUInt16LE(32), 102);
  assert.equal(c.readUInt16LE(37), 32768);
  assert.equal(c.readUInt16LE(39), 65535);
  assert.equal(c.readUInt16LE(43), 3500);
  assert.equal(c.readUInt32LE(45), 1000);
  const p = buildSetPower(true, 0);
  assert.equal(p.length, 42);
  assert.equal(p.readUInt16LE(32), 117);
  assert.equal(p.readUInt16LE(36), 65535);
});
