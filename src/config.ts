/**
 * The platform block of config.json: types, defaults and validation (SPEC section 9).
 *
 * Validation never throws and never stops Homebridge. An invalid calendar source is skipped with one error naming
 * the field; an invalid scalar falls back to its default with one warning. The caller logs each issue as
 * `{path}: {message}` (SPEC section 12). Messages never contain a secret or a calendar address.
 */
import { DEFAULT_COLORS, DEFAULT_SENSORS, SENSOR_KEYS, isSensorKey, isStatusKey } from './model.js';
import type { SensorKey, StatusKey } from './model.js';

export type SourceType = 'icloud' | 'google' | 'microsoft' | 'url';

export const SOURCE_TYPES: readonly SourceType[] = ['icloud', 'google', 'microsoft', 'url'];

export const SOURCE_TYPE_NAMES: Record<SourceType, string> = {
  icloud: 'iCloud',
  google: 'Google Calendar',
  microsoft: 'Microsoft 365',
  url: 'Calendar URL',
};

/** What a calendar counts for (SPEC 9.1 item 15): every event, or its out of office events only. */
export type CalendarUse = 'all' | 'outOfOffice';

export const CALENDAR_USES: readonly CalendarUse[] = ['all', 'outOfOffice'];

/** One item of an iCloud or Microsoft `calendars` list (SPEC 9.1 items 13 and 14). */
export interface CalendarChoice {
  /** The CalDAV collection path or the Graph calendar id. Null for a build 1 item that names the calendar only. */
  id: string | null;
  /** The display name when it was ticked. Empty when only the id was given. */
  name: string;
  use: CalendarUse;
}

interface SourceBase {
  /** Names the Microsoft token file and identifies the source in the state file. */
  id: string;
  name: string;
}

export interface ICloudSourceConfig extends SourceBase {
  type: 'icloud';
  appleId: string;
  appPassword: string;
  /** The calendars to read. Empty keeps every calendar. */
  calendars: CalendarChoice[];
}

export interface GoogleSourceConfig extends SourceBase {
  type: 'google';
  /** Always `https://` (a `webcal://` address is rewritten). */
  url: string;
  email: string;
  use: CalendarUse;
}

export interface MicrosoftSourceConfig extends SourceBase {
  type: 'microsoft';
  tenantId: string;
  clientId: string;
  useTeamsStatus: boolean;
  useCalendar: boolean;
  /** The Outlook calendars to read, each with an id. Empty reads the default calendar only. */
  calendars: CalendarChoice[];
}

export interface UrlSourceConfig extends SourceBase {
  type: 'url';
  /** Always `https://` (a `webcal://` address is rewritten). */
  url: string;
  use: CalendarUse;
}

export type SourceConfig = ICloudSourceConfig | GoogleSourceConfig | MicrosoftSourceConfig | UrlSourceConfig;

export interface LifxConfig {
  enabled: boolean;
  /** A bulb's name as shown in the LIFX app, or its serial number. Empty when not set. */
  bulb: string;
  /** An IPv4 address or host name. Empty when not set. */
  host: string;
  /** 1 to 100. */
  brightness: number;
  /** 0 sends only on a status change. */
  refreshSeconds: number;
}

export interface BusyLightConfig {
  name: string;
  calendars: SourceConfig[];
  /** `#RRGGBB` in upper case, or `off`. */
  colors: Record<StatusKey, string>;
  lifx: LifxConfig;
  sensors: SensorKey[];
  overrideSwitch: boolean;
  pollSeconds: number;
  calendarSeconds: number;
  ignoreAllDayBusy: boolean;
  outOfOfficeWords: string[];
  debug: boolean;
}

export interface ConfigIssue {
  level: 'error' | 'warn';
  path: string;
  message: string;
}

export const DEFAULT_NAME = 'Busy Light';
export const DEFAULT_OUT_OF_OFFICE_WORDS: readonly string[] = ['Out of office', 'OOO', 'Vacation', 'PTO'];
export const MIN_POLL_SECONDS = 15;
/** Below the 5 minutes presence stays fresh (SPEC 6.5), so a status resolved between ticks still has it. */
export const MAX_POLL_SECONDS = 240;
export const MIN_CALENDAR_SECONDS = 60;
/** A day: well inside what a timer can hold. */
export const MAX_REFRESH_SECONDS = 86_400;
/** Below the 15 minutes events stay fresh (SPEC 6.5), so one slow or failed reload does not drop them. */
export const MAX_CALENDAR_SECONDS = 600;

