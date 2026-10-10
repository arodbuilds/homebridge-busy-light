import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EVENTS_FRESH_MS, INPUT_STATUSES, PRESENCE_FRESH_MS, TEAMS, boundariesAfter, freshData, isActive, isCounting, meetingAhead, nextBoundary, resolve,
  resolveStatus,
} from '../src/status.js';
import type { CalEvent, InputReport, Presence, SourceData } from '../src/status.js';

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

// SPEC 15 item 17: precedence with status input reports (6.3, 18.10).

const MAC = 'CallWatch on Alex’s iMac';
const report = (status: InputReport['status'], sender = MAC, app: string | null = 'Microsoft Teams', receivedAt = now - MIN): InputReport =>
  ({ sender, status, app, receivedAt });
const withReports = (presence: Presence | null, events: CalEvent[], reports: InputReport[], override = false) =>
  resolveStatus(override, presence, events, now, opts, reports);

test('reports: each status a sender may send decides at its own rule', () => {
  for (const s of INPUT_STATUSES) {
    assert.equal(withReports(null, [], [report(s)]).status, s, s);
  }
  assert.deepEqual(INPUT_STATUSES, ['outOfOffice', 'doNotDisturb', 'inCall', 'inMeeting', 'busy', 'away', 'available', 'offline'],
    'tentative and unknown are not accepted (SPEC 18.2)');
  const order = [...INPUT_STATUSES];
  for (let i = 0; i < order.length - 1; i++) {
    assert.equal(withReports(null, [], [report(order[i + 1], 'Lower'), report(order[i], 'Higher')]).status, order[i]);
  }
});

test('reports: combined with Teams presence and calendar events in the order of 6.3', () => {
  assert.equal(withReports(pres('DoNotDisturb', 'DoNotDisturb'), [], [report('outOfOffice')]).status, 'outOfOffice', 'rule 2 beats Teams rule 3');
  assert.equal(withReports(pres('Busy', 'InACall'), [], [report('doNotDisturb')]).status, 'doNotDisturb', 'rule 3 beats Teams in a call');
  assert.equal(withReports(null, [ev('busy')], [report('inCall')]).status, 'inCall', 'a live call beats a calendar meeting');
  assert.equal(withReports(pres('Busy', 'Busy'), [], [report('inMeeting')]).status, 'inMeeting', 'rule 5 beats Teams busy');
  assert.equal(withReports(null, [ev('tentative')], [report('busy')]).status, 'busy', 'rule 6 beats a tentative event');
  assert.equal(withReports(null, [ev('tentative')], [report('away')]).status, 'tentative', 'a tentative event beats away');
  assert.equal(withReports(pres('Available', 'Available'), [], [report('away')]).status, 'away', 'rule 8 beats Teams available');
  assert.equal(withReports(null, [ev('busy')], [report('available')]).status, 'inMeeting', 'available cannot hide a meeting (18.10)');
  assert.equal(withReports(pres('Offline', 'Offline'), [], [report('available')]).status, 'available', 'rule 9 beats Teams offline');
  assert.equal(withReports(pres('Busy', 'InACall'), [], [report('available')]).status, 'inCall', 'available cannot lower Teams');
  assert.deepEqual(withReports(null, [], [report('doNotDisturb')], true), { status: 'doNotDisturb', reason: { source: null, until: null } },
    'the override still wins over everything (18.10 item 2)');
});

test('reports: rule 10 with and without an offline report', () => {
  assert.deepEqual(withReports(null, [], []), { status: 'available', reason: { source: null, until: null } });
  assert.deepEqual(withReports(null, [], [report('offline', 'Laptop', null)]), { status: 'offline', reason: { source: 'Laptop', until: null } });
  assert.deepEqual(withReports(pres('Offline'), [], [report('offline')]).reason, { source: TEAMS, until: null }, 'fresh Teams names it first');
  assert.equal(withReports(pres('PresenceUnknown'), [], []).status, 'offline', 'rule 11 unchanged');
});

