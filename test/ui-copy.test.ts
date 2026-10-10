/**
 * Every string the settings page shows comes from homebridge-ui/src/copy.ts and is verbatim from SPEC section 11.3
 * (SPEC 15 item 14, CLAUDE.md), checked in both directions: each string in the copy module appears in the SPEC, and
 * each string SPEC 11.3 quotes is in the copy module. Functions are called with their SPEC placeholders.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import * as copy from '../homebridge-ui/src/copy.js';
import { formatDuration } from '../homebridge-ui/src/format.js';
import { SENSOR_NAMES as PLUGIN_SENSOR_NAMES, STATUS_NAMES as PLUGIN_STATUS_NAMES } from '../src/model.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const spec = fs.readFileSync(path.join(root, 'SPEC.md'), 'utf8');
const section11 = spec.slice(spec.indexOf('## 11. Settings page'), spec.indexOf('## 12. Logging'));
const copy113 = spec.slice(spec.indexOf('### 11.3 Copy (verbatim)'), spec.indexOf('## 12. Logging'));

/** The SPEC's placeholders for each function of the copy module, by its path. */
const PLACEHOLDERS: Record<string, string[]> = {
  'RIGHT_NOW.until': ['{when}', '{source}'],
  'RIGHT_NOW.from': ['{source}'],
  'RIGHT_NOW.fromApp': ['{sender}', '{app}'],
  'RIGHT_NOW.nothingUntil': ['{when}'],
  'RIGHT_NOW.meetingAt': ['{time}'],
  'WHEN.tomorrow': ['{time}'],
  'WHEN.weekday': ['{weekday}', '{time}'],
  'WHEN.date': ['{Month day}', '{time}'],
  'RIGHT_NOW.stale': ['{relative time}'],
  'CALENDARS.lastChecked': ['{relative time}'],
  'CALENDARS.removeQuestion': ['{name}'],
  'CALENDARS.sameAsSettings': ['{duration}'],
  'CALENDARS.eventsToday': ['{n}'],
  'TEST.result': ['{n}'],
  'TEST.http': ['{host}', '{code}'],
  'TEST.network': ['{host}'],
  'MICROSOFT.refused': ['{reason}'],
  'LIGHTS.foundOne': ['{label}', '{ip}'],
  'LIGHTS.foundSeveral': ['{n}'],
  'LIGHTS.bulbChoice': ['{label}', '{ip}'],
  'LIGHTS.savedMissing': ['{label}'],
  'LIGHTS.usingIp': ['{ip}'],
  'LIGHTS.usingBulb': ['{label}', '{host}'],
  'LIGHTS.usingBulbSilent': ['{label}', '{host}'],
  'LIGHTS.bulbAnswered': ['{label}'],
  'LIGHTS.bulbNoAnswer': ['{label}'],
  'STATUS_INPUT.portError': ['{port}'],
  'STATUS_INPUT.addressChanged': ['{old}', '{new}'],
  'COLORS.moreStatuses': ['{n}'],
  'DURATIONS.minutes': ['{n}'],
  'DURATIONS.seconds': ['{n}'],
  'DURATIONS.minuteAndSeconds': ['{s}'],
  'DURATIONS.minutesAndSeconds': ['{m}', '{s}'],
  'DURATIONS.withDefault': ['{duration}'],
  'STATUS_INPUT.portHelp': ['{port}'],
  'STATUS_INPUT.fromApp': ['{app}'],
  'STATUS_INPUT.lastHeard': ['{relative time}'],
  'LIGHTS.sensor': ['{name}', 'Available'],
  'LIGHTS.steps.0': [],
  'LIGHTS.steps.1': ['{name}'],
  'LIGHTS.steps.2': [],
  'LIGHTS.steps.3': ['{name}'],
  'SHELL.issuesCount': ['{n}'],
  'SHELL.issue': ['{Card name}', '{message}'],
  'FOOTER.version': ['{version}'],
  'RELATIVE.minutes': ['{n}'],
  'RELATIVE.hours': ['{n}'],
  'RELATIVE.days': ['{n}'],
  'VALIDATION.required': ['{Label}'],
  'VALIDATION.wholeNumber': ['{min}', '{max}'],
};

/** The counts the SPEC quotes with their singular (and none) forms beside the {n} form. */
const COUNTS = ['CALENDARS.eventsToday', 'TEST.result', 'SHELL.issuesCount', 'RELATIVE.minutes', 'RELATIVE.hours', 'RELATIVE.days'];

