/**
 * The platform block as the page edits it (SPEC section 9). `readConfig` accepts whatever config.json holds, a build 1
 * block included, and fills in the defaults; `exportConfig` writes the block back in the build 2 shape, keeping keys
 * the page does not know (the host's `_bridge` settings) exactly as loaded.
 */

import { SENSOR_NAMES, STATUS_NAMES } from './copy.js';
import type { SensorKey, StatusKey } from './copy.js';

export const PLATFORM = 'BusyLight';

export type SourceType = 'icloud' | 'google' | 'microsoft' | 'url';
export type Use = 'all' | 'outOfOffice';

export const SOURCE_TYPES: readonly SourceType[] = ['icloud', 'google', 'microsoft', 'url'];
export const STATUS_KEYS = Object.keys(STATUS_NAMES) as StatusKey[];
export const SENSOR_KEYS = Object.keys(SENSOR_NAMES) as SensorKey[];

/** One calendar of an iCloud or Microsoft list (SPEC 9.1 items 13 and 14). A build 1 iCloud name has no id. */
export interface UiChoice {
  id: string | null;
  name: string;
  use: Use;
}

/** A calendar source as its card edits it; the fields of the other types are kept empty. */
export interface UiSource {
  type: SourceType;
  /** Written explicitly and never changed, including on rename: it names the Microsoft token file (SPEC 9.1 item 2). */
  id: string;
  name: string;
  appleId: string;
  appPassword: string;
  /** iCloud and Microsoft 365: the calendars to read. Empty keeps every iCloud calendar, or the default Microsoft one. */
  calendars: UiChoice[];
  url: string;
  email: string;
  use: Use;
  tenantId: string;
  clientId: string;
  useTeamsStatus: boolean;
  useCalendar: boolean;
}

export interface UiLifx {
  enabled: boolean;
  /** A bulb's serial number as the page writes it, or a name as build 1 wrote it. */
  bulb: string;
  host: string;
  brightness: number;
  refreshSeconds: number;
}

export interface UiConfig {
  name: string;
  calendars: UiSource[];
  /** `#RRGGBB`, `off`, or whatever is being typed. */
  colors: Record<StatusKey, string>;
  lifx: UiLifx;
  sensors: SensorKey[];
  overrideSwitch: boolean;
  pollSeconds: number;
  calendarSeconds: number;
  ignoreAllDayBusy: boolean;
  /** The out of office words as one text field, separated by commas. */
  outOfOfficeWords: string;
  debug: boolean;
  /** Keys the page does not edit, written back untouched. */
  extra: Record<string, unknown>;
  /** Calendar entries the page cannot edit (an unknown type), written back untouched. */
  otherCalendars: unknown[];
}

/** The defaults of SPEC section 9 (a test keeps them equal to the plugin's). */
export const DEFAULTS = {
  name: 'Busy Light',
  colors: {
    outOfOffice: '#B400FF', doNotDisturb: '#FF0000', inCall: '#FF0000', inMeeting: '#FF0000', busy: '#FF6A00', tentative: '#FFD000',
    away: '#FFD000', available: '#00FF00', offline: 'off',
  } as Record<StatusKey, string>,
  lifx: { enabled: false, bulb: '', host: '', brightness: 100, refreshSeconds: 300 } as UiLifx,
  sensors: ['available', 'busyAny', 'outOfOffice'] as SensorKey[],
  overrideSwitch: false,
  pollSeconds: 30,
  calendarSeconds: 180,
  ignoreAllDayBusy: true,
  outOfOfficeWords: ['Out of office', 'OOO', 'Vacation', 'PTO'],
  debug: false,
};

/** The limits of SPEC 9.1, for the number fields and their messages. */
export const LIMITS = {
  pollSeconds: [15, 240],
  calendarSeconds: [60, 600],
  brightness: [1, 100],
  refreshSeconds: [0, 86400],
} as const;

const KNOWN = new Set([
  'platform', 'name', 'calendars', 'colors', 'lifx', 'sensors', 'overrideSwitch', 'pollSeconds', 'calendarSeconds', 'ignoreAllDayBusy',
  'outOfOfficeWords', 'debug',
]);

/** The id derived from a name, as the plugin derives it (SPEC 9.1 item 2). */
export function deriveId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

/**
 * A new card's id (SPEC 11.2 addition 3): `cal-`, `Date.now()` in base 36 and four random base-36 characters.
 * `crypto.randomUUID` is unavailable over plain http, where the Homebridge UI usually runs.
 */
