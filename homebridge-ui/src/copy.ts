/**
 * Every string the settings page shows, verbatim from SPEC section 11.3 (a test checks each one against SPEC.md, in
 * both directions). Functions build the strings with a value inserted; called with their placeholder names, such as
 * `RIGHT_NOW.until('{time}', '{source}')`, they give the SPEC's own text. The status and sensor names are those of
 * SPEC sections 6.2 and 7, which the page shows as they are.
 */

/** The title of the host's toasts: the display name of SPEC section 3. */
export const TOAST_TITLE = 'Busy Light';

/** SPEC 11.3 A. The banner artwork carries the title and tagline; the alt text says them. */
export const BANNER = {
  file: 'busy-light-banner.png',
  alt: 'Busy Light for Homebridge: your calendar and Teams status on a light.',
};

export const INTRO = {
  one: 'Busy Light shows whether you are free on a light. It reads your calendars and, if you use Microsoft 365, your Teams status, '
    + 'then sets a color for each.',
  two: 'Add at least one calendar, then choose how the light is controlled.',
  affiliation: 'Not affiliated with or endorsed by Apple, Google, Microsoft or LIFX.',
  closing: 'Your status also appears in the Home app as sensors. Use them in automations to set any other light or scene.',
};

/** SPEC 11.3 B. */
export const RIGHT_NOW = {
  heading: 'Right now',
  until: (time: string, source: string): string => `Until ${time}, from ${source}.`,
  from: (source: string): string => `From ${source}.`,
  /** The source name the plugin writes when Teams presence decided the status (SPEC 6.3). */
  teams: 'Teams',
  nothingUntil: (time: string): string => `Nothing on your calendars until ${time}.`,
  nothingNow: 'Nothing on your calendars right now.',
  override: 'The override switch is on.',
  noCalendars: 'Add a calendar to see your status here.',
  notStarted: 'Busy Light has not started yet. Save, then restart Homebridge.',
  unknown: 'Status unknown. None of your calendars could be read.',
  stale: (relative: string): string => `Last updated ${relative}. Is Homebridge running?`,
};

/** The display names of SPEC 6.2, in the precedence order of 6.3. */
export const STATUS_NAMES = {
  outOfOffice: 'Out of office',
  doNotDisturb: 'Do not disturb',
  inCall: 'In a call',
  inMeeting: 'In a meeting',
  busy: 'Busy',
  tentative: 'Tentative',
  away: 'Away',
  available: 'Available',
  offline: 'Offline',
} as const;

export type StatusKey = keyof typeof STATUS_NAMES;

/** SPEC 11.3 C. */
export const CALENDARS = {
  heading: 'Calendars',
  help: 'Add every calendar that should count. Events from all of them are combined.',
  empty: 'No calendars yet.',
  add: 'Add calendar',
  newCalendar: 'New calendar',
  lastChecked: (relative: string): string => `Last checked ${relative}`,
  name: 'Name',
  namePlaceholder: 'e.g. Work',
  nameHelp: 'A name for this calendar. It appears in the log.',
  remove: 'Remove',
  removeQuestion: (name: string): string => `Remove ${name}?`,
  cancel: 'Cancel',
  countsFor: 'Counts for',
  countsAll: 'Busy and out of office',
  countsOutOfOffice: 'Out of office only',
  countsHelp: 'Out of office only uses this calendar\'s out of office events and ignores the rest. Useful for a family calendar.',
  calendarsHeading: 'Calendars to use',
  /** `{n} events today`, `1 event today` or `No events today`. */
  eventsToday: (n: number | string): string => (n === 0 ? 'No events today' : n === 1 ? '1 event today' : `${n} events today`),
  shared: 'Shared with you',
  isNew: 'New',
  connectToSee: 'Connect to see all your calendars.',
};

