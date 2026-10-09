import type { StatusKey } from './copy.js';
import type { SourceType, UiConfig } from './model.js';
import type { UiIssue } from './validate.js';

export type Section = 'rightNow' | 'calendars' | 'statusInput' | 'colors' | 'lights' | 'settings';

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

/** A sender of the state file's `inputs` (SPEC 10.1, 18.7 item 5). */
export interface StatusInputEntry {
  sender: string;
  status: StatusKey;
  app: string | null;
  via: 'api' | 'switch';
  auth: 'signed' | 'plain' | null;
  lastHeard: string;
  expiresAt: string | null;
  active: boolean;
}

/** The state file of SPEC 10.1, as /status returns it. The build 3 fields are absent in a build 2 state file. */
export interface StatusData {
  version: 1;
  updatedAt: string;
  /** `notWorking` while the Working switch is off (SPEC 6.6, from build 3.2). */
  status: StatusKey | 'unknown' | 'notWorking' | null;
  reason: { source: string | null; until: string | null; app?: string } | null;
  override: boolean;
  sources: StatusSource[];
  signIn: unknown;
  light: { enabled: boolean; label: string | null; host: string | null; found: string | null; answered?: boolean | null } | null;
  /** `reported` (from build 3.2): when each status was last reported through the status API (SPEC 18.7 item 8). */
  statusInput?: { enabled: boolean; port: number; listening: boolean; error: string | null; id: string | null; reported?: Partial<Record<StatusKey, string>> };
  inputs?: StatusInputEntry[];
  /** The meeting warning while it is on (SPEC 6.7, from build 3.2). */
  meetingWarning?: { meetingAt: string } | null;
}

/** What /input/info answers (SPEC 10.3). */
export interface InputInfo {
  hostname: string | null;
  addresses: string[];
  port: number;
  id: string;
  /** The address senders were given changed, and the page has not been saved since (SPEC 18.11 item 6). */
  addressChange?: { from: string; to: string } | null;
}

/** The status input section's own state (SPEC 11.3 I). */
export interface InputUiState {
  info: InputInfo | null;
  loading: boolean;
  /** /input/info gave no answer; it is asked again when the checkbox is ticked. */
  failed: boolean;
  testing: boolean;
  result: { kind: 'received' | 'notListening' | 'unauthorized' | 'other'; message: string } | null;
  copied: 'key' | 'code' | null;
  replaceOpen: boolean;
  /** Show was pressed: the key and the setup code are both shown, until Hide (SPEC 11.3 I). */
  revealed: boolean;
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
  /** The chooser shows the two Outlook or Microsoft 365 options (SPEC 11.3 C, from build 3.1). */
  chooserOutlook: boolean;
  /** Calendar URL cards added as a published Outlook link on this page: their steps show open (11.3 C). */
  outlookCards: Set<string>;
  /** Calendar cards drawn open. A new card opens expanded; saved cards start closed. */
  expanded: Set<string>;
  /** The card whose Remove question is open. */
  removeOpen: string | null;
  icloud: Map<string, ListState>;
  tests: Map<string, { busy: boolean; result: TestResult | null }>;
  microsoft: Map<string, MicrosoftState>;
  lifx: LifxState;
  input: InputUiState;
  resetOpen: boolean;
  /** Reset was confirmed: the done state stands where the dialog was until a reload. */
  resetDone: boolean;
  issuesExpanded: boolean;
  /** Colors shows every status, not only those the setup can produce (SPEC 11.3 D). */
  colorsExpanded: boolean;
  /** The statuses Colors was last drawn with, so a /status answer redraws it only when they change. */
  colorsShown?: string;
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
