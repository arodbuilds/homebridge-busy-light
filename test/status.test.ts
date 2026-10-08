import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EVENTS_FRESH_MS, PRESENCE_FRESH_MS, TEAMS, freshData, isActive, isCounting, nextBoundary, resolve, resolveStatus,
} from '../src/status.js';
import type { CalEvent, Presence, SourceData } from '../src/status.js';

const opts = { ignoreAllDayBusy: true };
const MIN = 60_000;
const now = Date.UTC(2026, 9, 8, 15, 0, 0);

const ev = (showAs: CalEvent['showAs'], extra: Partial<CalEvent> = {}): CalEvent => ({
  showAs, start: now - 10 * MIN, end: now + 10 * MIN, isAllDay: false, isCancelled: false, source: 'Work', ...extra,
});
const pres = (availability: string, activity = availability, outOfOffice = false): Presence => ({ availability, activity, outOfOffice });
const status = (presence: Presence | null, events: CalEvent[], o = opts, override = false) =>
  resolveStatus(override, presence, events, now, o).status;

test('rule 1: the override switch wins over everything', () => {
  assert.equal(status(pres('Available', 'Available', true), [ev('oof')], opts, true), 'doNotDisturb');
  assert.deepEqual(resolveStatus(true, null, [], now, opts), { status: 'doNotDisturb', reason: { source: null, until: null } });
});

test('rule 2: out of office from presence or an active oof event', () => {
  assert.equal(status(pres('Available', 'Available', true), []), 'outOfOffice');
  assert.equal(status(pres('Away', 'OutOfOffice'), []), 'outOfOffice');
  assert.equal(status(null, [ev('oof')]), 'outOfOffice');
  assert.equal(status(pres('DoNotDisturb', 'Presenting'), [ev('oof')]), 'outOfOffice', 'beats do not disturb');
});

test('rule 3: do not disturb from availability or activity', () => {
  assert.equal(status(pres('DoNotDisturb', 'DoNotDisturb'), []), 'doNotDisturb');
  assert.equal(status(pres('Busy', 'Presenting'), [ev('busy')]), 'doNotDisturb');
  assert.equal(status(pres('Busy', 'Focusing'), []), 'doNotDisturb');
  assert.equal(status(pres('Busy', 'DoNotDisturb'), []), 'doNotDisturb');
  assert.equal(status(pres('DoNotDisturb', 'InACall'), []), 'doNotDisturb', 'beats in a call');
});

test('rule 4: in a call', () => {
  assert.equal(status(pres('Busy', 'InACall'), [ev('busy')]), 'inCall');
  assert.equal(status(pres('Busy', 'InAConferenceCall'), []), 'inCall');
});

test('rule 5: in a meeting from presence or an active busy event', () => {
  assert.equal(status(pres('Busy', 'InAMeeting'), []), 'inMeeting');
  assert.equal(status(null, [ev('busy')]), 'inMeeting');
  assert.equal(status(pres('Available', 'Available'), [ev('busy')]), 'inMeeting', 'calendar beats available presence');
  assert.equal(status(pres('Busy', 'Busy'), [ev('busy')]), 'inMeeting', 'beats busy');
});

test('rule 6: busy from availability', () => {
  assert.equal(status(pres('Busy', 'Busy'), [ev('tentative')]), 'busy', 'beats tentative');
  assert.equal(status(pres('BusyIdle', 'BusyIdle'), []), 'busy');
});

test('rule 7: tentative from an active tentative event', () => {
  assert.equal(status(null, [ev('tentative')]), 'tentative');
  assert.equal(status(pres('Away', 'Away'), [ev('tentative')]), 'tentative', 'beats away');
});

test('rule 8: away', () => {
  assert.equal(status(pres('Away', 'Away'), []), 'away');
  assert.equal(status(pres('BeRightBack', 'BeRightBack'), []), 'away');
});

test('rule 9: available from presence', () => {
  assert.equal(status(pres('Available', 'Available'), [ev('free')]), 'available');
  assert.equal(status(pres('AvailableIdle', 'AvailableIdle'), []), 'available');
});

test('rule 10: with no presence, nothing on the calendars is available', () => {
  assert.equal(status(null, []), 'available');
  assert.equal(status(null, [ev('free')]), 'available');
});