/** The chooser tiles and the card's type badge, by source type. */
export const SOURCE_TYPES = {
  icloud: { title: 'iCloud', help: 'Calendars in your Apple account.' },
  google: { title: 'Google Calendar', help: 'One Google calendar, by its secret address.' },
  microsoft: { title: 'Microsoft 365', help: 'Outlook calendars and Teams status. Needs an app registration from your administrator.' },
  url: { title: 'Calendar URL', help: 'Any calendar link that starts with https:// or webcal://.' },
} as const;

/** The state pill of a calendar card. */
export const PILLS = {
  connected: 'Connected',
  checking: 'Checking',
  signInNeeded: 'Sign-in needed',
  notReachable: 'Not reachable',
  notSaved: 'Not saved yet',
};

export const ICLOUD = {
  appleId: 'Apple ID email',
  appleIdPlaceholder: 'e.g. you@icloud.com',
  appPassword: 'App-specific password',
  appPasswordHelp: 'Not your Apple ID password. Create one at account.apple.com under Sign-In and Security, then App-Specific Passwords.',
  /** The part of the help that links to Apple's site (SPEC section 17, October 8, 2026). */
  accountSite: 'account.apple.com',
  accountUrl: 'https://account.apple.com',
  howTo: 'How to create one',
  howToUrl: 'https://support.apple.com/en-us/102654',
  connect: 'Connect',
  connecting: 'Connecting…',
  refresh: 'Refresh list',
  rejected: 'iCloud did not accept that Apple ID and app-specific password. Check both, or create a new app-specific password.',
  network: 'Could not reach iCloud. Try again in a minute.',
  unexpected: 'iCloud answered in a way Busy Light did not expect. Try again, and report an issue if it keeps happening.',
  calendarsHelp: 'Tick the calendars that should count. Calendars you add to iCloud later stay off until you tick them here.',
  subscribed: 'Subscribed calendar. Add its address as a Calendar URL instead.',
};

export const GOOGLE = {
  secret: 'Secret address in iCal format',
  secretHelp: 'In Google Calendar settings, pick the calendar, then Integrate calendar. Treat it like a password.',
  email: 'Your Google email',
  emailPlaceholder: 'e.g. you@gmail.com',
  emailHelp: 'Lets Busy Light ignore invitations you declined.',
};

export const URL_CARD = {
  address: 'Address',
  addressHelp: 'Any calendar link that starts with https:// or webcal://.',
};

/** The Test button and its results, on the Google Calendar and Calendar URL cards. */
export const TEST = {
  test: 'Test',
  testing: 'Testing…',
  /** `Read the calendar: {n} events today.`, with `1 event today` and `no events today`. */
  result: (n: number | string): string => `Read the calendar: ${n === 0 ? 'no events today' : n === 1 ? '1 event today' : `${n} events today`}.`,
  insecure: 'Use an address that starts with https:// or webcal://.',
  notCalendar: 'That address did not return a calendar.',
  notCalendarGoogle: 'Copy the Secret address in iCal format, not the public address.',
  http: (host: string, code: string): string => `${host} answered with an error (${code}).`,
  network: (host: string): string => `Could not reach ${host}.`,
  tooLarge: 'That calendar is over 10 MB, which is more than Busy Light reads.',
};

export const MICROSOFT = {
  note: 'Needs an app registration from your Microsoft 365 administrator.',
  whatToAsk: 'What do I ask for?',
  adminUrl: 'https://github.com/arodbuilds/homebridge-busy-light/blob/latest/docs/microsoft-365-admin-request.md',
  tenantId: 'Directory (tenant) ID',
  clientId: 'Application (client) ID',
  guidPlaceholder: 'e.g. 00000000-0000-0000-0000-000000000000',
  useTeamsStatus: 'Use Teams status',
  useCalendars: 'Use Outlook calendars',
  connect: 'Connect',
  gettingCode: 'Getting a code…',
  disconnect: 'Disconnect',
  disconnectQuestion: 'Sign out of Microsoft 365 on this Homebridge? Busy Light stops reading these calendars and your Teams status until you connect again.',
  keep: 'Keep',
  codeTitle: 'Sign in to Microsoft 365',
  codeBody: 'Open the Microsoft sign-in page, enter this code, and sign in with your work account.',
  copyCode: 'Copy code',
  copied: 'Copied',
  openSignIn: 'Open Microsoft sign-in',
  waiting: 'Waiting for you to finish signing in…',
  expired: 'The code expired. Connect again to get a new one.',
  refused: (reason: string): string => `Microsoft did not allow the sign-in: ${reason}. This needs your Microsoft 365 administrator.`,
  instructions: 'Instructions to send them',
  network: 'Could not reach Microsoft. Try again in a minute.',
  calendarsHelp: 'Tick the calendars that should count. Calendars added later stay off until you tick them here.',
  isDefault: 'Default',
  signInAgain: 'Sign in again to see your calendars.',
  defaultCalendar: 'Your default calendar.',
};