test('reports: the reason names the sender and the app, with no until', () => {
  const later = [ev('busy', { start: now + 30 * MIN, end: now + 60 * MIN })];
  assert.deepEqual(withReports(null, later, [report('inCall')]),
    { status: 'inCall', reason: { source: MAC, until: null, app: 'Microsoft Teams' } });
  assert.deepEqual(withReports(null, [], [report('busy', 'Test on my laptop', null)]),
    { status: 'busy', reason: { source: 'Test on my laptop', until: null } }, 'no app, no app in the reason');
  assert.equal(withReports(null, [], [report('inCall', 'Older', null, now - 5 * MIN), report('inCall', 'Newer', null, now - MIN)]).reason?.source,
    'Newer', 'the latest of two reports that say the same names the source');
  assert.equal(withReports(pres('Busy', 'InACall'), [], [report('inCall')]).reason?.source, TEAMS, 'Teams presence before a report');
  assert.equal(withReports(null, [ev('oof')], [report('outOfOffice')]).reason?.source, 'Work', 'an event before a report');
  assert.deepEqual(withReports(null, [ev('busy')], [report('away')]).reason, { source: 'Work', until: now + 10 * MIN },
    'an event decides with its until; the report takes over when it ends');
  assert.deepEqual(withReports(null, [ev('busy')], [report('inMeeting')]).reason, { source: 'Work', until: null },
    'with a report holding the same status after the event, nothing changes at its end');
});

test('reports and Unknown (SPEC 6.5): a report counts as fresh data; no calendars and an input on is not unknown', () => {
  const on = (reports: InputReport[]) => ({ on: true, reports });
  assert.deepEqual(resolve([], false, now, opts, on([])), { status: 'available', reason: { source: null, until: null } });
  assert.deepEqual(resolve([], false, now, opts, { on: false, reports: [] }), { status: 'unknown', reason: null });
  assert.deepEqual(resolve([], false, now, opts), { status: 'unknown', reason: null });
  const stale = source({ events: [ev('busy')], eventsCheckedAt: now - 16 * MIN });
  assert.deepEqual(resolve([stale], false, now, opts, on([])), { status: 'unknown', reason: null }, 'calendars configured, none fresh');
  assert.equal(resolve([stale], false, now, opts, on([report('inCall')])).status, 'inCall', 'a report is fresh data');
  assert.equal(resolve([], false, now, opts, on([report('away')])).status, 'away');
});

// Build 3.3 (from the independent review): one sweep over the events gives each boundary's status, so a week of events
// stays fast, with the same `until` and meeting start as deciding over every event at every boundary.

/** Deciding at each boundary over every event, through the public resolve: the reference the sweep must match. */
function reference(presence: Presence | null, events: CalEvent[], at: number, reports: InputReport[] = []): { until: number | null; meeting: number | null } {
  const statusAt = (t: number) => resolveStatus(false, presence, events, t, opts, reports).status;
  const first = statusAt(at);
  const times = boundariesAfter(events, at, opts);
  const change = times.find((t) => statusAt(t) !== first) ?? null;
  return { until: change, meeting: first === 'available' && change !== null && statusAt(change) === 'inMeeting' ? change : null };
}

test('until and the meeting ahead are the same as deciding at every boundary, over generated calendars (build 3.3)', () => {
  let seed = 7;
  const random = () => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    return seed / 2_147_483_648;
  };
  const kinds: CalEvent['showAs'][] = ['busy', 'busy', 'tentative', 'free', 'oof'];
  for (let round = 0; round < 300; round++) {
    const events: CalEvent[] = [];
    for (let i = 0; i < 1 + Math.floor(random() * 12); i++) {
      const start = now + Math.round((random() * 10 - 2) * 60) * MIN;
      events.push(ev(kinds[Math.floor(random() * kinds.length)], {
        start, end: start + Math.round(1 + random() * 120) * MIN, isAllDay: random() < 0.1, isCancelled: random() < 0.1,
      }));
    }
    const presence = random() < 0.3 ? pres(['Available', 'Busy', 'Away', 'Offline'][Math.floor(random() * 4)]) : null;
    const expected = reference(presence, events, now);
    assert.equal(resolveStatus(false, presence, events, now, opts).reason?.until ?? null, expected.until, `round ${round}`);
    assert.equal(meetingAhead(false, presence, events, now, opts), expected.meeting, `round ${round}`);
  }
});

test('a minutely series over the 7 day window resolves in well under half a second (build 3.3)', () => {
  const events: CalEvent[] = [];
  for (let t = now - 86_400_000; t < now + 7 * 86_400_000; t += MIN) {
    events.push(ev('busy', { start: t, end: t + MIN }));
  }
  const started = performance.now();
  const r = resolveStatus(false, pres('DoNotDisturb', 'Presenting'), events, now + 30_000, opts);
  const ahead = meetingAhead(false, null, events, now + 30_000, opts);
  const took = performance.now() - started;
  assert.equal(r.status, 'doNotDisturb');
  assert.equal(r.reason?.until, null, 'Do not disturb holds over every boundary');
  assert.equal(ahead, null, 'in a meeting now, so no warning');
  assert.ok(took < 500, `${events.length} events took ${Math.round(took)} ms`);
});
