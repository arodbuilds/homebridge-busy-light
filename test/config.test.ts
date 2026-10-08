import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultConfig, deriveId, normalizeCalendarUrl, normalizeColor, ownerAddresses, parseConfig } from '../src/config.js';
import type { ConfigIssue } from '../src/config.js';
import { DEFAULT_COLORS } from '../src/model.js';

const TENANT = '11111111-2222-3333-4444-555555555555';
const CLIENT = '66666666-7777-8888-9999-000000000000';
const FEED = 'https://calendar.example.com/ical/synthetic-secret/basic.ics';

const lines = (issues: ConfigIssue[]) => issues.map((i) => `${i.level} ${i.path}: ${i.message}`);

test('rule 1: every field except platform is optional', () => {
  const { config, issues } = parseConfig({ platform: 'BusyLight' });
  assert.deepEqual(issues, []);
  assert.deepEqual(config, defaultConfig());
  assert.equal(config.name, 'Busy Light');
  assert.deepEqual(config.calendars, []);
  assert.deepEqual(config.sensors, ['available', 'busyAny', 'outOfOffice']);
  assert.equal(config.pollSeconds, 30);
  assert.equal(config.calendarSeconds, 180);
  assert.equal(config.ignoreAllDayBusy, true);
  assert.deepEqual(config.outOfOfficeWords, ['Out of office', 'OOO', 'Vacation', 'PTO']);
  assert.deepEqual(config.lifx, { enabled: false, bulb: '', host: '', brightness: 100, refreshSeconds: 300 });
  assert.equal(config.overrideSwitch, false);
  assert.equal(config.debug, false);
});

test('rule 1: an empty calendars list is valid', () => {
  const { config, issues } = parseConfig({ platform: 'BusyLight', calendars: [] });
  assert.deepEqual(issues, []);
  assert.deepEqual(config.calendars, []);
});

test('the example block of SPEC section 9 reads cleanly', () => {
  const { config, issues } = parseConfig({
    platform: 'BusyLight',
    name: 'Busy Light',
    calendars: [
      { type: 'icloud', name: 'Family', appleId: 'person@example.com', appPassword: 'abcd-efgh-ijkl-mnop', calendars: [] },
      { type: 'google', name: 'Personal', url: FEED, email: 'person@example.org' },
      { type: 'microsoft', name: 'Work', tenantId: TENANT, clientId: CLIENT, useTeamsStatus: true, useCalendar: true },
      { type: 'url', name: 'Team rota', url: 'webcal://rota.example.net/team.ics' },
    ],
    colors: { available: '#00FF00', offline: 'off' },
    lifx: { enabled: false, bulb: '', host: '', brightness: 100, refreshSeconds: 300 },
    sensors: ['available', 'busyAny', 'outOfOffice'],
    overrideSwitch: false,
    pollSeconds: 30,
    calendarSeconds: 180,
    ignoreAllDayBusy: true,
    outOfOfficeWords: ['Out of office', 'OOO', 'Vacation', 'PTO'],
    debug: false,
  });
  assert.deepEqual(issues, []);
  assert.deepEqual(config.calendars.map((c) => [c.type, c.id, c.name]), [
    ['icloud', 'family', 'Family'],
    ['google', 'personal', 'Personal'],
    ['microsoft', 'work', 'Work'],
    ['url', 'team-rota', 'Team rota'],
  ]);
  assert.equal(config.calendars[3].type === 'url' && config.calendars[3].url, 'https://rota.example.net/team.ics');
  assert.deepEqual(ownerAddresses(config), ['person@example.com', 'person@example.org']);
});

test('rule 2: name is required, 1 to 64 printable characters, unique without regard to case', () => {
  const { config, issues } = parseConfig({
    calendars: [
      { type: 'url', url: FEED },
      { type: 'url', name: 'x'.repeat(65), url: FEED },
      { type: 'url', name: 'Tab\there', url: FEED },
      { type: 'url', name: 'Rota', url: FEED },
      { type: 'url', name: 'ROTA', url: FEED },
      { type: 'url', name: 'y'.repeat(64), url: FEED },
    ],
  });
  assert.deepEqual(lines(issues), [
    'error calendars[0].name: is required',
    'error calendars[1].name: must be 1 to 64 printable characters',
    'error calendars[2].name: must be 1 to 64 printable characters',
    'error calendars[4].name: must be unique',
  ]);
  assert.deepEqual(config.calendars.map((c) => c.name), ['Rota', 'y'.repeat(64)]);
});

test('rule 2: the id is derived from the name unless given', () => {
  assert.equal(deriveId('Team rota'), 'team-rota');
  assert.equal(deriveId('Work (Contoso) 2'), 'work-contoso-2');
  assert.equal(deriveId('Ça va'), '-a-va');
  const { config, issues } = parseConfig({
    calendars: [
      { type: 'url', name: 'Renamed later', id: 'work', url: FEED },
      { type: 'url', name: 'Bad id', id: 'Not Valid', url: FEED },
      { type: 'url', name: 'Work', url: FEED },
    ],
  });
  assert.deepEqual(lines(issues), [
    'error calendars[1].id: must be 1 to 64 lower case letters, digits and hyphens',
    'error calendars[2].id: work is already used by another calendar',
  ]);
  assert.deepEqual(config.calendars.map((c) => c.id), ['work']);
});

