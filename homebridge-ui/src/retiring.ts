/**
 * Strings that build 3.3 takes off the page (SPEC 17, October 10, 2026). SPEC 11.3 no longer quotes them, so they left
 * `copy.ts` in the SPEC commit, since the copy check reads 11.3 and `copy.ts` in both directions; the page shows them
 * from here until the scope item that replaces each one, and this module is deleted with its last use.
 */

/** SPEC 11.3 A before build 3.3: the intro's two lines and the closing line. */
export const INTRO = {
  one: 'Busy Light shows whether you are free on a light. It reads your calendars and, if you use Microsoft 365, your Teams status, '
    + 'then sets a color for each.',
  two: 'Add at least one calendar, then choose how the light is controlled.',
  closing: 'Your status also appears in the Home app as sensors. Use them in automations to set any other light or scene.',
};

/** SPEC 11.3 C before build 3.3. */
export const CALENDARS_HELP = 'Add every calendar that should count. Events from all of them are combined.';
export const MICROSOFT_TITLE = 'Microsoft 365';
export const CHOOSER_SIGN_IN = 'Sign in with Microsoft 365';
export const ICLOUD = {
  appleId: 'Apple ID email',
  appPasswordHelp: 'Not your Apple ID password. Create one at account.apple.com under Sign-In and Security, then App-Specific Passwords.',
  rejected: 'iCloud did not accept that Apple ID and app-specific password. Check both, or create a new app-specific password.',
};
export const URL_ADDRESS_HELP = 'Any calendar link that starts with https:// or webcal://.';
export const MICROSOFT_NOTE = 'Needs an app registration from your Microsoft 365 administrator.';

/** SPEC 11.3 E before build 3.3: the three steps of the Home app example. */
export const LIGHTS_STEPS = [
  (): string => 'In the Home app, add an automation: A sensor detects something.',
  (name: string): string => `Choose ${name} Busy, then Detects occupancy.`,
  (): string => 'Set your light to red.',
];

/** SPEC 11.3 I before build 3.3. */
export const STATUS_INPUT = {
  allowPlainKeyHelp: 'Apps that sign their requests never send the key. Apple Shortcuts and curl send the key itself, so anyone watching your network '
    + 'could copy it. Turn this off once every app below shows Signed. If the key may have been seen, replace it too.',
  callSwitchHelp: 'Turn it on from a shortcut, Siri or a Home tile while you are on a call. Useful for apps that should not make network requests themselves.',
  callSwitchHours: 'Turn it off by itself after (hours)',
};
