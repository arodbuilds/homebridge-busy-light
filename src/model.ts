/**
 * The fixed vocabulary of SPEC sections 6.2 and 7: statuses, their display names and default colors, and the
 * HomeKit sensors that follow them.
 */

/** The nine statuses in precedence order (SPEC 6.2 and 6.3). */
export const STATUS_KEYS = [
  'outOfOffice',
  'doNotDisturb',
  'inCall',
  'inMeeting',
  'busy',
  'tentative',
  'away',
  'available',
  'offline',
] as const;

export type StatusKey = (typeof STATUS_KEYS)[number];

/**
 * A status, `unknown` when no source has fresh data (SPEC 6.5), or `notWorking` while the Working switch is off (6.6).
 * Neither has a color of its own or a sensor.
 */
export type Status = StatusKey | 'unknown' | 'notWorking';

export const STATUS_NAMES: Record<StatusKey, string> = {
  outOfOffice: 'Out of office',
  doNotDisturb: 'Do not disturb',
  inCall: 'In a call',
  inMeeting: 'In a meeting',
  busy: 'Busy',
  tentative: 'Tentative',
  away: 'Away',
  available: 'Available',
  offline: 'Offline',
};

/** `#RRGGBB` or `off`. */
export const DEFAULT_COLORS: Record<StatusKey, string> = {
  outOfOffice: '#B400FF',
  doNotDisturb: '#FF0000',
  inCall: '#FF0000',
  inMeeting: '#FF0000',
  busy: '#FF6A00',
  tentative: '#FFD000',
  away: '#FFD000',
  available: '#00FF00',
  offline: 'off',
};

/** The ten sensors of SPEC section 7, roll-ups first. */
export const SENSOR_KEYS = [
  'available',
  'busyAny',
  'outOfOffice',
  'inMeeting',
  'inCall',
  'doNotDisturb',
  'busy',
  'tentative',
  'away',
  'offline',
] as const;

export type SensorKey = (typeof SENSOR_KEYS)[number];

/** Accessory names are `{name} {suffix}`. */
export const SENSOR_NAMES: Record<SensorKey, string> = {
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
};

/** The statuses during which each sensor detects occupancy. */
export const SENSOR_STATUSES: Record<SensorKey, readonly StatusKey[]> = {
  available: ['available'],
  busyAny: ['inMeeting', 'inCall', 'doNotDisturb', 'busy'],
  outOfOffice: ['outOfOffice'],
  inMeeting: ['inMeeting'],
  inCall: ['inCall'],
  doNotDisturb: ['doNotDisturb'],
  busy: ['busy'],
  tentative: ['tentative'],
  away: ['away'],
  offline: ['offline'],
};

export const DEFAULT_SENSORS: readonly SensorKey[] = ['available', 'busyAny', 'outOfOffice'];

export function isStatusKey(value: unknown): value is StatusKey {
  return typeof value === 'string' && (STATUS_KEYS as readonly string[]).includes(value);
}

export function isSensorKey(value: unknown): value is SensorKey {
  return typeof value === 'string' && (SENSOR_KEYS as readonly string[]).includes(value);
}
