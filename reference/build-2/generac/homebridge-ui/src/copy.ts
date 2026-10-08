/**
 * Every string the settings page shows, verbatim from SPEC section 11.3 (the harness checks each constant
 * against SPEC.md). Functions build the strings with a value inserted; their templates are in the SPEC too.
 */

export const TOAST_TITLE = 'Generac for Homebridge';

/** SPEC 11.3 A. The banner artwork carries the title and tagline; here they are its alt text. */
export const BANNER = {
  file: 'generac-banner.png',
  title: 'Generac for Homebridge',
  tagline: 'Standby generator status in the Home app',
};

export const INTRO = {
  one: 'Generac for Homebridge shows the standby generators on your Mobile Link account in the Home app. '
    + 'Each generator appears as a Running sensor, a Fault sensor, a Maintenance Due sensor, an Exercising sensor and a starting battery reading.',
  two: 'It is read only. It cannot start, stop or exercise the generator. Connect your account below and your generators are found for you.',
  accountHeading: 'Mobile Link account',
  accountHelp: 'One account per Homebridge instance. Use the email and password you use in the Mobile Link app.',
  generatorsHeading: 'Generators',
  generatorsHelp: 'Every generator on the account gets a card here. You can rename each one.',
  generatorsEmpty: 'No generators yet. Connect your Mobile Link account above and they appear here within a minute.',
  settingsHeading: 'Settings',
  closing: 'Your generators appear in the Home app as sensors. Add them to automations; for example, turn on a light when Running opens.',
  affiliation: 'Not affiliated with or endorsed by Generac Power Systems, Inc. Generac and Mobile Link are its trademarks. '
    + 'Uses Generac\'s undocumented Mobile Link API, which can change without notice.',
};

/** SPEC 11.3 B. */
export const ACCOUNT = {
  title: 'Mobile Link account',
  notConnectedBody: 'Sign in once with your Mobile Link email and password. Your password is used to sign in and is not stored.',
  connect: 'Connect',
  checking: 'Checking',
  checkingBody: 'Signed in. Homebridge picks up the new sign-in within a minute.',
  checkingSlow: 'Homebridge hasn\'t picked it up yet. Restart Homebridge from Power Options.',
  connected: 'Connected',
  lastChecked: (relative: string): string => `Last checked ${relative}`,
  disconnect: 'Disconnect',
  disconnectQuestion: 'Disconnect this account? The plugin will stop updating your generators until you connect again.',
  keep: 'Keep',
  reconnectBadge: 'Reconnect needed',
  reconnectBody: 'Mobile Link signed this plugin out. This happens after a password change or if Generac revokes access. Sign in again to resume updates.',
  reconnectAttention: 'The Attention needed sensor is on in HomeKit until you reconnect.',
  reconnect: 'Reconnect',
};

/** SPEC 11.3 C. */
export const CONNECT = {
  email: 'Email',
  emailPlaceholder: 'e.g. you@example.com',
  password: 'Password',
  passwordHelp: 'Used once to sign in. Not stored.',
  signIn: 'Sign in',
  cancel: 'Cancel',
  signingIn: 'Signing in…',
  wrongPassword: 'Mobile Link rejected that password. If you haven\'t reset it since Generac\'s security update on April 21, 2026, '
    + 'reset it in the Mobile Link app, then try again.',
  unknownEmail: 'Mobile Link doesn\'t recognize that email.',
  network: 'Couldn\'t reach Mobile Link. Try again in a minute.',
  codeTitle: 'Enter your code',
  codeBodySms: 'Mobile Link texted a code to the phone on your account.',
  codeBodyOtp: 'Enter the code from your authenticator app.',
  codeBodyEmail: (email: string): string => `Mobile Link emailed a code to ${email}.`,
  codeSecondLine: 'Didn\'t get it? Cancel and sign in again.',
  code: 'Code',
  codePlaceholder: 'e.g. 123456',
  continue: 'Continue',
  wrongCode: 'That code didn\'t work. Check for a newer message and try again.',
  tooMany: 'Too many attempts. Cancel and sign in again.',
  expired: 'That sign-in timed out. Cancel and sign in again.',
  unsupported: 'Your account uses a sign-in method this plugin can\'t complete. In the Mobile Link app, switch to text message '
    + 'or an authenticator app, then try again.',
};