/** SPEC 11.3 D. */
export const COLORS = {
  heading: 'Colors',
  help: 'The color the light shows for each status. Choose Off to turn the light off instead.',
  off: 'Off',
  teamsOnly: 'Teams only',
  precedence: 'When more than one applies, the one highest in this list wins.',
  reset: 'Reset colors',
};

/** The accessory name endings of SPEC section 7, in its order. */
export const SENSOR_NAMES = {
  available: 'Available',
  busyAny: 'Busy',
  outOfOffice: 'Out of Office',
  inMeeting: 'In a Meeting',
  inCall: 'In a Call',
  doNotDisturb: 'Do Not Disturb',
  busy: 'Busy in Teams',
  tentative: 'Tentative',
  away: 'Away',
  offline: 'Offline',
} as const;

export type SensorKey = keyof typeof SENSOR_NAMES;

/** SPEC 11.3 E. */
export const LIGHTS = {
  heading: 'Lights',
  lifxTitle: 'LIFX bulb',
  useLifx: 'Use a LIFX bulb',
  searching: 'Looking for LIFX bulbs on your network…',
  foundOne: (label: string, ip: string): string => `Found ${label} (${ip}). Busy Light will use it.`,
  foundSeveral: (n: number | string): string => `Found ${n} bulbs. Choose one:`,
  bulbChoice: (label: string, ip: string): string => `${label} (${ip})`,
  none: 'No LIFX bulb found. Check that it is on and on the same network as Homebridge.',
  savedMissing: (label: string): string => `${label} was not found just now. It may be switched off.`,
  searchAgain: 'Search again',
  brightness: 'Brightness (percent)',
  testLight: 'Test light',
  testing: 'Testing…',
  testHelp: 'Shows red, then green, on the bulb.',
  answered: 'The bulb answered.',
  noAnswer: 'No answer from the bulb. Check that it is on and on the same network as Homebridge.',
  ipLead: 'Bulb not found? Enter its IP address.',
  ip: 'Bulb IP address',
  ipPlaceholder: 'e.g. 192.168.1.50',
  ipHelp: 'Only needed when the search cannot reach the bulb, for example when Homebridge runs in Docker without host networking.',
  usingIp: (ip: string): string => `Busy Light will use the bulb at ${ip}.`,
  refresh: 'Send the color again every (seconds)',
  refreshHelp: 'Recovers a bulb that was switched off at the wall. 0 sends only when the status changes.',
  otherHeading: 'Other lights in the Home app',
  otherText: 'Busy Light cannot control other HomeKit lights itself. It adds sensors to the Home app, and an automation there sets the light.',
  sensors: 'Sensors to create',
  /** A sensor's checkbox: the accessory name of SPEC section 7. */
  sensor: (name: string, ending: string): string => `${name} ${ending}`,
  showAll: 'Show all statuses',
  steps: [
    (): string => 'In the Home app, add an automation: A sensor detects something.',
    (name: string): string => `Choose ${name} Busy, then Detects occupancy.`,
    (): string => 'Set your light to red.',
  ],
};

