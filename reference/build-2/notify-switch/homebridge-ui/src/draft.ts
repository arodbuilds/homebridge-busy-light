/**
 * Unsaved draft recovery (SPEC section 11.2, item 23). Once the user has changed something, the in-progress
 * platform block is written to localStorage on every change, without its credentials (every secret field
 * emptied, as in a backup without credentials); on the next load, a draft that differs from the saved
 * configuration and is less than a day old is offered back through a banner, and a restored provider takes
 * its credentials back from the saved configuration. The key carries the plugin name so it cannot collide
 * with another plugin's settings page on the same origin. A draft over `MAX_BACKUP_BYTES` is never written
 * and is discarded on load, and so is one holding a `__proto__`, `constructor` or `prototype` key at any
 * level (SPEC section 12, item 12). Whatever the stored text holds, `readDraft` empties the secret fields
 * again, so a draft never carries a credential into the page.
 */

import { findForbiddenKey } from '../../src/safeKeys.js';
import { blockWithoutCredentials, MAX_BACKUP_BYTES } from './model.js';

export const DRAFT_KEY = 'homebridge-notify-switch:draft';

/** A draft older than this is ignored and removed. */
export const DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

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

/** The block with every secret field emptied and without the `credentialsRemoved` marker, which is not a platform field. */
function structureOnly(config: Record<string, unknown>): Record<string, unknown> {
  const out = blockWithoutCredentials(config);
  delete out.credentialsRemoved;
  return out;
}

/** Writes the draft. `config` is the platform block without credentials (`exportConfigWithoutCredentials`); the secrets are emptied again here in any case. */
export function saveDraft(config: Record<string, unknown>, now = Date.now()): void {
  try {
    const text = JSON.stringify({ savedAt: now, config: structureOnly(config) } satisfies Draft);
    if (text.length > MAX_BACKUP_BYTES) {
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
    if (text.length > MAX_BACKUP_BYTES) {
      clearDraft();
      return undefined;
    }
    const parsed = JSON.parse(text) as Partial<Draft>;
    if (findForbiddenKey(parsed) !== undefined) {
      clearDraft();
      return undefined;
    }
    const fresh = typeof parsed.savedAt === 'number' && now - parsed.savedAt >= 0 && now - parsed.savedAt < DRAFT_MAX_AGE_MS;
    if (!fresh || typeof parsed.config !== 'object' || parsed.config === null || Array.isArray(parsed.config)) {
      clearDraft();
      return undefined;
    }
    return { savedAt: parsed.savedAt as number, config: structureOnly(parsed.config as Record<string, unknown>) };
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
