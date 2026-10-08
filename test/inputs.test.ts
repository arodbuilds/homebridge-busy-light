/**
 * The sender store of SPEC 18.7: replace, clear, expiry, the 20-sender limit, the 12-hour display list, the replay
 * table kept apart from it with its startup floor, and inputs.json written atomically with mode 600 and reloaded.
 */
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { HOME_APP_SENDER, LIST_MS, MAX_ACTIVE_SENDERS, REPLAY_WINDOW_MS, SenderStore, inputsFile } from '../src/inputs.js';
import type { NewReport } from '../src/inputs.js';
import { tmpDir } from './helpers.js';

const T0 = Date.UTC(2026, 9, 8, 15, 0, 0);
const MIN = 60_000;
const MAC = 'CallWatch on Alex’s iMac';

let dir: string;
let file: string;

beforeEach(() => {
  dir = tmpDir('busy-light-inputs');
  file = inputsFile(dir);
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const api = (sender: string, status: NewReport['status'] = 'inCall', extra: Partial<NewReport> = {}): NewReport =>
  ({ sender, status, app: null, via: 'api', auth: 'signed', ttlMs: 180_000, ...extra });

function loaded(now = T0): SenderStore {
  const store = new SenderStore(file);
  store.load(now);
  return store;
}

test('the latest report from a sender replaces its earlier one; changed is true only for a new status or app', () => {
  const store = loaded();
  const first = store.report(api(MAC, 'inCall', { app: 'Microsoft Teams' }), T0);
  assert.ok(first.ok && first.changed);
  const again = store.report(api(MAC, 'inCall', { app: 'Microsoft Teams' }), T0 + MIN);
  assert.ok(again.ok && !again.changed, 'a repeat is not a change');
  assert.ok(again.ok && again.entry.expiresAt === T0 + MIN + 180_000, 'a repeat extends the report');
  const app = store.report(api(MAC, 'inCall', { app: 'Zoom' }), T0 + 2 * MIN);
  assert.ok(app.ok && app.changed);
  const status = store.report(api(MAC, 'busy', { app: 'Zoom' }), T0 + 3 * MIN);
  assert.ok(status.ok && status.changed);
  assert.deepEqual(store.active(T0 + 3 * MIN), [{ sender: MAC, status: 'busy', app: 'Zoom', receivedAt: T0 + 3 * MIN }]);
  assert.equal(store.list(T0 + 3 * MIN).length, 1);
});

test('clear withdraws a report, is idempotent, and does not list a sender that only ever cleared', () => {
  const store = loaded();
  store.report(api('A'), T0);
  assert.equal(store.clear('A', 'signed', T0 + MIN), true);
  assert.deepEqual(store.active(T0 + MIN), []);
  assert.deepEqual(store.list(T0 + MIN).map((e) => [e.sender, e.status, e.active, e.expiresAt]), [['A', 'inCall', false, T0 + MIN]]);
  assert.equal(store.clear('A', 'signed', T0 + 2 * MIN), false, 'clearing again is fine');
  assert.equal(store.clear('Nobody', 'signed', T0), false);
  assert.deepEqual(store.list(T0 + 2 * MIN).map((e) => e.sender), ['A']);
});

test('reports expire ttl after they arrive; sweep returns them once; nextExpiry is the earliest', () => {
  const store = loaded();
  store.report(api('A', 'inCall', { ttlMs: 60_000 }), T0);
  store.report(api('B', 'busy', { ttlMs: 30_000 }), T0);
  assert.equal(store.nextExpiry(), T0 + 30_000);
  assert.deepEqual(store.sweep(T0 + 29_999), []);
  assert.deepEqual(store.sweep(T0 + 30_000), ['B']);
  assert.deepEqual(store.sweep(T0 + 30_000), [], 'once');
  assert.equal(store.nextExpiry(), T0 + 60_000);
  assert.deepEqual(store.active(T0 + 30_000).map((r) => r.sender), ['A']);
  assert.deepEqual(store.active(T0 + 60_000), [], 'not active at its expiry even before a sweep');
  assert.deepEqual(store.list(T0 + 60_000).map((e) => [e.sender, e.active]), [['A', false], ['B', false]]);
});

test('a report or clear that finds another sender expired keeps it for the next sweep, so its line is still written', () => {
  const store = loaded();
  store.report(api('A', 'inCall', { ttlMs: 30_000 }), T0);
  store.report(api('B', 'busy', { ttlMs: 30_000 }), T0);
  store.report(api('C', 'busy'), T0 + 31_000);
  assert.deepEqual(store.sweep(T0 + 31_000), ['A', 'B'], 'found by the report, returned by the sweep');
  assert.deepEqual(store.sweep(T0 + 31_000), [], 'once');
  store.report(api('D', 'away', { ttlMs: 30_000 }), T0 + 40_000);
  assert.equal(store.clear('D', 'signed', T0 + 71_000), false, 'it had expired before the clear arrived');
  assert.deepEqual(store.sweep(T0 + 71_000), ['D'], 'so the expired line is written, not the cleared one');
});

test('at most 20 unexpired senders through the API; an active sender can repeat, the switch is never refused', () => {
  const store = loaded();
  for (let i = 0; i < MAX_ACTIVE_SENDERS; i++) {
    assert.ok(store.report(api(`Sender ${i}`), T0).ok);
  }
  assert.deepEqual(store.report(api('Sender 20'), T0), { ok: false, error: 'tooManySenders' });
  assert.ok(store.report(api('Sender 3', 'busy'), T0).ok, 'an active sender may still report');
  assert.ok(store.report({ sender: HOME_APP_SENDER, status: 'inCall', app: null, via: 'switch', auth: null, ttlMs: null }, T0).ok);
  store.clear('Sender 0', 'signed', T0);
  store.clear('Sender 1', 'signed', T0);
  assert.ok(store.report(api('Sender 20'), T0).ok, 'room again once one clears');
});

test('the display list: the past 12 hours, at most 20, most recent first, never dropping an active sender', () => {
  const store = loaded();
  for (let i = 0; i < 25; i++) {
    store.report(api(`Old ${i}`, 'away', { ttlMs: 500 }), T0 + i * 1000);
  }
  const now = T0 + MIN;
  store.report(api('Now'), now);
  const list = store.list(now);
  assert.equal(list.length, 20);
  assert.equal(list[0].sender, 'Now');
  assert.equal(list[1].sender, 'Old 24');
  assert.ok(!list.some((e) => e.sender === 'Old 0'), 'the oldest are forgotten');
  assert.deepEqual(store.list(now + LIST_MS + 1000).map((e) => e.sender), [], 'nothing heard from in 12 hours');
});

test('inputs.json: mode 600, written atomically, reloaded; expired reports and the switch come back inactive', () => {
  const store = loaded();
  store.report(api('Long', 'doNotDisturb', { ttlMs: 2 * 3_600_000 }), T0);
  store.report(api('Short', 'inCall', { ttlMs: 60_000, auth: 'plain' }), T0);
  store.report({ sender: HOME_APP_SENDER, status: 'inCall', app: null, via: 'switch', auth: null, ttlMs: null }, T0);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(fs.readdirSync(dir), ['inputs.json'], 'no temporary file left behind');
  const after = loaded(T0 + 10 * MIN);
  assert.deepEqual(after.active(T0 + 10 * MIN).map((r) => r.sender), ['Long'], 'a two-hour report survives a restart');
  assert.deepEqual(after.sweep(T0 + 10 * MIN), [], 'an expired report is dropped on load, not reported as expired');
  assert.deepEqual(after.list(T0 + 10 * MIN).map((e) => [e.sender, e.active, e.auth]),
    [['Long', true, 'signed'], ['Short', false, 'plain'], [HOME_APP_SENDER, false, null]]);
  fs.writeFileSync(file, '{ not json');
  assert.deepEqual(loaded(T0).list(T0), [], 'an unreadable file starts empty');
});

test('the replay table: kept through clear, expiry and the display list, for 300 seconds after each ts, across a reload', () => {
  const store = loaded();
  fs.writeFileSync(file, JSON.stringify({ version: 1, senders: [], replay: [] }));
  store.load(T0);
  assert.equal(store.replayFloor(MAC, T0), null);
  store.report(api(MAC, 'inCall', { ttlMs: 30_000 }), T0);
  store.recordTs(MAC, T0 - 1000, T0);
  assert.equal(store.replayFloor(MAC, T0), T0 - 1000);
  store.clear(MAC, 'signed', T0 + 1000);
  assert.equal(store.replayFloor(MAC, T0 + 1000), T0 - 1000, 'clear changes nothing');
  store.sweep(T0 + 40_000);
  for (let i = 0; i < 25; i++) {
    store.report(api(`Other ${i}`, 'away'), T0 + 41_000);
  }
  assert.ok(!store.list(T0 + 41_000).some((e) => e.sender === MAC), 'gone from the display list');
  assert.equal(store.replayFloor(MAC, T0 + 41_000), T0 - 1000, 'but not from the replay table');
  assert.equal(loaded(T0 + 60_000).replayFloor(MAC, T0 + 60_000), T0 - 1000, 'it survives a reload');
  assert.equal(store.replayFloor(MAC, T0 - 1000 + REPLAY_WINDOW_MS), T0 - 1000, 'kept for 300 seconds');
  assert.equal(store.replayFloor(MAC, T0 - 1000 + REPLAY_WINDOW_MS + 1), null, 'dropped once more than 300 seconds old');
  assert.deepEqual(store.replaySenders(), []);
  store.recordTs(MAC, T0, T0);
  assert.deepEqual(loaded(T0 + REPLAY_WINDOW_MS + 1).replaySenders(), [], 'old entries are dropped on load');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { replay: unknown[] };
  assert.deepEqual(raw.replay, [{ sender: MAC, ts: T0 }], 'written with every change');
});

test('the startup floor: with inputs.json missing or unreadable, for 300 seconds after startup', () => {
  assert.equal(fs.existsSync(file), false);
  const store = loaded(T0);
  assert.equal(store.replayFloor(MAC, T0 + MIN), T0, 'the moment the input started');
  assert.equal(store.replayFloor(MAC, T0 + REPLAY_WINDOW_MS), T0);
  assert.equal(store.replayFloor(MAC, T0 + REPLAY_WINDOW_MS + 1), null, 'gone after 300 seconds');
  store.recordTs(MAC, T0 + 2000, T0 + 2000);
  assert.equal(store.replayFloor(MAC, T0 + 3000), T0 + 2000, 'the later of the entry and the floor');
  fs.writeFileSync(file, 'garbage');
  assert.equal(loaded(T0 + 10 * MIN).replayFloor('Anyone', T0 + 10 * MIN), T0 + 10 * MIN);
  fs.writeFileSync(file, JSON.stringify({ version: 1, senders: [] }));
  assert.equal(loaded(T0).replayFloor('Anyone', T0), null, 'a readable file has no floor');
});

test('nothing in inputs.json but names, statuses, apps, times and ts', () => {
  const store = loaded();
  store.report(api(MAC, 'inCall', { app: 'Microsoft Teams' }), T0);
  store.recordTs(MAC, T0, T0);
  const raw = JSON.parse(fs.readFileSync(path.join(dir, 'inputs.json'), 'utf8')) as { senders: Record<string, unknown>[] };
  assert.deepEqual(Object.keys(raw), ['version', 'senders', 'replay']);
  assert.deepEqual(Object.keys(raw.senders[0]), ['sender', 'status', 'app', 'via', 'auth', 'lastHeard', 'expiresAt', 'active']);
});

test('a signed report or clear records its ts in the same step that accepts it; a refused report records nothing', () => {
  fs.writeFileSync(file, JSON.stringify({ version: 1, senders: [], replay: [] }));
  const store = loaded();
  store.report(api(MAC, 'inCall', { ts: T0 - 5 }), T0);
  assert.equal(store.replayFloor(MAC, T0), T0 - 5);
  assert.equal(store.clear('Never reported', 'signed', T0, T0 - 3), false);
  assert.equal(store.replayFloor('Never reported', T0), T0 - 3, 'a signed clear from an unknown sender still counts');
  assert.ok(!store.list(T0).some((e) => e.sender === 'Never reported'), 'but is not listed');
  for (let i = 0; i < MAX_ACTIVE_SENDERS - 1; i++) {
    store.report(api(`S${i}`), T0);
  }
  assert.deepEqual(store.report(api('Refused', 'inCall', { ts: T0 - 1 }), T0), { ok: false, error: 'tooManySenders' });
  assert.equal(store.replayFloor('Refused', T0), null);
});