/** SPEC 11.3 F. */
export const SETTINGS = {
  heading: 'Settings',
  name: 'Name',
  nameHelp: 'Starts the name of every sensor, for example "Busy Light Available".',
  pollSeconds: 'Check status every (seconds)',
  calendarSeconds: 'Reload calendars every (seconds)',
  ignoreAllDayBusy: 'Ignore all-day events marked busy',
  ignoreAllDayBusyHelp: 'All-day out of office events always count.',
  outOfOfficeWords: 'Out of office words',
  outOfOfficeWordsHelp: 'iCloud, Google and URL calendar events with one of these words in the title count as out of office.',
  overrideSwitch: 'Override switch',
  overrideSwitchHelp: 'Adds a switch to the Home app that forces Do not disturb while it is on.',
  debug: 'Debug logging',
  debugHelp: 'Verbose logging. Passwords, calendar addresses and event titles are never logged, even with this on.',
  resetLines: [
    'Signs out of Microsoft 365 and removes the saved sign-in.',
    'Removes every Busy Light sensor and switch from the Home app.',
    'Clears all settings on this page.',
  ],
  resetDoneTitle: 'Reset done',
  resetDoneBody: 'Click Save, then restart Homebridge.',
};

/** SPEC 11.3 G: the shell's own strings, shared with the author's other plugins. */
export const SHELL = {
  advanced: 'Advanced',
  reset: 'Reset plugin to fresh install',
  resetTitle: 'Reset plugin to fresh install?',
  resetPrompt: 'Type RESET to confirm.',
  resetConfirm: 'Confirm',
  resetCancel: 'Cancel',
  show: 'Show',
  hide: 'Hide',
  loadFailed: 'Could not load the configuration.',
  updateFailed: 'Could not update the configuration.',
  draft: 'You have unsaved changes from earlier. Restore them?',
  restore: 'Restore',
  discard: 'Discard',
  issuesHeading: 'Fix these before saving:',
  /** `{n} fields need attention`, or `1 field needs attention`. */
  issuesCount: (n: number | string): string => (n === 1 ? '1 field needs attention' : `${n} fields need attention`),
  issuesShowAll: 'Show all',
  issuesHide: 'Hide',
  /** A summary box entry: `{Card name}: {message}`. */
  issue: (label: string, message: string): string => `${label}: ${message}`,
};

export const FOOTER = {
  name: 'Busy Light',
  version: (version: string): string => `Busy Light v${version}`,
  madeBy: 'Made by Alex Rodriguez',
  site: 'alex-rodriguez.com',
  siteUrl: 'https://alex-rodriguez.com/?ref=busy-light#building',
  issues: 'Report an issue',
  issuesUrl: 'https://github.com/arodbuilds/homebridge-busy-light/issues',
};

export const RELATIVE = {
  justNow: 'just now',
  minutes: (n: number | string): string => (n === 1 ? '1 minute ago' : `${n} minutes ago`),
  hours: (n: number | string): string => (n === 1 ? '1 hour ago' : `${n} hours ago`),
  days: (n: number | string): string => (n === 1 ? '1 day ago' : `${n} days ago`),
};

/** SPEC 11.3 H: validation messages, on blur and in the summary box. */
export const VALIDATION = {
  required: (label: string): string => `${label} is required.`,
  duplicateName: 'Another calendar already uses this name.',
  email: 'That does not look like an email address.',
  address: 'Use an address that starts with https:// or webcal://.',
  guid: 'Enter it as 00000000-0000-0000-0000-000000000000.',
  color: 'Enter a color as #RRGGBB, for example #FF0000.',
  wholeNumber: (min: number | string, max: number | string): string => `Enter a whole number from ${min} to ${max}.`,
  host: 'Enter an IP address such as 192.168.1.50, or a host name.',
  microsoftNeither: 'Turn on Use Teams status, Use Outlook calendars, or both.',
  microsoftTeamsTwice: 'Only one Microsoft 365 calendar can use Teams status.',
  chooseCalendar: 'Choose at least one calendar.',
};