test('rule 11: anything else from presence is offline', () => {
  assert.equal(status(pres('Offline', 'OffWork'), []), 'offline');
  assert.equal(status(pres('PresenceUnknown', 'PresenceUnknown'), []), 'offline');
  assert.equal(status(pres('SomethingNew', 'SomethingNew'), []), 'offline');
  assert.equal(status(pres('Offline', 'Offline'), [ev('busy')]), 'inMeeting', 'a meeting still counts while offline in Teams');
});

test('the all-day rule', () => {
  assert.equal(status(null, [ev('busy', { isAllDay: true })]), 'available');
  assert.equal(status(null, [ev('tentative', { isAllDay: true })]), 'available');
  assert.equal(status(null, [ev('busy', { isAllDay: true })], { ignoreAllDayBusy: false }), 'inMeeting');
  assert.equal(status(null, [ev('tentative', { isAllDay: true })], { ignoreAllDayBusy: false }), 'tentative');
  assert.equal(status(null, [ev('oof', { isAllDay: true })]), 'outOfOffice', 'all-day out of office always counts');
  assert.equal(isCounting(ev('oof', { isAllDay: true }), opts), true);
  assert.equal(isCounting(ev('busy', { isAllDay: true }), opts), false);
});

test('cancelled events never count', () => {
  assert.equal(status(null, [ev('busy', { isCancelled: true })]), 'available');
  assert.equal(status(null, [ev('oof', { isCancelled: true, isAllDay: true })]), 'available');
  assert.equal(isActive(ev('busy', { isCancelled: true }), now), false);
});

test('boundaries: start is inclusive, end is exclusive', () => {
  assert.equal(status(null, [ev('busy', { start: now, end: now + MIN })]), 'inMeeting');
  assert.equal(status(null, [ev('busy', { start: now - MIN, end: now })]), 'available');
  assert.equal(status(null, [ev('busy', { start: now + 1, end: now + MIN })]), 'available');
  assert.equal(status(null, [ev('busy', { start: now - MIN, end: now + 1 })]), 'inMeeting');
});

test('reason: the deciding source, or Teams, and until the deciding event ends', () => {
  const meeting = ev('busy', { source: 'Family', end: now + 30 * MIN });
  assert.deepEqual(resolveStatus(false, pres('Available'), [meeting], now, opts),
    { status: 'inMeeting', reason: { source: 'Family', until: now + 30 * MIN } });
  assert.deepEqual(resolveStatus(false, pres('DoNotDisturb', 'Presenting'), [], now, opts),
    { status: 'doNotDisturb', reason: { source: TEAMS, until: null } });
  assert.deepEqual(resolveStatus(false, null, [], now, opts),
    { status: 'available', reason: { source: null, until: null } });
});

test('until: the start of the next counting event when free', () => {
  const later = ev('busy', { start: now + 60 * MIN, end: now + 90 * MIN });
  const lunch = ev('free', { start: now + 20 * MIN, end: now + 50 * MIN });
  const cancelled = ev('busy', { start: now + 5 * MIN, end: now + 15 * MIN, isCancelled: true });
  assert.deepEqual(resolveStatus(false, null, [lunch, later, cancelled], now, opts),
    { status: 'available', reason: { source: null, until: now + 60 * MIN } });
  assert.deepEqual(resolveStatus(false, pres('Available'), [later], now, opts),
    { status: 'available', reason: { source: TEAMS, until: now + 60 * MIN } });
});

test('until: back-to-back and overlapping meetings hold the status until the last one ends', () => {
  const a = ev('busy', { source: 'Work', end: now + 30 * MIN });
  const b = ev('busy', { source: 'Family', start: now + 30 * MIN, end: now + 60 * MIN });
  const c = ev('busy', { source: 'Rota', start: now + 45 * MIN, end: now + 75 * MIN });
  assert.deepEqual(resolveStatus(false, null, [a, b, c], now, opts),
    { status: 'inMeeting', reason: { source: 'Work', until: now + 75 * MIN } });
});

