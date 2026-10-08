// Pure status logic. No network or HomeKit code here so it can be unit tested.

export const STATUS_KEYS = [
  'available',
  'inMeeting',
  'inCall',
  'doNotDisturb',
  'busy',
  'tentative',
  'away',
  'outOfOffice',
  'offline',
] as const;

export type StatusKey = (typeof STATUS_KEYS)[number];

export const STATUS_LABELS: Record<StatusKey, string> = {
  available: 'Available',
  inMeeting: 'In a Meeting',
  inCall: 'In a Call',
  doNotDisturb: 'Do Not Disturb',
  busy: 'Busy',
  tentative: 'Tentative',
  away: 'Away',
  outOfOffice: 'Out of Office',
  offline: 'Offline',
};

/** Teams presence as returned by Microsoft Graph /me/presence. Null when presence is not used. */
export interface PresenceInfo {
  availability?: string;
  activity?: string;
  outOfOffice?: boolean;
}

/** One calendar event, times in epoch milliseconds. */
export interface CalEvent {
  showAs: string; // free | tentative | busy | oof | workingElsewhere | unknown
  start: number;
  end: number;
  isAllDay: boolean;
  isCancelled: boolean;
}

export interface ResolveOptions {
  /** All-day events marked busy or tentative are ignored (all-day out of office still counts). */
  ignoreAllDayBusy: boolean;
}

/**
 * Combine presence and calendar into one status. Order of precedence:
 * out of office, do not disturb, in a call, in a meeting, busy, tentative, away, available, offline.
 */
export function resolveStatus(
  presence: PresenceInfo | null,
  events: CalEvent[],
  now: number,
  opts: ResolveOptions,
): StatusKey {
  const active = events.filter((e) => !e.isCancelled && e.start <= now && now < e.end);
  const counts = (e: CalEvent) => !(e.isAllDay && opts.ignoreAllDayBusy);
  const calOof = active.some((e) => e.showAs === 'oof');
  const calBusy = active.some((e) => e.showAs === 'busy' && counts(e));
  const calTentative = active.some((e) => e.showAs === 'tentative' && counts(e));

  const av = presence?.availability ?? '';
  const act = presence?.activity ?? '';

  if (presence?.outOfOffice || act === 'OutOfOffice' || calOof) {
    return 'outOfOffice';
  }
  if (av === 'DoNotDisturb' || act === 'Presenting' || act === 'Focusing' || act === 'DoNotDisturb') {
    return 'doNotDisturb';
  }
  if (act === 'InACall' || act === 'InAConferenceCall') {
    return 'inCall';
  }
  if (act === 'InAMeeting' || calBusy) {
    return 'inMeeting';
  }
  if (av === 'Busy' || av === 'BusyIdle') {
    return 'busy';
  }
  if (calTentative) {
    return 'tentative';
  }
  if (av === 'Away' || av === 'BeRightBack') {
    return 'away';
  }
  if (av === 'Available' || av === 'AvailableIdle') {
    return 'available';
  }
  // Calendar-only mode with nothing on the calendar means available.
  return presence === null ? 'available' : 'offline';
}