export function defaultConfig(): BusyLightConfig {
  return {
    name: DEFAULT_NAME,
    calendars: [],
    colors: { ...DEFAULT_COLORS },
    lifx: { enabled: false, bulb: '', host: '', brightness: 100, refreshSeconds: 300 },
    sensors: [...DEFAULT_SENSORS],
    overrideSwitch: false,
    pollSeconds: 30,
    calendarSeconds: 180,
    ignoreAllDayBusy: true,
    outOfOfficeWords: [...DEFAULT_OUT_OF_OFFICE_WORDS],
    debug: false,
  };
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLOR = /^#[0-9a-f]{6}$/i;
const EXPLICIT_ID = /^[a-z0-9-]{1,64}$/;
const HOST_NAME = /^(?=.{1,253}\.?$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.?$/i;

/** A Microsoft tenant or client ID. */
export function isGuid(value: string): boolean {
  return GUID.test(value);
}

/** An explicit source id: 1 to 64 lower case letters, digits and hyphens (SPEC 9.1 item 9). It names the token file. */
export function isSourceId(value: string): boolean {
  return EXPLICIT_ID.test(value);
}

/** The id derived from a name: lower case, every run of characters outside a-z0-9 replaced by a hyphen. */
export function deriveId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

/** `#RRGGBB` (any case) or `off` (any case), normalized; null when neither. */
export function normalizeColor(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const v = value.trim();
  if (v.toLowerCase() === 'off') {
    return 'off';
  }
  return COLOR.test(v) ? v.toUpperCase() : null;
}

export function isIPv4(value: string): boolean {
  const parts = value.split('.');
  return parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}

export function isHost(value: string): boolean {
  return isIPv4(value) || (!/^[\d.]+$/.test(value) && HOST_NAME.test(value));
}

/**
 * `https://` stays, `webcal://` becomes `https://`. Anything else (including `http://`) is null. The host must be
 * present.
 */
export function normalizeCalendarUrl(value: string): string | null {
  const v = value.trim();
  let candidate: string;
  if (/^https:\/\//i.test(v)) {
    candidate = v;
  } else if (/^webcal:\/\//i.test(v)) {
    candidate = `https://${v.slice('webcal://'.length)}`;
  } else {
    return null;
  }
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' && url.hostname ? url.toString() : null;
  } catch {
    return null;
  }
}

/** True when the text holds a control character (C0, DEL or C1). */
function hasControl(value: string): boolean {
  return [...value].some((ch) => {
    const code = ch.codePointAt(0) ?? 0;
    return code < 0x20 || (code >= 0x7f && code <= 0x9f);
  });
}

function isMissing(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

class Issues {
  readonly list: ConfigIssue[] = [];

  error(path: string, message: string): void {
    this.list.push({ level: 'error', path, message });
  }

  warn(path: string, message: string): void {
    this.list.push({ level: 'warn', path, message });
  }
}

function readBoolean(raw: unknown, path: string, fallback: boolean, issues: Issues): boolean {
  if (isMissing(raw)) {
    return fallback;
  }
  if (typeof raw !== 'boolean') {
    issues.warn(path, 'must be true or false');
    return fallback;
  }
  return raw;
}

function readInteger(raw: unknown, path: string, fallback: number, min: number, max: number, message: string, issues: Issues): number {
  if (isMissing(raw)) {
    return fallback;
  }
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < min || raw > max) {
    issues.warn(path, message);
    return fallback;
  }
  return raw;
}

function readText(raw: unknown, path: string, fallback: string, issues: Issues): string {
  if (isMissing(raw)) {
    return fallback;
  }
  if (typeof raw !== 'string') {
    issues.warn(path, 'must be text');
    return fallback;
  }
  return raw.trim();
}

/** A list of non-empty strings. Blank entries are dropped; anything that is not text is ignored with a warning. */
function readTextList(raw: unknown, path: string, fallback: readonly string[], issues: Issues): string[] {
  if (isMissing(raw)) {
    return [...fallback];
  }
  if (!Array.isArray(raw)) {
    issues.warn(path, 'must be a list');
    return [...fallback];
  }
  const out: string[] = [];
  raw.forEach((item, i) => {
    if (typeof item !== 'string') {
      issues.warn(`${path}[${i}]`, 'must be text, ignored');
    } else if (item.trim()) {
      out.push(item.trim());
    }
  });
  return out;
}

/** `all` or `outOfOffice`; anything else is `all` with a warning (SPEC 9.1 item 15). */
function readUse(raw: unknown, path: string, issues: Issues): CalendarUse {
  if (isMissing(raw)) {
    return 'all';
  }
  if (typeof raw !== 'string' || !(CALENDAR_USES as readonly string[]).includes(raw)) {
    issues.warn(path, 'must be all or outOfOffice');
    return 'all';
  }
  return raw as CalendarUse;
}

/** Trimmed text, or null when missing, empty or not text. */
function optionalText(raw: unknown): string | null {
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

/**
 * An iCloud or Microsoft `calendars` list (SPEC 9.1 items 13, 14 and 16). A text item is a calendar name, as build 1
 * wrote them; an object item is `{ id, name, use }`. An item with neither an id nor a name is ignored with a warning,
 * and so is a repeated id. With `requireId` (Microsoft), an item without an id cannot be read and is ignored too.
 */
function readCalendarChoices(raw: unknown, path: string, requireId: boolean, issues: Issues): CalendarChoice[] {
  if (isMissing(raw)) {
    return [];
  }
  if (!Array.isArray(raw)) {
    issues.warn(path, 'must be a list');
    return [];
  }
  const out: CalendarChoice[] = [];
  raw.forEach((item, i) => {
    const itemPath = `${path}[${i}]`;
    let choice: CalendarChoice | null = null;
    if (typeof item === 'string') {
      choice = item.trim() ? { id: null, name: item.trim(), use: 'all' } : null;
    } else if (isObject(item)) {
      const id = optionalText(item.id);
      const name = optionalText(item.name);
      const use = readUse(item.use, `${itemPath}.use`, issues);
      choice = id !== null || name !== null ? { id, name: name ?? '', use } : null;
    }
    if (!choice || (requireId && choice.id === null)) {
      issues.warn(itemPath, 'must be a calendar name or entry, ignored');
      return;
    }
    if (choice.id !== null && out.some((c) => c.id === choice.id)) {
      issues.warn(itemPath, 'repeats an earlier calendar, ignored');
      return;
    }
    out.push(choice);
  });
  return out;
}

function requireText(raw: unknown, path: string, issues: Issues): string | null {
  if (isMissing(raw)) {
    issues.error(path, 'is required');
    return null;
  }
  if (typeof raw !== 'string') {
    issues.error(path, 'must be text');
    return null;
  }
  return raw.trim();
}

function requireGuid(raw: unknown, path: string, issues: Issues): string | null {
  const v = requireText(raw, path, issues);
  if (v === null) {
    return null;
  }
  if (!GUID.test(v)) {
    issues.error(path, 'must be a GUID such as 00000000-0000-0000-0000-000000000000');
    return null;
  }
  return v.toLowerCase();
}

function requireCalendarUrl(raw: unknown, path: string, issues: Issues): string | null {
  const v = requireText(raw, path, issues);
  if (v === null) {
    return null;
  }
  const url = normalizeCalendarUrl(v);
  if (!url) {
    issues.error(path, 'must start with https:// or webcal://');
    return null;
  }
  return url;
}

function readSource(raw: unknown, path: string, issues: Issues): SourceConfig | null {
  if (!isObject(raw)) {
    issues.error(path, 'must be a calendar entry');
    return null;
  }
  const name = requireText(raw.name, `${path}.name`, issues);
  if (name === null) {
    return null;
  }
  if (name.length === 0 || [...name].length > 64 || hasControl(name)) {
    issues.error(`${path}.name`, 'must be 1 to 64 printable characters');
    return null;
  }
  let id: string;
  if (isMissing(raw.id)) {
    id = deriveId(name);
  } else if (typeof raw.id === 'string' && EXPLICIT_ID.test(raw.id.trim())) {
    id = raw.id.trim();
  } else {
    issues.error(`${path}.id`, 'must be 1 to 64 lower case letters, digits and hyphens');
    return null;
  }
  const type = raw.type;
  if (typeof type !== 'string' || !(SOURCE_TYPES as readonly string[]).includes(type)) {
    issues.error(`${path}.type`, 'must be icloud, google, microsoft or url');
    return null;
  }
  switch (type as SourceType) {
  case 'icloud': {
    const appleId = requireText(raw.appleId, `${path}.appleId`, issues);
    if (appleId === null) {
      return null;
    }
    const appPassword = requireText(raw.appPassword, `${path}.appPassword`, issues);
    if (appPassword === null) {
      return null;
    }
    const calendars = readCalendarChoices(raw.calendars, `${path}.calendars`, false, issues);
    return { type: 'icloud', id, name, appleId, appPassword, calendars };
  }
  case 'google': {
    const url = requireCalendarUrl(raw.url, `${path}.url`, issues);
    if (url === null) {
      return null;
    }
    const email = readText(raw.email, `${path}.email`, '', issues);
    const use = readUse(raw.use, `${path}.use`, issues);
    return { type: 'google', id, name, url, email, use };
  }
  case 'url': {
    const url = requireCalendarUrl(raw.url, `${path}.url`, issues);
    if (url === null) {
      return null;
    }
    const use = readUse(raw.use, `${path}.use`, issues);
    return { type: 'url', id, name, url, use };
  }
  case 'microsoft': {
    const tenantId = requireGuid(raw.tenantId, `${path}.tenantId`, issues);
    if (tenantId === null) {
      return null;
    }
    const clientId = requireGuid(raw.clientId, `${path}.clientId`, issues);
    if (clientId === null) {
      return null;
    }
    const useTeamsStatus = readBoolean(raw.useTeamsStatus, `${path}.useTeamsStatus`, true, issues);
    const useCalendar = readBoolean(raw.useCalendar, `${path}.useCalendar`, true, issues);
    if (!useTeamsStatus && !useCalendar) {
      issues.error(`${path}.useCalendar`, 'Use Teams status and Use Outlook calendar cannot both be off');
      return null;
    }
    // Read whether or not the calendar is used, so the list survives turning Use Outlook calendars off and on.
    const calendars = readCalendarChoices(raw.calendars, `${path}.calendars`, true, issues);
    return { type: 'microsoft', id, name, tenantId, clientId, useTeamsStatus, useCalendar, calendars };
  }
  }
}

function readSources(raw: unknown, issues: Issues): SourceConfig[] {
  if (isMissing(raw)) {
    return [];
  }
  if (!Array.isArray(raw)) {
    issues.warn('calendars', 'must be a list');
    return [];
  }
  const out: SourceConfig[] = [];
  raw.forEach((item, i) => {
    const path = `calendars[${i}]`;
    const source = readSource(item, path, issues);
    if (!source) {
      return;
    }
    if (out.some((s) => s.name.toLowerCase() === source.name.toLowerCase())) {
      issues.error(`${path}.name`, 'must be unique');
      return;
    }
    if (out.some((s) => s.id === source.id)) {
      issues.error(`${path}.id`, `${source.id} is already used by another calendar`);
      return;
    }
    if (source.type === 'microsoft' && source.useTeamsStatus && out.some((s) => s.type === 'microsoft' && s.useTeamsStatus)) {
      issues.error(`${path}.useTeamsStatus`, 'only one Microsoft 365 calendar can use Teams status');
      return;
    }
    out.push(source);
  });
  return out;
}

function readColors(raw: unknown, issues: Issues): Record<StatusKey, string> {
  const colors = { ...DEFAULT_COLORS };
  if (isMissing(raw)) {
    return colors;
  }
  if (!isObject(raw)) {
    issues.warn('colors', 'must be a set of colors');
    return colors;
  }
  for (const [key, value] of Object.entries(raw)) {
    if (!isStatusKey(key)) {
      issues.warn(`colors.${key}`, 'is not a status, ignored');
      continue;
    }
    if (isMissing(value)) {
      continue;
    }
    const color = normalizeColor(value);
    if (color === null) {
      issues.warn(`colors.${key}`, 'must be #RRGGBB or off');
      continue;
    }
    colors[key] = color;
  }
  return colors;
}

function readLifx(raw: unknown, issues: Issues): LifxConfig {
  const lifx = defaultConfig().lifx;
  if (isMissing(raw)) {
    return lifx;
  }
  if (!isObject(raw)) {
    issues.warn('lifx', 'must be a set of LIFX settings');
    return lifx;
  }
  lifx.enabled = readBoolean(raw.enabled, 'lifx.enabled', lifx.enabled, issues);
  lifx.bulb = readText(raw.bulb, 'lifx.bulb', '', issues);
  const host = readText(raw.host, 'lifx.host', '', issues);
  if (host && !isHost(host)) {
    issues.warn('lifx.host', 'must be an IPv4 address or host name');
  } else {
    lifx.host = host;
  }
  lifx.brightness = readInteger(raw.brightness, 'lifx.brightness', lifx.brightness, 1, 100, 'must be a whole number from 1 to 100', issues);
  lifx.refreshSeconds = readInteger(raw.refreshSeconds, 'lifx.refreshSeconds', lifx.refreshSeconds, 0, MAX_REFRESH_SECONDS,
    `must be a whole number from 0 to ${MAX_REFRESH_SECONDS}`, issues);
  return lifx;
}

function readSensors(raw: unknown, issues: Issues): SensorKey[] {
  if (isMissing(raw)) {
    return [...DEFAULT_SENSORS];
  }
  if (!Array.isArray(raw)) {
    issues.warn('sensors', 'must be a list');
    return [...DEFAULT_SENSORS];
  }
  const wanted = new Set<SensorKey>();
  raw.forEach((item, i) => {
    if (isSensorKey(item)) {
      wanted.add(item);
    } else {
      issues.warn(`sensors[${i}]`, 'is not a sensor, ignored');
    }
  });
  return SENSOR_KEYS.filter((k) => wanted.has(k));
}

/** Reads the platform block. Never throws. */
export function parseConfig(raw: unknown): { config: BusyLightConfig; issues: ConfigIssue[] } {
  const issues = new Issues();
  const config = defaultConfig();
  const block: Record<string, unknown> = isObject(raw) ? raw : {};
  config.name = readText(block.name, 'name', DEFAULT_NAME, issues) || DEFAULT_NAME;
  config.calendars = readSources(block.calendars, issues);
  config.colors = readColors(block.colors, issues);
  config.lifx = readLifx(block.lifx, issues);
  config.sensors = readSensors(block.sensors, issues);
  config.overrideSwitch = readBoolean(block.overrideSwitch, 'overrideSwitch', config.overrideSwitch, issues);
  config.pollSeconds = readInteger(block.pollSeconds, 'pollSeconds', config.pollSeconds, MIN_POLL_SECONDS, MAX_POLL_SECONDS,
    `must be a whole number from ${MIN_POLL_SECONDS} to ${MAX_POLL_SECONDS}`, issues);
  config.calendarSeconds = readInteger(block.calendarSeconds, 'calendarSeconds', config.calendarSeconds, MIN_CALENDAR_SECONDS,
    MAX_CALENDAR_SECONDS, `must be a whole number from ${MIN_CALENDAR_SECONDS} to ${MAX_CALENDAR_SECONDS}`, issues);
  config.ignoreAllDayBusy = readBoolean(block.ignoreAllDayBusy, 'ignoreAllDayBusy', config.ignoreAllDayBusy, issues);
  config.outOfOfficeWords = readTextList(block.outOfOfficeWords, 'outOfOfficeWords', DEFAULT_OUT_OF_OFFICE_WORDS, issues);
  config.debug = readBoolean(block.debug, 'debug', config.debug, issues);
  return { config, issues: issues.list };
}

/** Every owner address the declined-invitation rule (SPEC 6.4 rule 2) looks for: iCloud Apple IDs and Google emails. */
export function ownerAddresses(config: BusyLightConfig): string[] {
  const out = new Set<string>();
  for (const s of config.calendars) {
    if (s.type === 'icloud' && s.appleId) {
      out.add(s.appleId.toLowerCase());
    } else if (s.type === 'google' && s.email) {
      out.add(s.email.toLowerCase());
    }
  }
  return [...out];
}
