/**
 * Unsaved draft recovery (shell rule M1, SPEC 11.2): once the user has changed something, the platform block is kept
 * in localStorage on every change, without a secret (every secret field emptied); on the next load, a draft that
 * differs from the saved configuration and is less than a day old is offered back through a banner, and a restored
 * source takes its secrets back from the saved configuration. Whatever the stored text holds, `readDraft` empties the
 * secret fields again, so a draft never carries a secret into the page.
 */

import { withoutSecrets } from './model.js';
import { serialOf } from './sections/lights.js';

export const DRAFT_KEY = 'homebridge-busy-light:draft';

/** A draft older than this is ignored and removed. */
export const DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** A draft larger than this is never written, and is discarded on load. */
export const MAX_DRAFT_BYTES = 1024 * 1024;

const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);

export interface Draft {
  savedAt: number;
  config: Record<string, unknown>;
}

function storage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function hasForbiddenKey(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(hasForbiddenKey);
  }
  if (typeof value === 'object' && value !== null) {
    return Object.keys(value).some((k) => FORBIDDEN.has(k) || hasForbiddenKey((value as Record<string, unknown>)[k]));
  }
  return false;
}

/** Writes the draft, without its secrets. */
export function saveDraft(config: Record<string, unknown>, now = Date.now()): void {
  try {
    const text = JSON.stringify({ savedAt: now, config: withoutSecrets(config) } satisfies Draft);
    if (text.length > MAX_DRAFT_BYTES) {
      return;
    }
    storage()?.setItem(DRAFT_KEY, text);
  } catch {
    // Storage full or disabled: the draft is a convenience, never a requirement.
  }
}

export function clearDraft(): void {
  try {
    storage()?.removeItem(DRAFT_KEY);
  } catch {
    // ignore
  }
}

/** The stored draft when it is well formed and younger than a day; anything else is removed and yields undefined. */
export function readDraft(now = Date.now()): Draft | undefined {
  try {
    const text = storage()?.getItem(DRAFT_KEY);
    if (!text) {
      return undefined;
    }
    if (text.length > MAX_DRAFT_BYTES) {
      clearDraft();
      return undefined;
    }
    const parsed = JSON.parse(text) as Partial<Draft>;
    const fresh = typeof parsed.savedAt === 'number' && now - parsed.savedAt >= 0 && now - parsed.savedAt < DRAFT_MAX_AGE_MS;
    if (hasForbiddenKey(parsed) || !fresh || typeof parsed.config !== 'object' || parsed.config === null || Array.isArray(parsed.config)) {
      clearDraft();
      return undefined;
    }
    return { savedAt: parsed.savedAt as number, config: withoutSecrets(parsed.config as Record<string, unknown>) };
  } catch {
    clearDraft();
    return undefined;
  }
}

/** JSON with object keys sorted at every level, so two equal configurations compare equal whatever their key order. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * The block as a draft compares it with the saved configuration (SPEC 11.2 item 12, from build 3.3): without secrets,
 * and with the bulbs as the set of bulbs they name, each a serial number in any form, or a saved name that `names`
 * (serial number to name, from the searches in this visit) gives a serial number for. So a search that finds the saved
 * bulbs, or writes a saved name as its serial number, is not a change.
 */
export function comparableBlock(block: Record<string, unknown>, names: Record<string, string> = {}): string {
  const plain = withoutSecrets(block);
  const lifx = plain.lifx as { bulbs?: unknown } | undefined;
  if (lifx && typeof lifx === 'object' && Array.isArray(lifx.bulbs)) {
    const byName = new Map(Object.entries(names).map(([serial, label]) => [label.trim().toLowerCase(), serial]));
    const bulbs = lifx.bulbs.filter((b): b is string => typeof b === 'string')
      .map((b) => serialOf(b) ?? byName.get(b.trim().toLowerCase()) ?? b.trim().toLowerCase());
    plain.lifx = { ...lifx, bulbs: [...new Set(bulbs)].sort() };
  }
  return stableStringify(plain);
}