export function newId(now = Date.now()): string {
  let random = '';
  for (let i = 0; i < 4; i++) {
    random += Math.floor(Math.random() * 36).toString(36);
  }
  return `cal-${now.toString(36)}${random}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function readUse(value: unknown): Use {
  return value === 'outOfOffice' ? 'outOfOffice' : 'all';
}

/** An empty source of a type, as a new card starts. */
export function emptySource(type: SourceType, id: string): UiSource {
  return {
    type, id, name: '', appleId: '', appPassword: '', calendars: [], url: '', email: '', use: 'all', tenantId: '', clientId: '',
    useTeamsStatus: true, useCalendar: true,
  };
}

function readChoices(value: unknown, needId: boolean): UiChoice[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: UiChoice[] = [];
  for (const item of value) {
    let choice: UiChoice | null = null;
    if (typeof item === 'string' && item.trim()) {
      choice = { id: null, name: item.trim(), use: 'all' };
    } else if (isObject(item) && (str(item.id) || str(item.name))) {
      choice = { id: str(item.id) || null, name: str(item.name), use: readUse(item.use) };
    }
    if (choice && (!needId || choice.id) && (choice.id === null || !out.some((c) => c.id === choice!.id))) {
      out.push(choice);
    }
  }
  return out;
}

function readSource(raw: Record<string, unknown>, taken: Set<string>): UiSource {
  const type = raw.type as SourceType;
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  let id = str(raw.id) || (name ? deriveId(name) : '');
  if (!id || taken.has(id)) {
    id = newId();
  }
  taken.add(id);
  const s = emptySource(type, id);
  s.name = name;
  if (type === 'icloud') {
    s.appleId = str(raw.appleId);
    s.appPassword = typeof raw.appPassword === 'string' ? raw.appPassword : '';
    s.calendars = readChoices(raw.calendars, false);
  } else if (type === 'google' || type === 'url') {
    s.url = str(raw.url);
    s.email = type === 'google' ? str(raw.email) : '';
    s.use = readUse(raw.use);
  } else {
    s.tenantId = str(raw.tenantId);
    s.clientId = str(raw.clientId);
    s.useTeamsStatus = bool(raw.useTeamsStatus, true);
    s.useCalendar = bool(raw.useCalendar, true);
    s.calendars = readChoices(raw.calendars, true);
  }
  return s;
}

export function emptyConfig(): UiConfig {
  return {
    name: DEFAULTS.name,
    calendars: [],
    colors: { ...DEFAULTS.colors },
    lifx: { ...DEFAULTS.lifx },
    sensors: [...DEFAULTS.sensors],
    overrideSwitch: DEFAULTS.overrideSwitch,
    pollSeconds: DEFAULTS.pollSeconds,
    calendarSeconds: DEFAULTS.calendarSeconds,
    ignoreAllDayBusy: DEFAULTS.ignoreAllDayBusy,
    outOfOfficeWords: DEFAULTS.outOfOfficeWords.join(', '),
    debug: DEFAULTS.debug,
    extra: {},
    otherCalendars: [],
  };
}

/** `#RRGGBB` in upper case, `off`, or the text as stored (shown with its message). */
function readColor(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    return fallback;
  }
  const v = value.trim();
  if (v.toLowerCase() === 'off') {
    return 'off';
  }
  return /^#[0-9a-f]{6}$/i.test(v) ? v.toUpperCase() : v;
}

export function readConfig(raw: unknown): UiConfig {
  const c = emptyConfig();
  if (!isObject(raw)) {
    return c;
  }
  c.name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : DEFAULTS.name;
  const taken = new Set<string>();
  for (const item of Array.isArray(raw.calendars) ? raw.calendars : []) {
    if (isObject(item) && (SOURCE_TYPES as readonly unknown[]).includes(item.type)) {
      c.calendars.push(readSource(item, taken));
    } else {
      c.otherCalendars.push(item);
    }
  }
  const colors = isObject(raw.colors) ? raw.colors : {};
  for (const key of STATUS_KEYS) {
    c.colors[key] = readColor(colors[key], DEFAULTS.colors[key]);
  }
  const lifx = isObject(raw.lifx) ? raw.lifx : {};
  c.lifx = {
    enabled: bool(lifx.enabled, DEFAULTS.lifx.enabled),
    bulb: str(lifx.bulb),
    host: str(lifx.host),
    brightness: num(lifx.brightness, DEFAULTS.lifx.brightness),
    refreshSeconds: num(lifx.refreshSeconds, DEFAULTS.lifx.refreshSeconds),
  };
  if (Array.isArray(raw.sensors)) {
    c.sensors = SENSOR_KEYS.filter((k) => (raw.sensors as unknown[]).includes(k));
  }
  c.overrideSwitch = bool(raw.overrideSwitch, DEFAULTS.overrideSwitch);
  c.pollSeconds = num(raw.pollSeconds, DEFAULTS.pollSeconds);
  c.calendarSeconds = num(raw.calendarSeconds, DEFAULTS.calendarSeconds);
  c.ignoreAllDayBusy = bool(raw.ignoreAllDayBusy, DEFAULTS.ignoreAllDayBusy);
  if (Array.isArray(raw.outOfOfficeWords)) {
    c.outOfOfficeWords = raw.outOfOfficeWords.filter((w): w is string => typeof w === 'string' && w.trim() !== '').map((w) => w.trim()).join(', ');
  }
  c.debug = bool(raw.debug, DEFAULTS.debug);
  for (const [key, value] of Object.entries(raw)) {
    if (!KNOWN.has(key)) {
      c.extra[key] = value;
    }
  }
  return c;
}

