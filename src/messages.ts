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

/** `1 minute`, `2 minutes`: a count with its noun, singular when the count is 1. */
export function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

/** A time as `h:mm AM/PM` in the host's locale and time zone, 12-hour (SPEC 12). */
export function formatTime(ms: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', hour12: true })
    .format(new Date(ms))
    .replace(/[\u202f\u00a0]/g, ' ');
}

/** `light on at {host}`, `light on` while the bulb is still being found, or `light off`. */
export function startup(version: string, calendars: number, light: { enabled: boolean; host: string | null }, sensors: number): string {
  const lightPart = !light.enabled ? 'off' : light.host ? `on at ${light.host}` : 'on';
  return `Busy Light ${version}: ${count(calendars, 'calendar')}, light ${lightPart}, ${count(sensors, 'sensor')}.`;
}

export function noCalendars(): string {
  return 'No calendars are set up yet. Open the plugin settings to add one.';
}

/** `Status: In a meeting (Work, until 2:30 PM).` The parenthesis is left out with no reason, `until` with no time. */
export function statusLine(displayName: string, reason: { source: string | null; until: number | null } | null): string {
  const parts: string[] = [];
  if (reason?.source) {
    parts.push(reason.source);
  }
  if (reason?.until != null) {
    parts.push(`until ${formatTime(reason.until)}`);
  }
  return parts.length ? `Status: ${displayName} (${parts.join(', ')}).` : `Status: ${displayName}.`;
}

export function statusUnknown(): string {
  return 'Status unknown: none of your calendars could be read.';
}

export function icloudDiscovery(name: string, found: string[], used: string[]): string {
  const list = (names: string[]) => (names.length ? names.join(', ') : 'none');
  return `${name}: calendars found: ${list(found)}. In use: ${list(used)}.`;
}

/** Once per discovery, when the source lists its calendars and others exist on the account. */
export function calendarsNotInUse(name: string, names: string[]): string {
  return `${name}: calendars not in use: ${names.join(', ')}. Tick them in the plugin settings to use them.`;
}

/** Once, until the calendar is found again. `calendar` is its name, never its id. */
export function listedCalendarGone(name: string, calendar: string): string {
  return `${name}: the calendar "${calendar}" was not found. It may have been deleted or unshared.`;
}

export function sourceFailed(name: string, reason: string, minutes: number): string {
  return `${name}: could not be read (${reason}). Trying again in ${count(minutes, 'minute')}.`;
}

/** SPEC 12 "Repeat limit": once per source, when a recurring series reaches the safety cap of 5.4 item 3. */
export function repeatLimit(name: string): string {
  return `${name}: a recurring event repeats too often to read in full, so some of its occurrences are left out.`;
}

export function sourceRecovered(name: string): string {
  return `${name}: working again.`;
}

export function icloudRejected(name: string): string {
  return `${name}: iCloud did not accept the Apple ID and app-specific password. Check them in the plugin settings.`;
}

/** `{path}: {message}` for a configuration issue. */
export function validation(path: string, message: string): string {
  return `${path}: ${message}`;
}

/** SPEC 12 "Sender changed": a sender's report, when it is new or its status or app changed. */
export function senderReports(sender: string, displayName: string, app: string | null): string {
  return app ? `${sender} reports ${displayName} from ${app}.` : `${sender} reports ${displayName}.`;
}

export function senderCleared(sender: string): string {
  return `${sender} cleared its status.`;
}

export function senderExpired(sender: string): string {
  return `${sender}'s status expired.`;
}

export function inputStarted(port: number): string {
  return `Status input is listening on port ${port}.`;
}

/** SPEC 12 "Input failed": a port in use, or another short reason (null for a port in use). */
export function inputFailed(port: number, reason: string | null): string {
  return reason === null ? `Status input could not start: port ${port} is already in use.` : `Status input could not start: ${reason}.`;
}

export function inputWrongKey(ip: string): string {
  return `Status input: refused a request with a wrong key from ${ip}.`;
}

export function inputClockOff(ip: string, seconds: number): string {
  return `Status input: refused a request from ${ip} whose clock is ${seconds} seconds off.`;
}

export function inputPlainKeyOff(ip: string): string {
  return `Status input: refused a request from ${ip} that sent the key itself. Turn on Allow the plain key, or have that app sign its requests.`;
}

export function inputNotLocal(ip: string): string {
  return `Status input: refused a request from ${ip}, which is not on the local network.`;
}

/** Address changed (SPEC 18.11 item 6): from one IPv4 address to another, once per change. */
export function addressChanged(from: string, to: string): string {
  return `Homebridge's address changed from ${from} to ${to}. Apps that use the old address need the new setup code.`;
}

/** SPEC 12 "Call switch timeout", with the singular noun for 1 (12 item 1). */
export function callSwitchTimeout(name: string, hours: number): string {
  return `${name} On a Call turned itself off after ${count(hours, 'hour')}.`;
}
