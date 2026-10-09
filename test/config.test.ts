import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultConfig, deriveId, normalizeCalendarUrl, normalizeColor, ownerAddresses, parseConfig } from '../src/config.js';
import type { ConfigIssue } from '../src/config.js';
import { DEFAULT_COLORS } from '../src/model.js';

const TENANT = '11111111-2222-3333-4444-555555555555';
const CLIENT = '66666666-7777-8888-9999-000000000000';
const FEED = 'https://calendar.example.com/ical/synthetic-secret/basic.ics';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

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

test('the example block of SPEC section 9 (the build 2 shape) reads cleanly', () => {
  const spec = fs.readFileSync(path.join(root, 'SPEC.md'), 'utf8');
  const example = JSON.parse(/## 9\. Configuration[\s\S]*?```json\n([\s\S]*?)```/.exec(spec)![1]) as { calendars: Record<string, unknown>[] };
  // The example leaves the secrets and addresses empty; fill them with synthetic values.
  const fill: Record<string, Record<string, string>> = {
    icloud: { appleId: 'person@example.com', appPassword: 'abcd-efgh-ijkl-mnop' },
    google: { url: FEED, email: 'person@example.org' },
    microsoft: { tenantId: TENANT, clientId: CLIENT },
    url: { url: 'webcal://rota.example.net/team.ics' },
  };
  example.calendars = example.calendars.map((c) => ({ ...c, ...fill[c.type as string] }));
  const { config, issues } = parseConfig(example);
  assert.deepEqual(issues, []);
  assert.deepEqual(config.calendars.map((c) => [c.type, c.id, c.name]), [
    ['icloud', 'cal-mgx3k2f1a9q', 'iCloud'],
    ['google', 'cal-mgx3k5b7c2d', 'Personal'],
    ['microsoft', 'cal-mgx3k8e4f6g', 'Work'],
    ['url', 'cal-mgx3kb9h1j4', 'Team rota'],
  ]);
  const [icloud, google, microsoft, url] = config.calendars;
  assert.deepEqual(icloud.type === 'icloud' && icloud.calendars, [
    { id: '/123456789/calendars/home/', name: 'Alex', use: 'all' },
    { id: '/123456789/calendars/family-1/', name: 'Family', use: 'outOfOffice' },
  ]);
  assert.equal(google.type === 'google' && google.use, 'all');
  assert.deepEqual(microsoft.type === 'microsoft' && microsoft.calendars, [{ id: 'AAMkAGSyntheticCalendarId=', name: 'Calendar', use: 'all' }]);
  assert.equal(url.type === 'url' && url.url, 'https://rota.example.net/team.ics');
  assert.equal(url.type === 'url' && url.use, 'outOfOffice');
  assert.equal(url.calendarSeconds, 600, 'its own interval (rule 19)');
  assert.deepEqual(config.calendars.slice(0, 3).map((c) => c.calendarSeconds), [undefined, undefined, undefined], 'the others use the platform interval');
  assert.deepEqual(config.statusInput, { enabled: false, port: 8582, key: '', allowPlainKey: true });
  assert.deepEqual(config.callSwitch, { enabled: false, hours: 3 });
  assert.deepEqual(ownerAddresses(config), ['person@example.com', 'person@example.org']);
});

test('a block written by build 1 reads as before: no ids, an iCloud list of names, no use', () => {
  // The shape of the configuration on the Pi: one iCloud source with one calendar name, the bulb found by discovery.
  const { config, issues } = parseConfig({
    platform: 'BusyLight',
    name: 'Busy Light',
    calendars: [{ type: 'icloud', name: 'iCloud', appleId: 'person@example.com', appPassword: 'abcd-efgh-ijkl-mnop', calendars: ['Alex'],
      useTeamsStatus: true, useCalendar: true }],
    lifx: { enabled: true },
    sensors: ['available', 'busyAny', 'outOfOffice'],
  });
  assert.deepEqual(issues, []);
  assert.deepEqual(config.calendars, [{
    type: 'icloud', id: 'icloud', name: 'iCloud', appleId: 'person@example.com', appPassword: 'abcd-efgh-ijkl-mnop',
    calendars: [{ id: null, name: 'Alex', use: 'all' }],
  }]);
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

const ICLOUD = { type: 'icloud', name: 'Family', appleId: 'person@example.com', appPassword: 'synthetic' };
const MICROSOFT = { type: 'microsoft', name: 'Work', tenantId: TENANT, clientId: CLIENT };

test('rule 13: iCloud calendars are names (build 1) or { id, name, use } entries; an empty list keeps every calendar', () => {
  const { config, issues } = parseConfig({
    calendars: [{
      ...ICLOUD,
      calendars: [
        ' Alex ',
        { id: '/123456789/calendars/home/', name: 'Home', use: 'all' },
        { id: '/123456789/calendars/family-1/', name: 'Family', use: 'outOfOffice' },
        { name: 'Name only' },
        { id: '/123456789/calendars/id-only/' },
      ],
    }],
  });
  assert.deepEqual(issues, []);
  const icloud = config.calendars[0];
  assert.deepEqual(icloud.type === 'icloud' && icloud.calendars, [
    { id: null, name: 'Alex', use: 'all' },
    { id: '/123456789/calendars/home/', name: 'Home', use: 'all' },
    { id: '/123456789/calendars/family-1/', name: 'Family', use: 'outOfOffice' },
    { id: null, name: 'Name only', use: 'all' },
    { id: '/123456789/calendars/id-only/', name: '', use: 'all' },
  ]);
  for (const list of [undefined, null, []]) {
    const empty = parseConfig({ calendars: [{ ...ICLOUD, calendars: list }] });
    assert.deepEqual(empty.issues, []);
    assert.deepEqual(empty.config.calendars[0].type === 'icloud' && empty.config.calendars[0].calendars, []);
  }
});

test('rule 14: Microsoft calendars are { id, name, use } entries; none means the default calendar; kept when useCalendar is off', () => {
  const { config, issues } = parseConfig({
    calendars: [
      { ...MICROSOFT, calendars: [{ id: 'AAMkSyntheticOne=', name: 'Calendar' }, { id: 'AAMkSyntheticTwo=', name: 'Holidays', use: 'outOfOffice' }] },
      { ...MICROSOFT, name: 'Presence', useTeamsStatus: false, calendars: undefined },
    ],
  });
  assert.deepEqual(issues, []);
  assert.deepEqual(config.calendars.map((c) => c.type === 'microsoft' && c.calendars), [
    [{ id: 'AAMkSyntheticOne=', name: 'Calendar', use: 'all' }, { id: 'AAMkSyntheticTwo=', name: 'Holidays', use: 'outOfOffice' }],
    [],
  ]);
  const off = parseConfig({ calendars: [{ ...MICROSOFT, useCalendar: false, calendars: [{ id: 'AAMkSyntheticOne=', name: 'Calendar' }] }] });
  assert.deepEqual(off.issues, []);
  assert.equal(off.config.calendars[0].type === 'microsoft' && off.config.calendars[0].calendars.length, 1);
});

test('rule 15: use is all or outOfOffice on Google and URL sources and on each listed calendar; anything else is all with a warning', () => {
  const { config, issues } = parseConfig({
    calendars: [
      { type: 'google', name: 'Personal', url: FEED, use: 'outOfOffice' },
      { type: 'url', name: 'Rota', url: FEED },
      { type: 'url', name: 'Odd', url: FEED, use: 'busy' },
      { ...ICLOUD, calendars: [{ id: '/1/calendars/a/', name: 'A', use: 'OutOfOffice' }, { id: '/1/calendars/b/', name: 'B', use: 7 }] },
    ],
  });
  assert.deepEqual(lines(issues), [
    'warn calendars[2].use: must be all or outOfOffice',
    'warn calendars[3].calendars[0].use: must be all or outOfOffice',
    'warn calendars[3].calendars[1].use: must be all or outOfOffice',
  ]);
  const uses = config.calendars.map((c) => (c.type === 'google' || c.type === 'url' ? c.use : c.type === 'icloud' ? c.calendars.map((x) => x.use) : null));
  assert.deepEqual(uses, ['outOfOffice', 'all', 'all', ['all', 'all']]);
});

test('rule 16: an item with neither id nor name, or with a repeated id, is ignored with a warning; Microsoft items need an id', () => {
  const { config, issues } = parseConfig({
    calendars: [
      {
        ...ICLOUD,
        calendars: [
          'Home', '', 42, null, { use: 'all' }, { id: ' ', name: ' ' }, ['x'], { id: '/1/calendars/a/', name: 'A' }, { id: '/1/calendars/a/', name: 'Again' },
        ],
      },
      { ...MICROSOFT, calendars: [{ name: 'No id' }, { id: 'AAMkSyntheticOne=' }, { id: 'AAMkSyntheticOne=', name: 'Twice' }] },
    ],
  });
  assert.deepEqual(lines(issues), [
    'warn calendars[0].calendars[1]: must be a calendar name or entry, ignored',
    'warn calendars[0].calendars[2]: must be a calendar name or entry, ignored',
    'warn calendars[0].calendars[3]: must be a calendar name or entry, ignored',
    'warn calendars[0].calendars[4]: must be a calendar name or entry, ignored',
    'warn calendars[0].calendars[5]: must be a calendar name or entry, ignored',
    'warn calendars[0].calendars[6]: must be a calendar name or entry, ignored',
    'warn calendars[0].calendars[8]: repeats an earlier calendar, ignored',
    'warn calendars[1].calendars[0]: must be a calendar name or entry, ignored',
    'warn calendars[1].calendars[2]: repeats an earlier calendar, ignored',
  ]);
  assert.deepEqual(config.calendars.map((c) => (c.type === 'icloud' || c.type === 'microsoft' ? c.calendars : null)), [
    [{ id: null, name: 'Home', use: 'all' }, { id: '/1/calendars/a/', name: 'A', use: 'all' }],
    [{ id: 'AAMkSyntheticOne=', name: '', use: 'all' }],
  ]);
});

test('rules 13 to 16: warnings never carry a calendar id, which can hold the iCloud account number', () => {
  const { issues } = parseConfig({
    calendars: [{ ...ICLOUD, calendars: [{ id: '/123456789/calendars/a/', name: 'A', use: 'x' }, { id: '/123456789/calendars/a/' }] }],
  });
  assert.equal(issues.length, 2);
  for (const line of lines(issues)) {
    assert.ok(!line.includes('123456789'), line);
  }
});

/** A synthetic status input key of 43 characters, as the settings page generates them (SPEC 18.8 item 1). */
const KEY = 'Synthetic-config-key-0000000000000000000000';

test('rule 17: the status input, off by default; on only with a valid key, else one error and it stays off', () => {
  assert.equal(KEY.length, 43);
  assert.deepEqual(parseConfig({}).config.statusInput, { enabled: false, port: 8582, key: '', allowPlainKey: true });
  let parsed = parseConfig({ statusInput: { enabled: true, port: 9000, key: KEY } });
  assert.deepEqual(parsed.issues, []);
  assert.deepEqual(parsed.config.statusInput, { enabled: true, port: 9000, key: KEY, allowPlainKey: true });
  parsed = parseConfig({ statusInput: { enabled: true, key: KEY, allowPlainKey: false } });
  assert.deepEqual(parsed.issues, []);
  assert.equal(parsed.config.statusInput.allowPlainKey, false, 'the plain key can be turned off (SPEC 18.8 item 9)');
  assert.deepEqual(lines(parseConfig({ statusInput: { allowPlainKey: 'no' } }).issues), ['warn statusInput.allowPlainKey: must be true or false']);
  assert.equal(parseConfig({ statusInput: { allowPlainKey: 'no' } }).config.statusInput.allowPlainKey, true, 'falls back to on');
  for (const key of ['a'.repeat(32), `${'Z'.repeat(64)}-_${'9'.repeat(62)}`]) {
    parsed = parseConfig({ statusInput: { enabled: true, key } });
    assert.deepEqual(parsed.issues, [], `${key.length} characters`);
    assert.equal(parsed.config.statusInput.enabled, true);
  }
  for (const key of [undefined, '', 'a'.repeat(31), 'a'.repeat(129), `${KEY.slice(0, 42)}+`, `${KEY.slice(0, 40)} ab`, 42]) {
    parsed = parseConfig({ statusInput: { enabled: true, key } });
    assert.deepEqual(lines(parsed.issues), ['error statusInput.key: must be 32 to 128 letters, digits, hyphens or underscores'], String(key));
    assert.equal(parsed.config.statusInput.enabled, false, 'stays off');
    assert.equal(parsed.config.statusInput.key, '');
  }
  parsed = parseConfig({ statusInput: { enabled: false, key: 'too short' } });
  assert.deepEqual(parsed.issues, [], 'a key that is not used is not checked');
  assert.equal(parsed.config.statusInput.key, '');
});

test('rule 17: the port falls back to 8582 with a warning; a statusInput that is not an object is ignored with one', () => {
  for (const port of [1023, 65536, 8582.5, '8582', -1]) {
    const { config, issues } = parseConfig({ statusInput: { enabled: true, port, key: KEY } });
    assert.deepEqual(lines(issues), ['warn statusInput.port: must be a whole number from 1024 to 65535'], String(port));
    assert.equal(config.statusInput.port, 8582);
    assert.equal(config.statusInput.enabled, true);
  }
  for (const port of [1024, 65535]) {
    assert.equal(parseConfig({ statusInput: { port } }).config.statusInput.port, port);
  }
  assert.deepEqual(lines(parseConfig({ statusInput: true }).issues), ['warn statusInput: must be a set of status input settings']);
  assert.deepEqual(lines(parseConfig({ statusInput: { enabled: 'yes', key: KEY } }).issues), ['warn statusInput.enabled: must be true or false']);
});

test('rule 17: no validation line ever carries the key', () => {
  const { issues } = parseConfig({ statusInput: { enabled: true, port: 1, key: `${KEY}!` } });
  assert.equal(issues.length, 2);
  for (const line of lines(issues)) {
    assert.ok(!line.includes(KEY.slice(0, 20)), line);
  }
});

test('rule 18: the On a Call switch, off by default, with hours from 1 to 12 falling back to 3 with a warning', () => {
  assert.deepEqual(parseConfig({}).config.callSwitch, { enabled: false, hours: 3 });
  assert.deepEqual(parseConfig({ callSwitch: { enabled: true, hours: 12 } }).config.callSwitch, { enabled: true, hours: 12 });
  assert.deepEqual(parseConfig({ callSwitch: { enabled: true, hours: 1 } }).issues, []);
  for (const hours of [0, 13, 2.5, '3']) {
    const { config, issues } = parseConfig({ callSwitch: { enabled: true, hours } });
    assert.deepEqual(lines(issues), ['warn callSwitch.hours: must be a whole number from 1 to 12'], String(hours));
    assert.deepEqual(config.callSwitch, { enabled: true, hours: 3 });
  }
  assert.deepEqual(lines(parseConfig({ callSwitch: [] }).issues), ['warn callSwitch: must be a set of call switch settings']);
});

test('rule 20: the Working switch, off by default; a workingSwitch that is not an object is ignored with one warning', () => {
  assert.deepEqual(parseConfig({}).config.workingSwitch, { enabled: false });
  assert.deepEqual(parseConfig({ workingSwitch: { enabled: true } }), { config: { ...parseConfig({}).config, workingSwitch: { enabled: true } }, issues: [] });
  assert.deepEqual(lines(parseConfig({ workingSwitch: { enabled: 'yes' } }).issues), ['warn workingSwitch.enabled: must be true or false']);
  assert.deepEqual(lines(parseConfig({ workingSwitch: true }).issues), ['warn workingSwitch: must be a set of working switch settings']);
  assert.deepEqual(parseConfig({ workingSwitch: true }).config.workingSwitch, { enabled: false });
});

test('rule 21: the meeting warning, off by default; 60, 120, 180 or 300 seconds, anything else off with a warning', () => {
  assert.equal(parseConfig({}).config.meetingWarningSeconds, 0);
  for (const seconds of [0, 60, 120, 180, 300]) {
    const { config, issues } = parseConfig({ meetingWarningSeconds: seconds });
    assert.deepEqual([config.meetingWarningSeconds, issues], [seconds, []]);
  }
  for (const seconds of [30, 90, 600, -60, '120', true]) {
    const { config, issues } = parseConfig({ meetingWarningSeconds: seconds });
    assert.equal(config.meetingWarningSeconds, 0, String(seconds));
    assert.deepEqual(lines(issues), ['warn meetingWarningSeconds: must be 0, 60, 120, 180 or 300'], String(seconds));
  }
});

test('rule 19: any source may have its own calendarSeconds from 60 to 600; invalid falls back to the platform with a warning', () => {
  const { config, issues } = parseConfig({
    calendarSeconds: 300,
    calendars: [
      { ...ICLOUD, calendarSeconds: 60 },
      { type: 'google', name: 'G', url: FEED, calendarSeconds: 600 },
      { ...MICROSOFT, calendarSeconds: 59 },
      { type: 'url', name: 'U', url: FEED, calendarSeconds: 601 },
      { type: 'url', name: 'V', url: FEED, calendarSeconds: '120' },
      { type: 'url', name: 'W', url: FEED, calendarSeconds: 90.5 },
      { type: 'url', name: 'X', url: FEED, calendarSeconds: null },
    ],
  });
  assert.deepEqual(lines(issues), [
    'warn calendars[2].calendarSeconds: must be a whole number from 60 to 600',
    'warn calendars[3].calendarSeconds: must be a whole number from 60 to 600',
    'warn calendars[4].calendarSeconds: must be a whole number from 60 to 600',
    'warn calendars[5].calendarSeconds: must be a whole number from 60 to 600',
  ]);
  assert.deepEqual(config.calendars.map((c) => c.calendarSeconds), [60, 600, undefined, undefined, undefined, undefined, undefined]);
  assert.equal(config.calendarSeconds, 300);
});
