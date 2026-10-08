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

/** `label (ip)`, or the serial number when the bulb did not give a name. */
export function bulbName(bulb: { label: string; serial: string }): string {
  return bulb.label || bulb.serial;
}

export function bulbsFound(bulbs: { label: string; serial: string; host: string }[], using: { label: string; serial: string }): string {
  return `LIFX bulbs found: ${bulbs.map((b) => `${bulbName(b)} (${b.host})`).join(', ')}. Using ${bulbName(using)}.`;
}

export function noBulb(): string {
  return 'No LIFX bulb was found on the network. Check that it is on, or enter its IP address in the plugin settings.';
}

export function severalBulbs(bulbs: { label: string; serial: string }[]): string {
  return `More than one LIFX bulb was found: ${bulbs.map(bulbName).join(', ')}. Enter the name of the one to use in the plugin settings.`;
}

/** Not in the SPEC 12 table as first written; added in build 1 (SPEC 17) for a `lifx.bulb` that matches no bulb found. */
export function bulbNotNamed(wanted: string, bulbs: { label: string; serial: string; host: string }[]): string {
  return `No LIFX bulb named ${wanted} was found. Bulbs found: ${bulbs.map((b) => `${bulbName(b)} (${b.host})`).join(', ')}.`;
}

export function bulbSilent(host: string): string {
  return `The LIFX bulb at ${host} did not answer.`;
}

export function bulbBack(host: string): string {
  return `The LIFX bulb at ${host} is answering again.`;
}
