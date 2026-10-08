/**
 * Log lines, verbatim from SPEC section 12. Every line the plugin and the CLI write about sign-in, sources, status
 * and the bulb comes from here. None of them carries a password, token, device code, calendar address or anything
 * about an event except counts and times.
 */

/** The instructions to send a Microsoft 365 administrator (SPEC 4.3.1). */
export const ADMIN_HELP_URL = 'https://github.com/arodbuilds/homebridge-busy-light/blob/latest/docs/microsoft-365-admin-request.md';

export function microsoftCode(name: string, verificationUri: string, userCode: string): string {
  return `${name}: Microsoft sign-in needed. Open ${verificationUri} and enter the code ${userCode}.`;
}

export function microsoftDone(name: string): string {
  return `${name}: signed in to Microsoft 365.`;
}

export function microsoftRefused(name: string, reason: string): string {
  return `${name}: Microsoft did not allow the sign-in: ${reason}. This needs your Microsoft 365 administrator. ` +
    `Instructions to send them: ${ADMIN_HELP_URL}`;
}

export function microsoftGaveUp(name: string): string {
  return `${name}: the sign-in code was not used. Restart Homebridge or run "homebridge-busy-light login" to try again.`;
}
