/**
 * The settings page's model, validation and helpers without a DOM: the block read and written back (a build 1 block
 * unchanged, the SPEC section 9 example as the plugin reads it), the defaults against the plugin's, the draft without
 * secrets, the footer mark against its asset, and the times.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import {
  defaultConfig, MAX_CALENDAR_SECONDS, MAX_CALL_HOURS, MAX_INPUT_PORT, MAX_POLL_SECONDS, MAX_REFRESH_SECONDS, MIN_CALENDAR_SECONDS, MIN_CALL_HOURS,
  MIN_INPUT_PORT, MIN_POLL_SECONDS, parseConfig,
} from '../src/config.js';
import { relativeTime } from '../homebridge-ui/src/format.js';
import { MARK_ROOT, MARK_SHAPES } from '../homebridge-ui/src/mark.js';
import {
  DEFAULTS, INTERVALS, LIMITS, emptyConfig, exportConfig, newId, readConfig, restoreSecrets, splitWords, withoutSecrets,
} from '../homebridge-ui/src/model.js';
import { isCalendarAddress, isHost, validate } from '../homebridge-ui/src/validate.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const spec = fs.readFileSync(path.join(root, 'SPEC.md'), 'utf8');

const PI = {
  platform: 'BusyLight', name: 'Busy Light',
  calendars: [{ type: 'icloud', name: 'iCloud', appleId: 'person@example.com', appPassword: 'abcd-efgh-ijkl-mnop', calendars: ['Alex'],
    useTeamsStatus: true, useCalendar: true }],
  lifx: { enabled: true, bulb: '', host: '', brightness: 100, refreshSeconds: 300 },
  sensors: ['available', 'busyAny', 'outOfOffice'],
  _bridge: { username: '0E:11:22:33:44:55', port: 51234 },
};

describe('settings page model (SPEC section 9)', () => {
  it('reads the defaults for a missing block, equal to the plugin\'s', () => {
    const page = exportConfig(emptyConfig());
    const plugin = defaultConfig();
    assert.deepEqual(page, {
      platform: 'BusyLight', name: plugin.name, calendars: [], colors: plugin.colors, lifx: plugin.lifx, sensors: plugin.sensors,
      overrideSwitch: plugin.overrideSwitch, pollSeconds: plugin.pollSeconds, calendarSeconds: plugin.calendarSeconds,
      ignoreAllDayBusy: plugin.ignoreAllDayBusy, outOfOfficeWords: plugin.outOfOfficeWords, debug: plugin.debug,
      statusInput: plugin.statusInput, callSwitch: plugin.callSwitch, meetingWarningSeconds: plugin.meetingWarningSeconds,
      workingSwitch: plugin.workingSwitch,
    });
    assert.deepEqual(readConfig(undefined), emptyConfig());
    assert.deepEqual(LIMITS, {
      brightness: [1, 100], refreshSeconds: [0, MAX_REFRESH_SECONDS], port: [MIN_INPUT_PORT, MAX_INPUT_PORT], hours: [MIN_CALL_HOURS, MAX_CALL_HOURS],
    });
    // Every duration the interval selects offer is one the plugin accepts (SPEC 11.3 C and F, 9.1 items 12 and 19).
    assert.ok(INTERVALS.pollSeconds.every((v) => v >= MIN_POLL_SECONDS && v <= MAX_POLL_SECONDS));
    assert.ok([...INTERVALS.calendarSeconds, ...INTERVALS.sourceCalendarSeconds].every((v) => v >= MIN_CALENDAR_SECONDS && v <= MAX_CALENDAR_SECONDS));
    assert.ok((INTERVALS.pollSeconds as readonly number[]).includes(plugin.pollSeconds), 'the default is in the list');
    assert.ok((INTERVALS.calendarSeconds as readonly number[]).includes(plugin.calendarSeconds));
    assert.deepEqual(DEFAULTS.colors, plugin.colors);
  });

  it('writes the Pi\'s build 1 block back so the plugin reads it exactly as before', () => {
    const block = exportConfig(readConfig(PI));
    assert.deepEqual(block._bridge, PI._bridge, 'unknown keys are kept');
    const before = parseConfig(PI);
    const after = parseConfig(block);
    assert.deepEqual(before.issues, []);
    assert.deepEqual(after.issues, []);
    assert.deepEqual(after.config, before.config);
    assert.deepEqual((block.calendars as unknown[])[0], {
      type: 'icloud', id: 'icloud', name: 'iCloud', appleId: 'person@example.com', appPassword: 'abcd-efgh-ijkl-mnop', calendars: ['Alex'],
    }, 'the derived id is written explicitly; the name-only list stays as it was');
  });

  it('reads the SPEC section 9 example and writes it back as the plugin reads it', () => {
    const example = JSON.parse(/## 9\. Configuration[\s\S]*?```json\n([\s\S]*?)```/.exec(spec)![1]) as Record<string, unknown>;
    const block = exportConfig(readConfig(example));
    assert.deepEqual(parseConfig(block).config, parseConfig(example).config);
    assert.deepEqual(block.calendars, example.calendars, 'the build 2 shape round-trips unchanged');
  });

  it('keeps an entry it cannot edit, and a value the user has to fix, as stored', () => {
    const c = readConfig({ platform: 'BusyLight', calendars: [{ type: 'exchange', name: 'Old' }], pollSeconds: 5, colors: { busy: 'orange' } });
    assert.deepEqual(c.otherCalendars, [{ type: 'exchange', name: 'Old' }]);
    assert.equal(c.pollSeconds, 5);
    assert.equal(c.colors.busy, 'orange');
    // From build 3.1 the intervals are selects with no range message; a stored value outside the list is shown and kept.
    assert.deepEqual(validate(c).map((i) => [i.path, i.message]), [['colors.busy', 'Enter a color as #RRGGBB, for example #FF0000.']]);
    assert.equal(exportConfig(c).pollSeconds, 5);
    assert.deepEqual((exportConfig(c).calendars as unknown[]).at(-1), { type: 'exchange', name: 'Old' });
  });

  it('gives a source without an id the one the plugin derives, and a new card a cal- id', () => {
    const c = readConfig({ calendars: [{ type: 'url', name: 'Team rota', url: 'https://a.example/x.ics' }, { type: 'url', id: 'kept', name: 'B', url: '' }] });
    assert.deepEqual(c.calendars.map((s) => s.id), ['team-rota', 'kept']);
    assert.match(newId(Date.UTC(2026, 9, 8)), /^cal-[0-9a-z]+[0-9a-z]{4}$/);
    assert.notEqual(newId(), newId());
  });

  it('the out of office words are one field, separated by commas', () => {
    assert.deepEqual(splitWords(' Out of office, OOO,, PTO '), ['Out of office', 'OOO', 'PTO']);
    assert.equal(readConfig({ outOfOfficeWords: ['A', ' B ', 3] }).outOfOfficeWords, 'A, B');
  });
});

describe('the draft holds no secret (SPEC 11.2 addition 4)', () => {
  it('empties the app-specific password and every calendar address, and puts them back from the saved block', () => {
    const raw = { platform: 'BusyLight', calendars: [
      PI.calendars[0],
      { type: 'google', id: 'g', name: 'G', url: 'https://calendar.example.com/private-synthetic/basic.ics', email: 'person@example.com' },
      { type: 'url', id: 'u', name: 'U', url: 'https://rota.example.net/synthetic.ics' },
      { type: 'microsoft', id: 'm', name: 'M', tenantId: '11111111-2222-3333-4444-555555555555', clientId: '66666666-7777-8888-9999-000000000000' },
    ] };
    const saved = readConfig(raw);
    const draft = withoutSecrets(exportConfig(saved));
    const text = JSON.stringify(draft);
    for (const secret of ['abcd-efgh-ijkl-mnop', 'private-synthetic', 'rota.example.net']) {
      assert.equal(text.includes(secret), false, secret);
    }
    assert.ok(text.includes('person@example.com'), 'an email is not a secret');
    const restored = readConfig(draft);
    restoreSecrets(restored, saved);
    assert.deepEqual(exportConfig(restored), exportConfig(saved));
  });
});

describe('settings page validation (SPEC 11.3 H)', () => {
  it('addresses, hosts', () => {
    assert.ok(isCalendarAddress('webcal://example.com/a.ics'));
    assert.ok(isCalendarAddress('HTTPS://example.com/a.ics'));
    assert.ok(!isCalendarAddress('http://example.com/a.ics'));
    assert.ok(!isCalendarAddress('https://'));
    assert.ok(isHost('192.168.1.50'));
    assert.ok(isHost('lifx-door.local'));
    assert.ok(!isHost('999.1.1.1'));
    assert.ok(!isHost('a b'));
  });

  it('every card rule, with the card name for the summary box', () => {
    const c = readConfig({ calendars: [
      { type: 'icloud', id: 'a', name: '', appleId: 'nope', appPassword: '' },
      { type: 'google', id: 'b', name: 'Dup', url: 'http://x', email: 'nope' },
      { type: 'url', id: 'c', name: 'dup', url: '' },
      { type: 'microsoft', id: 'd', name: 'M1', tenantId: 'x', clientId: '' },
      { type: 'microsoft', id: 'e', name: 'M2', tenantId: '11111111-2222-3333-4444-555555555555', clientId: '66666666-7777-8888-9999-000000000000' },
      { type: 'microsoft', id: 'f', name: 'M3', tenantId: '11111111-2222-3333-4444-555555555555', clientId: '66666666-7777-8888-9999-000000000000',
        useTeamsStatus: false, useCalendar: false },
    ] });
    assert.deepEqual(validate(c).map((i) => `${i.label}|${i.path}|${i.message}`), [
      'New calendar|calendars.a.name|Name is required.',
      'New calendar|calendars.a.appleId|That does not look like an email address.',
      'New calendar|calendars.a.appPassword|App-specific password is required.',
      'Dup|calendars.b.url|Use an address that starts with https:// or webcal://.',
      'Dup|calendars.b.email|That does not look like an email address.',
      'dup|calendars.c.name|Another calendar already uses this name.',
      'dup|calendars.c.url|Address is required.',
      'M1|calendars.d.tenantId|Enter it as 00000000-0000-0000-0000-000000000000.',
      'M1|calendars.d.clientId|Application (client) ID is required.',
      'M2|calendars.e.useTeamsStatus|Only one Microsoft 365 calendar can use Teams status.',
      'M3|calendars.f.useCalendar|Turn on Use Teams status, Use Outlook calendars, or both.',
    ]);
    const lists = readConfig({ calendars: [{ type: 'icloud', id: 'a', name: 'A', appleId: 'a@example.com', appPassword: 'x' }] });
    assert.deepEqual(validate(lists), []);
    assert.deepEqual(validate(lists, { listsShown: new Set(['a']) }).map((i) => i.message), ['Choose at least one calendar.']);
  });

  it('the LIFX fields only while the bulb is used', () => {
    const c = readConfig({ lifx: { enabled: false, host: 'bad host', brightness: 0 } });
    assert.deepEqual(validate(c), []);
    c.lifx.enabled = true;
    assert.deepEqual(validate(c).map((i) => `${i.label}|${i.message}`), [
      'LIFX bulb|Enter a whole number from 1 to 100.',
      'LIFX bulb|Enter an IP address such as 192.168.1.50, or a host name.',
    ]);
  });
});

describe('settings page helpers', () => {
  it('the footer mark is the shapes of assets/busy-light-footer.svg', () => {
    const svg = fs.readFileSync(path.join(root, 'assets', 'busy-light-footer.svg'), 'utf8').replace(/<metadata>[\s\S]*?<\/metadata>/, '');
    const rootTag = /<svg ([^>]*)>/.exec(svg)![1];
    for (const [k, v] of Object.entries(MARK_ROOT)) {
      assert.ok(rootTag.includes(`${k}="${v}"`), k);
    }
    const shapes = [...svg.matchAll(/<(rect|path) ([^>]*?)\/?>/g)].map((m) => [m[1], Object.fromEntries([...m[2].matchAll(/([\w-]+)="([^"]*)"/g)]
      .map((a) => [a[1], a[2]]))]);
    assert.deepEqual(shapes, MARK_SHAPES.map(([tag, attrs]) => [tag, attrs]));
  });

  it('relative times', () => {
    const now = new Date(Date.UTC(2026, 9, 8, 15));
    const ago = (s: number) => new Date(now.getTime() - s * 1000);
    assert.equal(relativeTime(ago(10), now), 'just now');
    assert.equal(relativeTime(ago(60), now), '1 minute ago');
    assert.equal(relativeTime(ago(7 * 60), now), '7 minutes ago');
    assert.equal(relativeTime(ago(3600), now), '1 hour ago');
    assert.equal(relativeTime(ago(26 * 3600), now), '1 day ago');
    assert.equal(relativeTime(ago(3 * 86400), now), '3 days ago');
  });
});
