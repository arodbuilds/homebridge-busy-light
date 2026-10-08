import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultConfig } from '../src/config.js';
import { SENSOR_KEYS, SENSOR_NAMES, STATUS_KEYS, STATUS_NAMES } from '../src/model.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

interface Prop {
  title?: string;
  description?: string;
  type?: string;
  default?: unknown;
  oneOf?: { title: string; enum: string[] }[];
  anyOf?: Prop[];
  enum?: string[];
  properties?: Record<string, Prop>;
  items?: Prop & { enum?: string[] };
  pattern?: string;
}

interface LayoutItem {
  key?: string;
  title?: string;
  description?: string;
  condition?: { functionBody: string };
  items?: (LayoutItem | string)[];
  titleMap?: { value: string; name: string }[];
}

const raw = fs.readFileSync(path.join(root, 'config.schema.json'), 'utf8');
const schema = JSON.parse(raw) as { pluginAlias: string; pluginType: string; singular: boolean; headerDisplay: string;
  schema: { properties: Record<string, Prop> }; layout: (LayoutItem | string)[] };
const props = schema.schema.properties;
const item = props.calendars.items!.properties!;
const spec = fs.readFileSync(path.join(root, 'SPEC.md'), 'utf8');

/** Rows of the SPEC 9.2 table: [field, title, description]. */
function specRows(): [string, string, string][] {
  const section = spec.slice(spec.indexOf('### 9.2'), spec.indexOf('## 10.'));
  return section.split('\n')
    .filter((l) => l.startsWith('| `'))
    .map((l) => l.split('|').slice(1, -1).map((c) => c.trim()) as [string, string, string]);
}

function layoutEntries(items: (LayoutItem | string)[] = schema.layout): LayoutItem[] {
  return items.flatMap((i) => (typeof i === 'string' ? [{ key: i }] : [i, ...layoutEntries(i.items ?? [])]));
}

const urlLayout = (type: string) => layoutEntries().find((l) => l.key === 'calendars[].url' && l.condition?.functionBody.includes(`'${type}'`))!;

test('valid JSON for the standard form', () => {
  assert.equal(schema.pluginAlias, 'BusyLight');
  assert.equal(schema.pluginType, 'platform');
  assert.equal(schema.singular, true);
  assert.ok(!/[\u2013\u2014]/.test(raw), 'no dashes');
});

test('headerDisplay is verbatim', () => {
  const quoted = /`headerDisplay`: "(.+)"/.exec(spec)![1];
  assert.equal(schema.headerDisplay, quoted);
});