/** SPEC 11.3 D. */
export const GENERATOR = {
  maintenanceDue: 'Maintenance due',
  serial: (serial: string): string => `S/N ${serial}`,
  ready: 'Ready to run',
  running: 'Running',
  exercising: 'Exercising',
  fault: 'Fault',
  notResponding: 'Not responding',
  notRespondingNote: (time: string): string => `Mobile Link hasn't heard from this generator since ${time}.`,
  battery: 'Battery',
  volts: (volts: string): string => `${volts} V`,
  low: 'Low',
  fuel: 'Fuel',
  percent: (percent: string): string => `${percent}%`,
  fuelHelp: 'Propane models only',
  engineHours: 'Engine hours',
  hours: (n: string): string => `${n} h`,
  exerciseTime: 'Exercise time',
  weekly: (time: string): string => `${time} weekly`,
  lastExercise: 'Last exercise',
  dateAt: (date: string, time: string): string => `${date} at ${time}`,
  lastSeen: 'Last seen',
  rename: 'Rename',
  name: 'Name',
  saveName: 'Save name',
  cancel: 'Cancel',
  alsoPropane: 'Also on your account: Propane tank monitor (not supported).',
  alsoEcobee: (name: string): string => `Also on your account: ecobee thermostat "${name}" (already in HomeKit, skipped).`,
};

/** SPEC 11.3 E. */
export const SETTINGS = {
  name: 'Name',
  pollIdle: 'Poll interval while idle (minutes)',
  pollIdleHelp: 'Mobile Link updates every few minutes and limits how often you can check. Faster than this rarely helps.',
  pollIdleError: 'Minimum is 2 minutes.',
  pollActive: 'Poll interval while running or in fault (seconds)',
  pollActiveHelp: 'Used while a generator is running, exercising, or reporting a problem.',
  pollActiveError: 'Minimum is 60 seconds.',
  batteryLow: 'Low battery threshold (volts)',
  batteryLowHelp: 'A healthy starting battery on charge reads 13.4 to 13.8 V.',
  batteryLowError: 'Enter volts with one decimal place, for example 12.0.',
  faultOnStopped: 'Treat Stopped as a fault',
  faultOnStoppedHelp: 'Stopped means the control switch is in OFF and the generator won\'t start during an outage.',
  faultOnDisconnected: 'Treat a lost connection as a fault',
  faultOnDisconnectedHelp: 'Off by default. Wi-Fi drops are common and the sensors already show Not responding.',
  attentionSensor: 'Attention needed sensor',
  attentionSensorHelp: 'Adds an occupancy sensor to HomeKit that turns on when the plugin needs you to reconnect.',
  exerciseSensor: 'Exercising sensor',
  exerciseSensorHelp: 'Adds a sensor that opens while the weekly exercise runs, or when Mobile Link reports one finished. '
    + 'Use it to confirm the generator exercised this week.',
  exerciseTime: 'Exercise time',
  exerciseTimeHelp: 'When your generator\'s weekly exercise starts. Prefilled from Mobile Link; correct it if your unit starts at a different time. '
    + 'The plugin checks more often around this time every day.',
  exerciseTimePlaceholder: 'e.g. 10:00',
  exerciseTimeError: 'Enter a time as HH:MM, for example 10:00.',
  exerciseHold: 'Exercise hold (minutes)',
  exerciseHoldHelp: 'How long the Exercising sensor stays open after an exercise is detected.',
  exerciseHoldError: 'Minimum is 1 minute.',
  debug: 'Debug logging',
  debugHelp: 'Verbose logging. Your password is never logged, even with this on.',
  resetLines: [
    'Signs out of Mobile Link and removes the saved sign-in.',
    'Removes every generator and its sensors from the Home app.',
    'Clears all settings on this page.',
  ],
  resetDoneTitle: 'Reset done',
  resetDoneBody: 'Click Save, then restart Homebridge to remove the generators from the Home app. '
    + 'Reconnect your Mobile Link account afterwards if you want them back.',
};

/** Shell strings (SPEC 11.3 F): the disclosure, the Reset dialog, the password toggle, the credit footer and relative times. */
export const SHELL = {
  advanced: 'Advanced',
  reset: 'Reset plugin to fresh install',
  resetTitle: 'Reset plugin to fresh install?',
  resetPrompt: 'Type RESET to confirm.',
  resetConfirm: 'Confirm',
  resetCancel: 'Cancel',
  resetDone: 'Signed out and reset. Click Save, then restart Homebridge.',
  show: 'Show',
  hide: 'Hide',
  required: (label: string): string => `${label} is required.`,
  loadFailed: 'Could not load the configuration.',
  updateFailed: 'Could not update the configuration.',
};

export const FOOTER = {
  name: 'Generac for Homebridge',
  madeBy: 'Made by Alex Rodriguez',
  site: 'alex-rodriguez.com',
  siteUrl: 'https://alex-rodriguez.com/?ref=generac',
  issues: 'Report an issue',
  issuesUrl: 'https://github.com/arodbuilds/homebridge-generac/issues',
};

export const RELATIVE = {
  justNow: 'just now',
  minutes: (n: number): string => (n === 1 ? '1 minute ago' : `${n} minutes ago`),
  hours: (n: number): string => (n === 1 ? '1 hour ago' : `${n} hours ago`),
  days: (n: number): string => (n === 1 ? '1 day ago' : `${n} days ago`),
};