test('until: a higher status starting during a meeting ends it early', () => {
  const meeting = ev('busy', { end: now + 60 * MIN });
  const leave = ev('oof', { source: 'Family', start: now + 20 * MIN, end: now + 600 * MIN });
  assert.deepEqual(resolveStatus(false, null, [meeting, leave], now, opts),
    { status: 'inMeeting', reason: { source: 'Work', until: now + 20 * MIN } });
});

test('until: the longest of several deciding events names the source', () => {
  const short = ev('oof', { source: 'Work', end: now + 10 * MIN });
  const long = ev('oof', { source: 'Family', end: now + 300 * MIN, isAllDay: true });
  assert.deepEqual(resolveStatus(false, null, [short, long], now, opts),
    { status: 'outOfOffice', reason: { source: 'Family', until: now + 300 * MIN } });
});

test('until: none when presence holds the status whatever the calendar does', () => {
  const meeting = ev('busy', { end: now + 30 * MIN });
  assert.deepEqual(resolveStatus(false, pres('Busy', 'InAMeeting'), [meeting], now, opts),
    { status: 'inMeeting', reason: { source: 'Work', until: null } });
});

test('nextBoundary: the next start or end of a counting event', () => {
  const events = [
    ev('busy', { start: now - MIN, end: now + 30 * MIN }),
    ev('free', { start: now + 5 * MIN, end: now + 6 * MIN }),
    ev('tentative', { start: now + 20 * MIN, end: now + 40 * MIN }),
    ev('busy', { start: now + 2 * MIN, end: now + 3 * MIN, isCancelled: true }),
    ev('busy', { start: now + MIN, end: now + 2 * MIN, isAllDay: true }),
  ];
  assert.equal(nextBoundary(events, now, opts), now + 20 * MIN);
  assert.equal(nextBoundary(events, now, { ignoreAllDayBusy: false }), now + MIN);
  assert.equal(nextBoundary([], now, opts), null);
});

const source = (over: Partial<SourceData>): SourceData => ({
  events: null, eventsCheckedAt: null, presence: null, presenceCheckedAt: null, ...over,
});

test('freshness: events for 15 minutes, presence for 5', () => {
  const meeting = [ev('busy')];
  assert.equal(resolve([source({ events: meeting, eventsCheckedAt: now - EVENTS_FRESH_MS + 1 })], false, now, opts).status, 'inMeeting');
  assert.equal(resolve([source({ events: meeting, eventsCheckedAt: now - EVENTS_FRESH_MS })], false, now, opts).status, 'unknown');
  const busy = pres('Busy', 'Busy');
  assert.equal(resolve([source({ presence: busy, presenceCheckedAt: now - PRESENCE_FRESH_MS + 1 })], false, now, opts).status, 'busy');
  assert.equal(resolve([source({ presence: busy, presenceCheckedAt: now - PRESENCE_FRESH_MS })], false, now, opts).status, 'unknown');
});

test('freshness: a failing source contributes nothing while others are fresh', () => {
  const stale = source({ events: [ev('busy')], eventsCheckedAt: now - 20 * MIN });
  const fresh = source({ events: [], eventsCheckedAt: now - MIN });
  assert.deepEqual(resolve([stale, fresh], false, now, opts), { status: 'available', reason: { source: null, until: null } });
  const staleTeams = source({ presence: pres('Offline'), presenceCheckedAt: now - 6 * MIN });
  assert.equal(resolve([staleTeams, fresh], false, now, opts).status, 'available', 'stale presence counts as no presence');
  const data = freshData([stale, fresh, staleTeams], now);
  assert.deepEqual(data, { events: [], presence: null, anyFresh: true });
});

test('Unknown: sources configured but none fresh, or no sources at all', () => {
  assert.deepEqual(resolve([source({}), source({ events: [ev('busy')], eventsCheckedAt: now - 16 * MIN })], false, now, opts),
    { status: 'unknown', reason: null });
  assert.deepEqual(resolve([], false, now, opts), { status: 'unknown', reason: null });
});

test('the override wins even when no source has fresh data', () => {
  assert.deepEqual(resolve([source({})], true, now, opts), { status: 'doNotDisturb', reason: { source: null, until: null } });
  assert.equal(resolve([], true, now, opts).status, 'doNotDisturb');
});
