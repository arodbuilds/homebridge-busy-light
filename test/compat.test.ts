/**
 * Configuration compatibility (SPEC 9, 15 item 35, build 3.3): a block shaped as each beta wrote it, and the owner's
 * shape, loads with no issue, resolves to the settings it did, and comes back from the settings page's Save with the
 * same meaning. From 1.0.0 the keys are stable, so these blocks must keep working. Every value is synthetic.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseConfig } from '../src/config.js';
import type { BusyLightConfig } from '../src/config.js';
import { exportConfig, readConfig } from '../homebridge-ui/src/model.js';

const KEY = 'Synthetic-compat-key-00000000000000000000000';
const OUTLOOK = 'https://outlook.office365.com/owa/calendar/synthetic/synthetic/reachcalendar.ics';

/** 0.1.0-beta.1: the standard form, iCloud calendars by name, no ids, a single lifx.bulb name. */
const BETA_1 = {
  platform: 'BusyLight', name: 'Busy Light',
  calendars: [
    { type: 'icloud', name: 'iCloud', appleId: 'person@example.com', appPassword: 'synthetic-app-password', calendars: ['Alex'],
      useTeamsStatus: true, useCalendar: true },
  ],
  colors: { available: '#00ff00', offline: 'off' },
  lifx: { enabled: true, bulb: 'Floor', host: '', brightness: 100, refreshSeconds: 300 },
  sensors: ['available', 'busyAny', 'outOfOffice'],
  overrideSwitch: false, pollSeconds: 30, calendarSeconds: 180, ignoreAllDayBusy: true, debug: false,
};

/** 0.1.0-beta.3: ids from the page, calendars as objects with use, the status input and the On a Call switch. */
const BETA_3 = {
  platform: 'BusyLight', name: 'Busy Light',
  calendars: [
    { type: 'icloud', id: 'cal-mgx3k2f1a9q', name: 'iCloud', appleId: 'person@example.com', appPassword: 'synthetic-app-password',
      calendars: [{ id: '/123456789/calendars/home/', name: 'Alex', use: 'all' }] },
    { type: 'url', id: 'cal-mgx3kb9h1j4', name: 'Team rota', url: 'webcal://rota.example.net/rota.ics', use: 'outOfOffice', calendarSeconds: 600 },
  ],
  lifx: { enabled: true, bulb: 'd073d5000001', host: '', brightness: 80, refreshSeconds: 300 },
  sensors: ['available', 'busyAny', 'outOfOffice', 'inCall'],
  statusInput: { enabled: true, port: 8582, key: KEY, allowPlainKey: true },
  callSwitch: { enabled: true, hours: 3 },
};

/** 0.1.0-beta.4: intervals in seconds that are not in the page's lists, and an Outlook published link. */
const BETA_4 = {
  platform: 'BusyLight',
  calendars: [{ type: 'url', id: 'cal-office', name: 'Office', url: OUTLOOK, use: 'all', calendarSeconds: 90 }],
  pollSeconds: 45,
  calendarSeconds: 90,
  lifx: { enabled: true, bulb: 'd073d5000001' },
  statusInput: { enabled: false, port: 8582, key: '', allowPlainKey: true },
  callSwitch: { enabled: false, hours: 3 },
};

/** 0.1.0-beta.5: lifx.bulbs, the Working switch and the meeting warning. */
const BETA_5 = {
  platform: 'BusyLight', name: 'Busy Light',
  calendars: [{ type: 'url', id: 'cal-office', name: 'Office', url: OUTLOOK, use: 'all' }],
  lifx: { enabled: true, bulbs: ['d073d5000001', 'd073d5000004'], host: '', brightness: 100, refreshSeconds: 300 },
  sensors: ['available', 'busyAny', 'outOfOffice', 'meetingSoon'],
  workingSwitch: { enabled: true },
  meetingWarningSeconds: 120,
};

