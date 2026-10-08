/**
 * Validation (SPEC 11.3 H), mirroring the plugin's own rules of SPEC 9.1 so the host's Save stays disabled while the
 * block would fail them. Each issue carries the field's path for inline marking and the card or section label the
 * summary box shows it under.
 */

import { CALENDARS, COLORS, ICLOUD, GOOGLE, LIGHTS, MICROSOFT, SETTINGS, URL_CARD, VALIDATION } from './copy.js';
import { LIMITS, STATUS_KEYS, type UiConfig, type UiSource } from './model.js';

export interface UiIssue {
  path: string;
  /** `{Card name}` in the summary box: the calendar's name, or the section heading for uncarded fields. */
  label: string;
  message: string;
}

/** What validation needs beyond the configuration: which cards show a list of calendars to tick. */
export interface ValidationContext {
  /** Card ids whose "Calendars to use" rows are shown (after Connect, or saved rows). */
  listsShown?: Set<string>;
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HOST_NAME = /^(?=.{1,253}\.?$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.?$/i;

/** The path of a calendar card's field. */
export function sourcePath(s: UiSource, field: string): string {
  return `calendars.${s.id}.${field}`;
}

/** The card's name as its header shows it. */
export function cardLabel(s: UiSource): string {
  return s.name.trim() || CALENDARS.newCalendar;
}

export function isCalendarAddress(value: string): boolean {
  const v = value.trim();
  if (!/^(https|webcal):\/\//i.test(v)) {
    return false;
  }
  try {
    return new URL(v.replace(/^webcal:/i, 'https:')).hostname.length > 0;
  } catch {
    return false;
  }
}

export function isIPv4(value: string): boolean {
  const parts = value.split('.');
  return parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}

/** An IPv4 address or host name, as the plugin accepts for `lifx.host` (SPEC 9.1 item 6). */
export function isHost(value: string): boolean {
  return isIPv4(value) || (!/^[\d.]+$/.test(value) && HOST_NAME.test(value));
}

export function isColor(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value.trim()) || value.trim().toLowerCase() === 'off';
}

function wholeNumber(value: number, [min, max]: readonly [number, number]): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

function number(issues: UiIssue[], path: string, label: string, title: string, value: number, limits: readonly [number, number]): void {
  if (!Number.isFinite(value)) {
    issues.push({ path, label, message: VALIDATION.required(title) });
  } else if (!wholeNumber(value, limits)) {
    issues.push({ path, label, message: VALIDATION.wholeNumber(limits[0], limits[1]) });
  }
}

function sourceIssues(s: UiSource, all: UiSource[], ctx: ValidationContext, issues: UiIssue[]): void {
  const label = cardLabel(s);
  const add = (field: string, message: string): void => {
    issues.push({ path: sourcePath(s, field), label, message });
  };
  const name = s.name.trim().toLowerCase();
  if (!name) {
    add('name', VALIDATION.required(CALENDARS.name));
  } else if (all.slice(0, all.indexOf(s)).some((o) => o.name.trim().toLowerCase() === name)) {
    add('name', VALIDATION.duplicateName);
  }
  switch (s.type) {
  case 'icloud':
    if (!s.appleId.trim()) {
      add('appleId', VALIDATION.required(ICLOUD.appleId));
    } else if (!EMAIL.test(s.appleId.trim())) {
      add('appleId', VALIDATION.email);
    }
    if (!s.appPassword) {
      add('appPassword', VALIDATION.required(ICLOUD.appPassword));
    }
    break;
  case 'google':
    if (!s.url.trim()) {
      add('url', VALIDATION.required(GOOGLE.secret));
    } else if (!isCalendarAddress(s.url)) {
      add('url', VALIDATION.address);
    }
    if (s.email.trim() && !EMAIL.test(s.email.trim())) {
      add('email', VALIDATION.email);
    }
    break;
  case 'url':
    if (!s.url.trim()) {
      add('url', VALIDATION.required(URL_CARD.address));
    } else if (!isCalendarAddress(s.url)) {
      add('url', VALIDATION.address);
    }
    break;
  case 'microsoft':
    for (const [field, title] of [['tenantId', MICROSOFT.tenantId], ['clientId', MICROSOFT.clientId]] as const) {
      if (!s[field].trim()) {
        add(field, VALIDATION.required(title));
      } else if (!GUID.test(s[field].trim())) {
        add(field, VALIDATION.guid);
      }
    }
    if (!s.useTeamsStatus && !s.useCalendar) {
      add('useCalendar', VALIDATION.microsoftNeither);
    } else if (s.useTeamsStatus && all.slice(0, all.indexOf(s)).some((o) => o.type === 'microsoft' && o.useTeamsStatus)) {
      add('useTeamsStatus', VALIDATION.microsoftTeamsTwice);
    }
    break;
  }
  const listed = s.type === 'icloud' || (s.type === 'microsoft' && s.useCalendar);
  if (listed && ctx.listsShown?.has(s.id) && s.calendars.length === 0) {
    add('calendars', VALIDATION.chooseCalendar);
  }
}

export function validate(config: UiConfig, ctx: ValidationContext = {}): UiIssue[] {
  const issues: UiIssue[] = [];
  for (const s of config.calendars) {
    sourceIssues(s, config.calendars, ctx, issues);
  }
  for (const key of STATUS_KEYS) {
    if (!isColor(config.colors[key])) {
      issues.push({ path: `colors.${key}`, label: COLORS.heading, message: VALIDATION.color });
    }
  }
  if (config.lifx.enabled) {
    number(issues, 'lifx.brightness', LIGHTS.lifxTitle, LIGHTS.brightness, config.lifx.brightness, LIMITS.brightness);
    if (config.lifx.host.trim() && !isHost(config.lifx.host.trim())) {
      issues.push({ path: 'lifx.host', label: LIGHTS.lifxTitle, message: VALIDATION.host });
    }
    number(issues, 'lifx.refreshSeconds', LIGHTS.lifxTitle, LIGHTS.refresh, config.lifx.refreshSeconds, LIMITS.refreshSeconds);
  }
  if (!config.name.trim()) {
    issues.push({ path: 'name', label: SETTINGS.heading, message: VALIDATION.required(SETTINGS.name) });
  }
  number(issues, 'pollSeconds', SETTINGS.heading, SETTINGS.pollSeconds, config.pollSeconds, LIMITS.pollSeconds);
  number(issues, 'calendarSeconds', SETTINGS.heading, SETTINGS.calendarSeconds, config.calendarSeconds, LIMITS.calendarSeconds);
  return issues;
}