test('rule 3: type and the required fields of each type', () => {
  const { config, issues } = parseConfig({
    calendars: [
      { type: 'exchange', name: 'A' },
      { name: 'B' },
      { type: 'icloud', name: 'C', appPassword: 'synthetic' },
      { type: 'icloud', name: 'D', appleId: 'person@example.com' },
      { type: 'google', name: 'E' },
      { type: 'url', name: 'F', url: 'http://calendar.example.com/feed.ics' },
      { type: 'url', name: 'G', url: 'ftp://calendar.example.com/feed.ics' },
      { type: 'microsoft', name: 'H', clientId: CLIENT },
      { type: 'microsoft', name: 'I', tenantId: 'contoso', clientId: CLIENT },
      { type: 'microsoft', name: 'J', tenantId: TENANT, clientId: 'not-a-guid' },
      { type: 'microsoft', name: 'K', tenantId: TENANT.toUpperCase(), clientId: CLIENT },
      'not an object',
    ],
  });
  assert.deepEqual(lines(issues), [
    'error calendars[0].type: must be icloud, google, microsoft or url',
    'error calendars[1].type: must be icloud, google, microsoft or url',
    'error calendars[2].appleId: is required',
    'error calendars[3].appPassword: is required',
    'error calendars[4].url: is required',
    'error calendars[5].url: must start with https:// or webcal://',
    'error calendars[6].url: must start with https:// or webcal://',
    'error calendars[7].tenantId: is required',
    'error calendars[8].tenantId: must be a GUID such as 00000000-0000-0000-0000-000000000000',
    'error calendars[9].clientId: must be a GUID such as 00000000-0000-0000-0000-000000000000',
    'error calendars[11]: must be a calendar entry',
  ]);
  assert.deepEqual(config.calendars.map((c) => c.name), ['K']);
  const k = config.calendars[0];
  assert.equal(k.type === 'microsoft' && k.tenantId, TENANT, 'GUIDs are stored in lower case');
  assert.equal(k.type === 'microsoft' && k.useTeamsStatus && k.useCalendar, true, 'both default to on');
});

test('rule 3: validation lines never carry a secret or an address', () => {
  const { issues } = parseConfig({
    calendars: [
      { type: 'url', name: 'Leaky', url: 'http://calendar.example.com/private/synthetic-secret.ics' },
      { type: 'icloud', name: 'Pw', appleId: 'person@example.com', appPassword: 42 },
    ],
  });
  for (const line of lines(issues)) {
    assert.ok(!line.includes('synthetic-secret') && !line.includes('example.com') && !line.includes('42'), line);
  }
});

test('rule 4: at most one Microsoft source uses Teams status, and one of the two must be on', () => {
  const { config, issues } = parseConfig({
    calendars: [
      { type: 'microsoft', name: 'Work', tenantId: TENANT, clientId: CLIENT },
      { type: 'microsoft', name: 'Other tenant', tenantId: TENANT, clientId: CLIENT, useTeamsStatus: true, useCalendar: true },
      { type: 'microsoft', name: 'Calendar only', tenantId: TENANT, clientId: CLIENT, useTeamsStatus: false },
      { type: 'microsoft', name: 'Neither', tenantId: TENANT, clientId: CLIENT, useTeamsStatus: false, useCalendar: false },
    ],
  });
  assert.deepEqual(lines(issues), [
    'error calendars[1].useTeamsStatus: only one Microsoft 365 calendar can use Teams status',
    'error calendars[3].useCalendar: Use Teams status and Use Outlook calendar cannot both be off',
  ]);
  assert.deepEqual(config.calendars.map((c) => c.name), ['Work', 'Calendar only']);
});

test('rule 5: colors are #RRGGBB or off in any case; unknown keys are ignored with a warning', () => {
  assert.equal(normalizeColor('#ff6a00'), '#FF6A00');
  assert.equal(normalizeColor('OFF'), 'off');
  assert.equal(normalizeColor('red'), null);
  assert.equal(normalizeColor('#FFF'), null);
  const { config, issues } = parseConfig({ colors: { available: '#00ff7f', offline: 'Off', busy: 'orange', sparkle: '#FFFFFF' } });
  assert.deepEqual(lines(issues), [
    'warn colors.busy: must be #RRGGBB or off',
    'warn colors.sparkle: is not a status, ignored',
  ]);
  assert.equal(config.colors.available, '#00FF7F');
  assert.equal(config.colors.offline, 'off');
  assert.equal(config.colors.busy, DEFAULT_COLORS.busy);
  assert.equal(config.colors.inMeeting, '#FF0000');
});