/** The owner's configuration (the build prompt), with synthetic values. */
const OWNER = {
  platform: 'BusyLight', name: 'Busy Light',
  calendars: [
    { type: 'icloud', id: 'cal-icloud', name: 'iCloud', appleId: 'person@example.com', appPassword: 'synthetic-app-password',
      calendars: [{ id: '/123456789/calendars/home/', name: 'Alex', use: 'all' }] },
    { type: 'url', id: 'cal-office', name: 'Office', url: OUTLOOK, use: 'all' },
  ],
  lifx: { enabled: true, bulbs: ['d073d5000001', 'd073d5000004'], host: '', brightness: 100, refreshSeconds: 300 },
  sensors: ['available', 'busyAny', 'outOfOffice'],
  statusInput: { enabled: true, port: 8582, key: KEY, allowPlainKey: true },
  callSwitch: { enabled: true, hours: 3 },
  workingSwitch: { enabled: true },
  meetingWarningSeconds: 60,
};

function load(raw: Record<string, unknown>): BusyLightConfig {
  const { config, issues } = parseConfig(raw);
  assert.deepEqual(issues, [], 'no issue');
  return config;
}

/** What the settings page writes back on Save, read by the plugin. */
function savedByPage(raw: Record<string, unknown>): BusyLightConfig {
  return load(exportConfig(readConfig(raw)));
}

describe('configuration compatibility: a block from each beta loads and behaves as it did (SPEC 9, 15 item 35)', () => {
  it('0.1.0-beta.1: calendars by name, a single bulb name, and every later feature off', () => {
    const c = load(BETA_1);
    const icloud = c.calendars[0];
    assert.equal(icloud.id, 'icloud', 'the id derived from the name');
    assert.equal(icloud.type, 'icloud');
    assert.deepEqual(icloud.type === 'icloud' ? icloud.calendars : null, [{ id: null, name: 'Alex', use: 'all' }]);
    assert.deepEqual(c.lifx.bulbs, ['Floor'], 'lifx.bulb read as a list of one');
    assert.equal(c.colors.available, '#00FF00');
    assert.deepEqual([c.statusInput.enabled, c.callSwitch.enabled, c.workingSwitch.enabled, c.meetingWarningSeconds], [false, false, false, 0]);
    assert.deepEqual(savedByPage(BETA_1), c, 'the page\'s Save keeps its meaning');
  });

  it('0.1.0-beta.3: the status input, the On a Call switch, use and a calendar\'s own interval', () => {
    const c = load(BETA_3);
    assert.deepEqual([c.statusInput.enabled, c.statusInput.key, c.callSwitch.enabled, c.callSwitch.hours], [true, KEY, true, 3]);
    assert.equal(c.calendars[1].type === 'url' ? c.calendars[1].url : '', 'https://rota.example.net/rota.ics');
    assert.deepEqual([c.calendars[1].calendarSeconds, c.calendars[1].type === 'url' ? c.calendars[1].use : null], [600, 'outOfOffice']);
    assert.deepEqual([c.lifx.bulbs, c.lifx.brightness], [['d073d5000001'], 80]);
    assert.deepEqual(savedByPage(BETA_3), c);
  });

  it('0.1.0-beta.4: intervals in seconds outside the page\'s lists are kept', () => {
    const c = load(BETA_4);
    assert.deepEqual([c.pollSeconds, c.calendarSeconds, c.calendars[0].calendarSeconds], [45, 90, 90]);
    assert.deepEqual(savedByPage(BETA_4), c);
  });

  it('0.1.0-beta.5: lifx.bulbs, the Working switch and the meeting warning', () => {
    const c = load(BETA_5);
    assert.deepEqual(c.lifx.bulbs, ['d073d5000001', 'd073d5000004']);
    assert.deepEqual([c.workingSwitch.enabled, c.meetingWarningSeconds], [true, 120]);
    assert.ok(c.sensors.includes('meetingSoon'));
    assert.deepEqual(savedByPage(BETA_5), c);
  });

  it('the owner\'s configuration', () => {
    const c = load(OWNER);
    assert.deepEqual(c.calendars.map((s) => [s.type, s.name]), [['icloud', 'iCloud'], ['url', 'Office']]);
    assert.deepEqual([c.lifx.enabled, c.lifx.bulbs, c.lifx.brightness], [true, ['d073d5000001', 'd073d5000004'], 100]);
    assert.deepEqual(c.sensors, ['available', 'busyAny', 'outOfOffice']);
    assert.deepEqual([c.statusInput.enabled, c.callSwitch.enabled, c.workingSwitch.enabled, c.meetingWarningSeconds], [true, true, true, 60]);
    assert.deepEqual(savedByPage(OWNER), c);
  });
});
