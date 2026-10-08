import type { StatusKey } from './copy.js';
import type { SourceType, UiConfig } from './model.js';
import type { UiIssue } from './validate.js';

export type Section = 'rightNow' | 'calendars' | 'colors' | 'lights' | 'settings';

export type SourceState = 'checking' | 'connected' | 'signInNeeded' | 'notReachable';

/** A source as the state file reports it (SPEC 10.1). */
export interface StatusSource {
  id: string;
  name: string;
  type: SourceType;
  state: SourceState;
  lastChecked: string | null;
  events: number | null;
  error: string | null;
  help?: string;
}

/** The state file of SPEC 10.1, as /status returns it. */
export interface StatusData {
  version: 1;
  updatedAt: string;
  status: StatusKey | 'unknown' | null;
  reason: { source: string | null; until: string | null } | null;
  override: boolean;
  sources: StatusSource[];
  signIn: unknown;
  light: { enabled: boolean; label: string | null; host: string | null; found: string | null } | null;
}

/** An iCloud calendar as /icloud/calendars lists it. */
export interface ICloudListed {
  id: string;
  name: string;
  shared: boolean;
  subscribed: boolean;
  eventsToday: number | null;
}

/** A Microsoft calendar as /microsoft/calendars lists it. */
export interface MicrosoftListed {
  id: string;
  name: string;
  isDefault: boolean;
  shared: boolean;
  eventsToday: number | null;
}

export type ICloudError = 'rejected' | 'network' | 'unexpected';

/** What an iCloud or Microsoft card holds beyond the configuration: the list from Connect, and every id ever ticked. */
export interface ListState {
  busy: boolean;
  /** The calendars from the last Connect on this page load, or null before one. */
  listed: Array<ICloudListed | MicrosoftListed> | null;
  /** Ids ticked at any time on this page, so the New badge leaves a calendar once it has been ticked. */
  tickedBefore: Set<string>;
  error: ICloudError | 'signInAgain' | null;
}

export type TestResult =
  | { eventsToday: number }
  | { error: 'insecure' | 'notCalendar' | 'http' | 'network' | 'tooLarge'; host: string; code?: number };

/** The Microsoft code view (SPEC 11.3 C), which replaces the card body while a code waits. */
export interface MicrosoftFlow {
  verificationUri: string;
  userCode: string;
  copied: boolean;
}

/** How the last Connect ended when it did not sign in: the card shows it under its body. */
export type MicrosoftEnding = { kind: 'expired' } | { kind: 'refused'; reason: string; help: string } | { kind: 'network' };

export interface MicrosoftState extends ListState {
  /** Signed in on this page, or so the state file says; null before either says. */
  connected: boolean | null;
  flow: MicrosoftFlow | null;
  ending: MicrosoftEnding | null;
  disconnectOpen: boolean;
  /** What the busy Connect button reads: getting a code, or listing the calendars of a source already signed in. */
  busyLabel: string | null;
}

export interface LifxBulb {
  label: string;
  serial: string;
  ip: string;
}

export interface LifxState {
  searching: boolean;
  /** The bulbs from the last search on this page load, or null before one. */
  bulbs: LifxBulb[] | null;
  testing: boolean;
  answered: boolean | null;
}

/** What the page draws beyond the configuration and /status. A redraw keeps all of it. */
export interface UiState {
  chooserOpen: boolean;
  /** Calendar cards drawn open. A new card opens expanded; saved cards start closed. */
  expanded: Set<string>;
  /** The card whose Remove question is open. */
  removeOpen: string | null;
  icloud: Map<string, ListState>;
  tests: Map<string, { busy: boolean; result: TestResult | null }>;
  microsoft: Map<string, MicrosoftState>;
  lifx: LifxState;
  resetOpen: boolean;
  /** Reset was confirmed: the done state stands where the dialog was until a reload. */
  resetDone: boolean;
  issuesExpanded: boolean;
}

/** What a section needs from the page. */
export interface App {
  config: UiConfig;
  /** The configuration as it was loaded: what the running plugin uses (after a restart) and what Save last wrote. */
  readonly saved: UiConfig;
  /** The state file; null when the plugin has not written one, undefined before the first answer. */
  status: StatusData | null | undefined;
  readonly ui: UiState;
  /** A value changed: push the block to the host, keep the draft and revalidate. */
  changed(): void;
  /** Redraw one section. */
  rerender(section: Section): void;
  /** Marks a field touched so its error shows inline, and redraws the inline messages. */
  touch(path: string): void;
  untouch(path: string): void;
  issues(): UiIssue[];
  /** Ask the server for /status now. */
  refreshStatus(): Promise<void>;
  /** Replace the configuration (Reset, Restore) and redraw everything; `draft: false` deletes the draft and writes none. */
  replaceConfig(config: UiConfig, opts?: { draft?: boolean }): void;
  /** Ask a field to take focus once the section is drawn (a new card's Name). */
  focusLater(path: string): void;
}