test('every title and description of SPEC 9.2, verbatim', () => {
  const rows = specRows();
  assert.equal(rows.length, 34);
  for (const [field, title, description] of rows) {
    const desc = description || undefined;
    switch (field) {
    case '`calendars[].type`':
      assert.equal(item.type.title, title);
      assert.deepEqual(item.type.oneOf!.map((o) => o.title), ['iCloud', 'Google Calendar', 'Microsoft 365', 'Calendar URL']);
      assert.deepEqual(item.type.oneOf!.map((o) => o.enum[0]), ['icloud', 'google', 'microsoft', 'url']);
      break;
    case '`url` (Google)':
      assert.equal(urlLayout('google').title, title);
      assert.equal(urlLayout('google').description, desc);
      break;
    case '`url` (URL)':
      assert.equal(urlLayout('url').title, title);
      assert.equal(urlLayout('url').description, desc);
      assert.equal(item.url.title, title);
      break;
    case '`colors.*`':
      for (const key of STATUS_KEYS) {
        assert.equal(props.colors.properties![key].title, STATUS_NAMES[key]);
      }
      assert.equal(props.colors.description, description.replace(/^\(on the group\) /, ''));
      break;
    default: {
      const name = field.replace(/`/g, '');
      const [group, member] = name.split('.');
      const prop = name.startsWith('calendars[].') ? item[name.slice(12)]
        : member && props[group]?.properties ? props[group].properties![member]
          : name in item && !(name in props) ? item[name] : props[name];
      assert.ok(prop, `${name} is in the schema`);
      assert.equal(prop.title, title, name);
      assert.equal(prop.description, desc, name);
    }
    }
  }
});

test('every field of SPEC section 9 is present', () => {
  const block = /## 9\. Configuration[\s\S]*?```json\n([\s\S]*?)```/.exec(spec)![1];
  const example = JSON.parse(block) as Record<string, unknown> & { calendars: Record<string, unknown>[]; lifx: Record<string, unknown> };
  for (const key of Object.keys(example).filter((k) => k !== 'platform')) {
    assert.ok(key in props, key);
  }
  for (const source of example.calendars) {
    for (const key of Object.keys(source)) {
      assert.ok(key in item, `calendars[].${key}`);
    }
  }
  assert.ok('id' in item, 'calendars[].id (SPEC 9.1 item 2)');
  for (const group of ['lifx', 'statusInput', 'callSwitch']) {
    for (const key of Object.keys(example[group] as Record<string, unknown>)) {
      assert.ok(key in props[group].properties!, `${group}.${key}`);
    }
  }
  assert.deepEqual(Object.keys(props.colors.properties!), [...STATUS_KEYS]);
  assert.deepEqual(props.sensors.items!.enum, [...SENSOR_KEYS]);
});

test('build 2 fields: use on a source and on each listed calendar, and calendar entries as names or objects (SPEC 9.1 items 13 to 15)', () => {
  const titles = new RegExp('the build 2 field `use` takes its title and choices from 11\\.3 C: `([^`]+)`, with `([^`]+)` for `all` and `([^`]+)` '
    + 'for `outOfOffice`').exec(spec)!;
  assert.ok(spec.includes(`\`${titles[1]}\` (select) with \`${titles[2]}\` and \`${titles[3]}\``), 'the titles are those of 11.3 C');
  assert.equal(item.use.title, titles[1]);
  assert.deepEqual(item.use.oneOf, [{ title: titles[2], enum: ['all'] }, { title: titles[3], enum: ['outOfOffice'] }]);
  assert.equal(item.use.default, 'all');
  const entry = item.calendars.items!.anyOf!;
  assert.deepEqual(entry.map((e) => e.type), ['string', 'object'], 'a build 1 name or a build 2 entry');
  assert.deepEqual(Object.keys(entry[1].properties!), ['id', 'name', 'use']);
  assert.deepEqual(entry[1].properties!.use.enum, ['all', 'outOfOffice']);
});

test('defaults agree with the plugin defaults', () => {
  const d = defaultConfig();
  assert.equal(props.name.default, d.name);
  assert.deepEqual(props.sensors.default, d.sensors);
  assert.equal(props.overrideSwitch.default, d.overrideSwitch);
  assert.equal(props.pollSeconds.default, d.pollSeconds);
  assert.equal(props.calendarSeconds.default, d.calendarSeconds);
  assert.equal(props.ignoreAllDayBusy.default, d.ignoreAllDayBusy);
  assert.deepEqual(props.outOfOfficeWords.default, d.outOfOfficeWords);
  assert.equal(props.debug.default, d.debug);
  for (const key of STATUS_KEYS) {
    assert.equal(props.colors.properties![key].default, d.colors[key]);
  }
  for (const key of ['enabled', 'brightness', 'refreshSeconds'] as const) {
    assert.equal(props.lifx.properties![key].default, d.lifx[key]);
  }
  assert.equal(props.statusInput.properties!.enabled.default, d.statusInput.enabled);
  assert.equal(props.statusInput.properties!.port.default, d.statusInput.port);
  assert.equal(props.statusInput.properties!.allowPlainKey.default, d.statusInput.allowPlainKey);
  assert.equal(props.callSwitch.properties!.enabled.default, d.callSwitch.enabled);
  assert.equal(props.callSwitch.properties!.hours.default, d.callSwitch.hours);
  assert.equal(item.useTeamsStatus.default, true);
  assert.equal(item.useCalendar.default, true);
});

test('each source type shows only its own fields', () => {
  const shownFor = (type: string) => layoutEntries()
    .filter((l) => l.key?.startsWith('calendars[].') && !l.key.endsWith('[]') && (!l.condition || l.condition.functionBody.includes(`'${type}'`)))
    .map((l) => l.key!.slice(12));
  assert.deepEqual(shownFor('icloud'), ['type', 'name', 'appleId', 'appPassword', 'calendars', 'calendarSeconds']);
  assert.deepEqual(shownFor('google'), ['type', 'name', 'url', 'email', 'use', 'calendarSeconds']);
  assert.deepEqual(shownFor('url'), ['type', 'name', 'url', 'use', 'calendarSeconds']);
  assert.deepEqual(shownFor('microsoft'), ['type', 'name', 'tenantId', 'clientId', 'useTeamsStatus', 'useCalendar', 'calendarSeconds']);
  for (const entry of layoutEntries().filter((l) => l.condition)) {
    // The Homebridge UI runs conditions as new Function('model', 'arrayIndices', body).
    const run = new Function('model', 'arrayIndices', entry.condition!.functionBody);
    const model = { calendars: [{ type: 'url' }, { type: 'google' }], lifx: { enabled: true } };
    assert.equal(typeof run(model, [1]), 'boolean');
    assert.equal(typeof run({ ...model, statusInput: { enabled: true }, callSwitch: { enabled: false } }, [0]), 'boolean');
  }
});

test('every layout key names a schema field, and the sensors list has the names of section 7', () => {
  for (const entry of layoutEntries().filter((l) => l.key)) {
    const parts = entry.key!.replace(/\[\]$/, '').replace('[]', '').split('.');
    const prop = parts[0] === 'calendars' && parts.length > 1 ? item[parts[1]] : parts.length > 1 ? props[parts[0]].properties![parts[1]] : props[parts[0]];
    assert.ok(prop, `${entry.key} is a schema field`);
  }
  const sensors = layoutEntries().find((l) => l.key === 'sensors')!;
  assert.deepEqual(sensors.titleMap, SENSOR_KEYS.map((k) => ({ value: k, name: SENSOR_NAMES[k] })));
});

test('lists of words and names are arrays in the layout, so the form shows their items and an Add button', () => {
  // Checked in the Homebridge UI 5.29: a bare key for an array of strings renders neither.
  for (const key of ['outOfOfficeWords', 'calendars[].calendars']) {
    const entry = layoutEntries().find((l) => l.key === key)!;
    assert.equal((entry as { type?: string }).type, 'array', key);
    assert.deepEqual(entry.items, [`${key}[]`]);
  }
});

test('no list in the form can be dragged to reorder', () => {
  // Homebridge UI 5.29 makes array items draggable unless the layout says orderable: false. A dropdown inside a
  // draggable item swallows the mouse release, so choosing a calendar type left the whole entry stuck to the pointer.
  for (const key of ['calendars', 'calendars[].calendars', 'outOfOfficeWords']) {
    const entry = layoutEntries().find((l) => l.key === key && (l as { type?: string }).type === 'array')!;
    assert.equal((entry as { orderable?: boolean }).orderable, false, key);
  }
});