/** The words of the comma-separated field. */
export function splitWords(text: string): string[] {
  return text.split(',').map((w) => w.trim()).filter((w) => w.length > 0);
}

function exportChoice(c: UiChoice): unknown {
  // A build 1 name that was never matched to an id stays as it was written.
  if (c.id === null && c.use === 'all') {
    return c.name;
  }
  return c.id === null ? { name: c.name, use: c.use } : { id: c.id, name: c.name, use: c.use };
}

export function exportSource(s: UiSource): Record<string, unknown> {
  const base = { type: s.type, id: s.id, name: s.name.trim() };
  switch (s.type) {
  case 'icloud':
    return { ...base, appleId: s.appleId.trim(), appPassword: s.appPassword, calendars: s.calendars.map(exportChoice) };
  case 'google':
    return { ...base, url: s.url.trim(), email: s.email.trim(), use: s.use };
  case 'url':
    return { ...base, url: s.url.trim(), use: s.use };
  default: {
    const block: Record<string, unknown> = {
      ...base, tenantId: s.tenantId.trim().toLowerCase(), clientId: s.clientId.trim().toLowerCase(), useTeamsStatus: s.useTeamsStatus,
      useCalendar: s.useCalendar,
    };
    if (s.calendars.length) {
      block.calendars = s.calendars.map(exportChoice);
    }
    return block;
  }
  }
}

/** The block for `updatePluginConfig`. Every field is written, so the file reads as the page shows. */
export function exportConfig(c: UiConfig): Record<string, unknown> {
  const colors: Record<string, string> = {};
  for (const key of STATUS_KEYS) {
    const v = c.colors[key].trim();
    colors[key] = v.toLowerCase() === 'off' ? 'off' : v.toUpperCase();
  }
  return {
    ...c.extra,
    platform: PLATFORM,
    name: c.name.trim(),
    calendars: [...c.calendars.map(exportSource), ...c.otherCalendars],
    colors,
    lifx: { enabled: c.lifx.enabled, bulb: c.lifx.bulb.trim(), host: c.lifx.host.trim(), brightness: c.lifx.brightness, refreshSeconds: c.lifx.refreshSeconds },
    sensors: SENSOR_KEYS.filter((k) => c.sensors.includes(k)),
    overrideSwitch: c.overrideSwitch,
    pollSeconds: c.pollSeconds,
    calendarSeconds: c.calendarSeconds,
    ignoreAllDayBusy: c.ignoreAllDayBusy,
    outOfOfficeWords: splitWords(c.outOfOfficeWords),
    debug: c.debug,
  };
}

/**
 * The fields that hold a secret (SPEC 11.2 addition 4, CLAUDE.md): the app-specific password and every calendar
 * address, Google's secret address and a Calendar URL alike. A draft never holds them.
 */
export function withoutSecrets(block: Record<string, unknown>): Record<string, unknown> {
  const calendars = Array.isArray(block.calendars) ? block.calendars : [];
  return {
    ...block,
    calendars: calendars.map((item) => {
      if (!isObject(item)) {
        return item;
      }
      const copy = { ...item };
      if ('appPassword' in copy) {
        copy.appPassword = '';
      }
      if ('url' in copy) {
        copy.url = '';
      }
      return copy;
    }),
  };
}

/** Puts back the secret fields a draft left empty, from the source of the same id and type in the saved configuration. */
export function restoreSecrets(draft: UiConfig, saved: UiConfig): void {
  for (const s of draft.calendars) {
    const match = saved.calendars.find((o) => o.id === s.id && o.type === s.type);
    if (!match) {
      continue;
    }
    if (s.type === 'icloud' && !s.appPassword) {
      s.appPassword = match.appPassword;
    }
    if ((s.type === 'google' || s.type === 'url') && !s.url) {
      s.url = match.url;
    }
  }
}