/** Every string of the copy module, by its path, with functions called with their placeholders (and with 1 and 0 for counts). */
function strings(): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (value: unknown, at: string): void => {
    if (typeof value === 'string') {
      out.set(at, value);
    } else if (typeof value === 'function') {
      const args = PLACEHOLDERS[at];
      assert.ok(args, `no placeholders listed for ${at}`);
      out.set(at, (value as (...a: unknown[]) => string)(...args));
      if (COUNTS.includes(at)) {
        out.set(`${at}(1)`, (value as (n: number) => string)(1));
        if (!at.startsWith('RELATIVE.') && at !== 'SHELL.issuesCount') {
          out.set(`${at}(0)`, (value as (n: number) => string)(0));
        }
      }
    } else if (Array.isArray(value)) {
      value.forEach((v, i) => walk(v, `${at}.${i}`));
    } else if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) {
        walk(v, at ? `${at}.${k}` : k);
      }
    }
  };
  walk({ ...copy }, '');
  // The strings the page builds from two pieces of copy.
  out.set('RIGHT_NOW.from(Teams)', copy.RIGHT_NOW.from(copy.RIGHT_NOW.teams));
  out.set('RIGHT_NOW.until(Teams)', copy.RIGHT_NOW.until('{when}', copy.RIGHT_NOW.teams));
  for (const [key, ending] of Object.entries(copy.SENSOR_NAMES)) {
    out.set(`LIGHTS.sensor(${key})`, copy.LIGHTS.sensor('{name}', ending));
  }
  // The durations the SPEC quotes for the interval selects (11.3 C and F), and the defaults it marks.
  for (const seconds of [15, 30, 60, 90, 120, 180, 240, 300, 600]) {
    out.set(`formatDuration(${seconds})`, formatDuration(seconds));
  }
  out.set('DURATIONS.withDefault(30)', copy.DURATIONS.withDefault(formatDuration(30)));
  out.set('DURATIONS.withDefault(180)', copy.DURATIONS.withDefault(formatDuration(180)));
  // The number messages the SPEC quotes with their ranges filled in.
  for (const [min, max] of [[1024, 65535], [1, 12]]) {
    out.set(`VALIDATION.wholeNumber(${min}, ${max})`, copy.VALIDATION.wholeNumber(min, max));
  }
  return out;
}

test('every string of the copy module is in SPEC section 11, verbatim', () => {
  const sentences = strings();
  assert.ok(sentences.size > 200);
  for (const [at, value] of sentences) {
    if (at.startsWith('STATUS_NAMES.') || at.startsWith('SENSOR_NAMES.')) {
      continue; // the names of SPEC 6.2 and 7, checked below
    }
    if (at.startsWith('LIGHTS.sensor(')) {
      continue; // the accessory names, checked below
    }
    if (/\(\d\)$/.test(at)) {
      // A count of 1 or 0: its phrase is quoted in the SPEC beside the {n} form.
      const phrase = /(?:1|[Nn]o) \w+(?: \w+)*/.exec(value)?.[0] ?? value;
      assert.ok(section11.includes(phrase), `${at}: ${phrase}`);
      continue;
    }
    const where = /^https:\/\//.test(value) ? spec : section11;
    assert.ok(where.includes(value), `${at}: "${value}" is not in SPEC section 11`);
  }
});

test('every string SPEC 11.3 quotes is in the copy module', () => {
  const values = new Set(strings().values());
  const all = [...values].join('\n');
  const quoted = [...copy113.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  // Code and data the SPEC names in passing, not words the page shows.
  // `1:00 PM` is the SPEC's example of a time, which the page formats in the browser's locale.
  // Addresses and the setup code are built from data; `notListening` and `unauthorized` are /input/test error keys;
  // `Home app` is a sender name the plugin writes, which the page shows as data.
  // `calendarSeconds`, `config.json` and the Outlook hosts name data the page reads or compares, not words it shows.
  // `clear`, `ended` and `statusInput.reported` (build 3.2) name a status input word and state file fields the page reads.
  const notCopy = new RegExp('^(/|lifx\\.|verificationUri$|use$|homebridge-|assets/|busy-light|1:00 PM$|http://|busylight://|notListening$|unauthorized$'
    + '|Home app$|calendarSeconds$|config\\.json$|outlook\\.(office365|office|live)\\.com$|clear$|ended$|statusInput\\.reported$)');
  const missing = quoted.filter((q) => !notCopy.test(q) && !values.has(q) && !all.includes(q));
  assert.deepEqual(missing, []);
});

test('the status and sensor names are those of SPEC 6.2 and 7, as the plugin has them', () => {
  assert.deepEqual(copy.STATUS_NAMES, PLUGIN_STATUS_NAMES);
  assert.deepEqual(Object.keys(copy.STATUS_NAMES), Object.keys(PLUGIN_STATUS_NAMES));
  assert.deepEqual(copy.SENSOR_NAMES, PLUGIN_SENSOR_NAMES);
  assert.deepEqual(Object.keys(copy.SENSOR_NAMES), Object.keys(PLUGIN_SENSOR_NAMES));
});

test('no em dash, en dash, double hyphen or emoji in the copy', () => {
  for (const [at, value] of strings()) {
    assert.ok(!/[\u2013\u2014]|--|\p{Extended_Pictographic}/u.test(value), at);
  }
});

test('no beta wording and no Apple ID in the copy, from version 1.0.0 (build 3.3)', () => {
  for (const [at, value] of strings()) {
    assert.ok(!/\bbeta\b|Apple ID/i.test(value), `${at}: ${value}`);
  }
});
