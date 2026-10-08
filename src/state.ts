/**
 * `busy-light/state.json` (SPEC 10.1): what the plugin is doing, for the CLI `status` command and, from build 2, the
 * settings page. Written atomically. It never holds a token, password, address, or anything about an event beyond
 * the count and the `until` time.
 */
import path from 'node:path';
import { readJson, writeFileAtomic } from './files.js';
import type { LightState } from './light.js';
import type { Status } from './model.js';
import type { SourceStateEntry } from './sources.js';

export interface SignInState {
  id: string;
  verificationUri: string;
  userCode: string;
  expiresAt: string;
}

export interface StateFile {
  version: 1;
  updatedAt: string;
  status: Status | null;
  reason: { source: string | null; until: string | null } | null;
  override: boolean;
  sources: SourceStateEntry[];
  signIn: SignInState | null;
  light: LightState;
}

export function stateFile(storageDir: string): string {
  return path.join(storageDir, 'state.json');
}

export function writeState(storageDir: string, state: StateFile): void {
  writeFileAtomic(stateFile(storageDir), `${JSON.stringify(state, null, 2)}\n`, 0o600);
}

export function readState(storageDir: string): StateFile | null {
  const raw = readJson(stateFile(storageDir)) as StateFile | null;
  return raw && raw.version === 1 ? raw : null;
}
