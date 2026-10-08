import type { UiConfig } from './model.js';
import type { UiIssue } from './validate.js';

export type Section = 'account' | 'generators' | 'settings';

/** The account as /status reports it (SPEC section 10). */
export type AccountState = 'not_connected' | 'checking' | 'connected' | 'reconnect_needed';

export interface StatusAccount {
  state: AccountState;
  email?: string;
  lastChecked?: string;
}

/** A generator as state.json carries it (the platform's GeneratorState with ISO dates). */
export interface UiGenerator {
  id: number;
  name: string;
  serial: string;
  model: string;
  status: number;
  statusLabel: string;
  statusText: string;
  running: boolean;
  exercising: boolean;
  connected: boolean;
  fault: boolean;
  faultReasons: string[];
  maintenanceDue: boolean;
  batteryVoltage: number | null;
  engineHours: number | null;
  hoursOfProtection: number | null;
  exerciseTime: string | null;
  exerciseTimeFromApi: string | null;
  lastExerciseAt: string | null;
  fuelType: string | null;
  /** Tank level on propane units: not reported (propane support is on hold, SPEC section 2.2), so the Fuel row stays hidden. */
  fuelPercent?: number | null;
  outdoorTempF: number | null;
  lastSeen: string | null;
}

export interface StatusData {
  account: StatusAccount;
  generators: UiGenerator[];
  others: Array<{ type: number; name: string }>;
  version?: string;
}

/** The Connect flow's step (SPEC section 11.3 C), kept while the card is replaced in place. */
export type ConnectFlow =
  | { step: 'credentials'; email: string; password: string; error: 'wrong_password' | 'unknown_email' | 'network' | null; busy: boolean }
  | { step: 'code'; method: 'sms' | 'otp' | 'email'; email: string; code: string; error: 'wrong_code' | 'too_many' | 'expired' | null; busy: boolean }
  | { step: 'unsupported' };

/**
 * What the page draws beyond config and /status. The account card is redrawn from every /status response
 * unless the Connect flow is in progress; the Disconnect question lives here so a redraw keeps it open. The
 * generator cards are not redrawn while a Rename editor is open.
 */
export interface UiState {
  flow: ConnectFlow | null;
  disconnectOpen: boolean;
  /** The Reset dialog is open under the Reset link. */
  resetOpen: boolean;
  /** Reset was confirmed: the done state stands where the dialog was and the Reset link stays hidden until a reload. */
  resetDone: boolean;
  rename: { id: number; value: string } | null;
  /** When the Checking state began (the code step succeeded, or the page first saw it), for the card's second line. */
  checkingSince: number | null;
}

/** What a section needs from the page. */
export interface App {
  config: UiConfig;
  status: StatusData | null;
  readonly ui: UiState;
  /** A value changed: push the block to the host and revalidate. */
  changed(): void;
  /** Redraw one section. */
  rerender(section: Section): void;
  /** Marks a field touched so its error shows inline, and redraws the inline messages. */
  touch(path: string): void;
  /** Forgets a field's touched state (a code field emptied after a rejected code starts fresh). */
  untouch(path: string): void;
  /** The current issues, for a section that gates its own controls. */
  issues(): UiIssue[];
  /** Ask the server for /status now (after Connect, Disconnect or a code). */
  refreshStatus(): Promise<void>;
  /** Replace the configuration (Reset) and redraw everything. */
  replaceConfig(config: UiConfig): void;
}
