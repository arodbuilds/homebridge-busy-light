/**
 * `busy-light/state.json` (SPEC 10.1): what the plugin is doing, for the CLI `status` command and, from build 2, the
 * settings page. Written atomically. It never holds a token, password, address, or anything about an event beyond
 * the count and the `until` time.
 */
import path from 'node:path';
import { readJson, writeFileAtomic } from './files.js';
import type { Auth, Ended, Via } from './inputs.js';
import type { LightState } from './light.js';
import type { Status } from './model.js';
import type { SourceStateEntry } from './sources.js';
import type { InputStatus } from './status.js';

export interface SignInState {
  id: string;
  verificationUri: string;
  userCode: string;
  expiresAt: string;
}

/** The status input (SPEC 10.1, from build 3). The key is never here. */
export interface StatusInputState {
  enabled: boolean;
  port: number;
  listening: boolean;
  /** Why the port could not be opened, or null. */
  error: string | null;
  /** The instance id of 18.3 item 4, or null before the status input first starts. */
  id: string | null;
  /** The address the plugin last gave senders, the host name or the first IPv4 address (18.11 item 6; from build 3.1). */
  advertised?: string | null;
  /** The last change from one IPv4 address to another (18.11 item 6; from build 3.1). */
  addressChange?: AddressChange | null;
  /** When each status was last reported through the status API, as ISO times (18.7 item 8; from build 3.2). */
  reported?: Partial<Record<InputStatus, string>>;
}

/** A change of the address senders were given (SPEC 18.11 item 6), `at` an ISO time. */
export interface AddressChange {
  from: string;
  to: string;
  at: string;
}

/** A sender of the display list (SPEC 18.7 item 5); the replay table stays in inputs.json. */
export interface InputStateEntry {
  sender: string;
  status: InputStatus;
  app: string | null;
  via: Via;
  /** How its last report authenticated; null for the switch (18.8 item 10). */
  auth: Auth | null;
  lastHeard: string;
  expiresAt: string | null;
  active: boolean;
  /** How it ended once inactive (from build 3.2): `cleared` or `expired`; null while active (10.1 item 8). */
  ended?: Ended | null;
}

export interface StateFile {
  version: 1;
  updatedAt: string;
  status: Status | null;
  /** `app` is there only when a report with an app decided the status (SPEC 6.3 item 5). */
  reason: { source: string | null; until: string | null; app?: string } | null;
  override: boolean;
  sources: SourceStateEntry[];
  signIn: SignInState | null;
  light: LightState;
  /** From build 3; absent in a state file written by build 2. */
  statusInput?: StatusInputState;
  inputs?: InputStateEntry[];
  /** The meeting warning while it is on, the meeting's start as an ISO time (SPEC 6.7, from build 3.2). */
  meetingWarning?: { meetingAt: string } | null;
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