test('rule 6: lifx bulb and host are optional; host is IPv4 or a host name; brightness is 1 to 100', () => {
  const ok = parseConfig({ lifx: { enabled: true, bulb: ' Office Door ', host: '192.168.4.50', brightness: 40, refreshSeconds: 0 } });
  assert.deepEqual(ok.issues, []);
  assert.deepEqual(ok.config.lifx, { enabled: true, bulb: 'Office Door', host: '192.168.4.50', brightness: 40, refreshSeconds: 0 });
  assert.equal(parseConfig({ lifx: { host: 'lifx-door.local' } }).config.lifx.host, 'lifx-door.local');
  const bad = parseConfig({ lifx: { enabled: 'yes', host: '999.1.1.1', brightness: 0, refreshSeconds: -1 } });
  assert.deepEqual(lines(bad.issues), [
    'warn lifx.enabled: must be true or false',
    'warn lifx.host: must be an IPv4 address or host name',
    'warn lifx.brightness: must be a whole number from 1 to 100',
    'warn lifx.refreshSeconds: must be a whole number from 0 to 86400',
  ]);
  assert.deepEqual(bad.config.lifx, defaultConfig().lifx);
  assert.equal(parseConfig({ lifx: { brightness: 101 } }).config.lifx.brightness, 100);
});

test('rule 7: sensors hold keys from section 7; unknown keys are ignored; an empty list creates none', () => {
  const { config, issues } = parseConfig({ sensors: ['offline', 'inCall', 'sparkle', 'inCall'] });
  assert.deepEqual(lines(issues), ['warn sensors[2]: is not a sensor, ignored']);
  assert.deepEqual(config.sensors, ['inCall', 'offline']);
  assert.deepEqual(parseConfig({ sensors: [] }).config.sensors, []);
});

test('rule 8: an invalid scalar falls back to its default with one warning', () => {
  const { config, issues } = parseConfig({
    name: 7,
    overrideSwitch: 'on',
    pollSeconds: 5,
    calendarSeconds: 59.5,
    ignoreAllDayBusy: 'no',
    outOfOfficeWords: 'OOO',
    debug: 1,
    calendars: { type: 'url' },
    sensors: 'available',
    colors: '#FF0000',
  });
  assert.deepEqual(lines(issues), [
    'warn name: must be text',
    'warn calendars: must be a list',
    'warn colors: must be a set of colors',
    'warn sensors: must be a list',
    'warn overrideSwitch: must be true or false',
    'warn pollSeconds: must be a whole number from 15 to 240',
    'warn calendarSeconds: must be a whole number from 60 to 600',
    'warn ignoreAllDayBusy: must be true or false',
    'warn outOfOfficeWords: must be a list',
    'warn debug: must be true or false',
  ]);
  assert.deepEqual(config, defaultConfig());
});

test('rule 8: intervals have upper bounds, so fetched data never goes stale between checks', () => {
  const { config, issues } = parseConfig({ pollSeconds: 241, calendarSeconds: 601, lifx: { refreshSeconds: 86_401 } });
  assert.deepEqual(lines(issues), [
    'warn lifx.refreshSeconds: must be a whole number from 0 to 86400',
    'warn pollSeconds: must be a whole number from 15 to 240',
    'warn calendarSeconds: must be a whole number from 60 to 600',
  ]);
  assert.deepEqual([config.pollSeconds, config.calendarSeconds, config.lifx.refreshSeconds], [30, 180, 300]);
  const max = parseConfig({ pollSeconds: 240, calendarSeconds: 600, lifx: { refreshSeconds: 86_400 } });
  assert.deepEqual(max.issues, []);
});

test('rule 8: minimums and valid values are kept', () => {
  const { config, issues } = parseConfig({ pollSeconds: 15, calendarSeconds: 60, outOfOfficeWords: ['Leave', ' ', 3], name: ' Door ' });
  assert.deepEqual(lines(issues), ['warn outOfOfficeWords[2]: must be text, ignored']);
  assert.equal(config.pollSeconds, 15);
  assert.equal(config.calendarSeconds, 60);
  assert.deepEqual(config.outOfOfficeWords, ['Leave']);
  assert.equal(config.name, 'Door');
});

test('optional fields inside a source fall back with a warning', () => {
  const { config, issues } = parseConfig({
    calendars: [
      { type: 'icloud', name: 'Family', appleId: 'person@example.com', appPassword: 'synthetic', calendars: 'Home' },
      { type: 'microsoft', name: 'Work', tenantId: TENANT, clientId: CLIENT, useCalendar: 'yes' },
    ],
  });
  assert.deepEqual(lines(issues), [
    'warn calendars[0].calendars: must be a list',
    'warn calendars[1].useCalendar: must be true or false',
  ]);
  assert.equal(config.calendars.length, 2);
});

test('calendar addresses', () => {
  assert.equal(normalizeCalendarUrl('webcal://example.com/a.ics?k=1'), 'https://example.com/a.ics?k=1');
  assert.equal(normalizeCalendarUrl('WEBCAL://example.com/a.ics'), 'https://example.com/a.ics');
  assert.equal(normalizeCalendarUrl('https://example.com/a.ics'), 'https://example.com/a.ics');
  assert.equal(normalizeCalendarUrl('http://example.com/a.ics'), null);
  assert.equal(normalizeCalendarUrl('https://'), null);
});
