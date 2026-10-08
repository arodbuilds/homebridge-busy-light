/**
 * Validation of the Settings disclosure (SPEC section 11.3 E), mirroring config.schema.json so the host's Save
 * stays disabled while the file would fail its own checks. Each issue carries the field path for inline marking.
 */

import { SETTINGS, SHELL } from './copy.js';
import { DEFAULTS, type UiConfig } from './model.js';

export interface UiIssue {
  path: string;
  message: string;
}

export const HHMM_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** True for a finite number with at most one decimal place (12, 12.0 and 11.8; not 12.05). */
export function hasOneDecimal(value: number): boolean {
  return Number.isFinite(value) && Math.round(value * 10) / 10 === value;
}

export function validate(config: UiConfig): UiIssue[] {
  const issues: UiIssue[] = [];
  if (!config.name.trim()) {
    issues.push({ path: 'name', message: SHELL.required(SETTINGS.name) });
  }
  if (!Number.isFinite(config.pollIdleMinutes)) {
    issues.push({ path: 'pollIdleMinutes', message: SHELL.required(SETTINGS.pollIdle) });
  } else if (config.pollIdleMinutes < DEFAULTS.pollIdleMinutesMin) {
    issues.push({ path: 'pollIdleMinutes', message: SETTINGS.pollIdleError });
  }
  if (!Number.isFinite(config.pollActiveSeconds)) {
    issues.push({ path: 'pollActiveSeconds', message: SHELL.required(SETTINGS.pollActive) });
  } else if (config.pollActiveSeconds < DEFAULTS.pollActiveSecondsMin) {
    issues.push({ path: 'pollActiveSeconds', message: SETTINGS.pollActiveError });
  }
  if (!Number.isFinite(config.batteryLowVoltage)) {
    issues.push({ path: 'batteryLowVoltage', message: SHELL.required(SETTINGS.batteryLow) });
  } else if (!hasOneDecimal(config.batteryLowVoltage)) {
    issues.push({ path: 'batteryLowVoltage', message: SETTINGS.batteryLowError });
  }
  if (config.exerciseTime.trim() && !HHMM_PATTERN.test(config.exerciseTime.trim())) {
    issues.push({ path: 'exerciseTime', message: SETTINGS.exerciseTimeError });
  }
  if (!Number.isFinite(config.exerciseHoldMinutes)) {
    issues.push({ path: 'exerciseHoldMinutes', message: SHELL.required(SETTINGS.exerciseHold) });
  } else if (config.exerciseHoldMinutes < DEFAULTS.exerciseHoldMinutesMin) {
    issues.push({ path: 'exerciseHoldMinutes', message: SETTINGS.exerciseHoldError });
  }
  return issues;
}
