/**
 * The Microsoft 365 card (SPEC 11.3 C): the app registration note, the two IDs, the two checkboxes, Connect and, once
 * signed in, Disconnect and the Outlook calendars to tick. Connect shows the code view in the card body's place and
 * asks /microsoft/poll every 3 seconds until it ends: signed in, expired, refused, or Microsoft not reachable (SPEC
 * 11.2 addition 7). A source already signed in lists its calendars at Connect without a new code.
 */

import { callServer } from '../api.js';
import type { App, MicrosoftListed, MicrosoftState } from '../app.js';
import { CALENDARS, ICLOUD, MICROSOFT } from '../copy.js';
import {
  button, checkboxField, copyText, el, footerAction, grid, gridCell, inlineConfirm, linkButton, outLink, paragraph, statusBox, textField, type Child,
} from '../dom.js';
import type { UiSource } from '../model.js';
import { sourcePath } from '../validate.js';
import { adoptIds, calendarList, rowBadges, type Row } from './calendar-list.js';
import { statusesChanged } from './colors.js';

/** How often the open code view asks whether the code was used. */
export const POLL_MS = 3000;

type StartAnswer = { verificationUri: string; userCode: string; expiresAt: string } | { error: 'refused'; reason: string; help: string } | { error: 'network' };
type PollAnswer = { state: 'waiting' | 'done' | 'expired' } | { state: 'refused'; reason: string; help: string };
type CalendarsAnswer = { calendars: MicrosoftListed[] } | { error: 'notSignedIn' | 'network' } | { error: 'refused'; reason: string; help: string };

const timers = new Map<string, number>();
const polling = new Set<string>();

export function microsoftState(app: App, s: UiSource): MicrosoftState {
  let state = app.ui.microsoft.get(s.id);
  if (!state) {
    const entry = app.status?.sources.find((e) => e.id === s.id);
    state = {
      busy: false, listed: null, tickedBefore: new Set(), error: null, connected: entry ? entry.state === 'connected' : null, flow: null,
      ending: null, disconnectOpen: false, busyLabel: null,
    };
    app.ui.microsoft.set(s.id, state);
  }
  return state;
}

/** The state file says whether each Microsoft source is signed in, until this page knows better. True when that changed anything. */
export function microsoftOnStatus(app: App): boolean {
  let changed = false;
  for (const s of app.config.calendars.filter((c) => c.type === 'microsoft')) {
    const state = microsoftState(app, s);
    const entry = app.status?.sources.find((e) => e.id === s.id);
    if (state.connected === null && entry) {
      state.connected = entry.state === 'connected';
      changed = true;
    }
  }
  return changed;
}

function stopPolling(id: string): void {
  const timer = timers.get(id);
  if (timer !== undefined) {
    window.clearInterval(timer);
    timers.delete(id);
  }
}

/** The card is going away: its code view closes and the server forgets the pending sign-in. */
export function stopMicrosoft(app: App, s: UiSource): void {
  const state = app.ui.microsoft.get(s.id);
  stopPolling(s.id);
  if (state?.flow) {
    state.flow = null;
    void callServer('/microsoft/cancel', { id: s.id });
  }
  app.ui.microsoft.delete(s.id);
}

/** True when the fields a request needs are filled in and valid; otherwise they are marked so their messages show. */
function ready(app: App, s: UiSource): boolean {
  const paths = ['tenantId', 'clientId', 'useTeamsStatus', 'useCalendar'].map((f) => sourcePath(s, f));
  const bad = app.issues().filter((i) => paths.includes(i.path));
  for (const issue of bad) {
    app.touch(issue.path);
  }
  return bad.length === 0;
}

/**
 * Lists the Outlook calendars with the stored sign-in. `fromConnect` is true when Connect listed instead of asking for
 * a code: a sign-in made with Teams status only has no Calendars.Read, so a refusal then answers true, and Connect asks
 * for a new code, whose scope includes it. A refusal right after a new sign-in is Microsoft's answer, and is shown.
 */
async function listCalendars(app: App, s: UiSource, fromConnect = false): Promise<boolean> {
  const state = microsoftState(app, s);
  state.busy = true;
  state.busyLabel = ICLOUD.connecting;
  state.error = null;
  app.rerender('calendars');
  const answer = await callServer<CalendarsAnswer>('/microsoft/calendars', { id: s.id, tenantId: s.tenantId.trim(), clientId: s.clientId.trim() });
  state.busy = false;
  state.busyLabel = null;
  if (answer && 'calendars' in answer) {
    state.listed = answer.calendars;
    state.connected = true;
    adoptIds(s, answer.calendars.map((c) => ({ ...c, subscribed: false })));
    for (const choice of s.calendars) {
      if (choice.id !== null) {
        state.tickedBefore.add(choice.id);
      }
    }
  } else if (answer && 'error' in answer && answer.error === 'notSignedIn') {
    state.error = 'signInAgain';
    state.connected = false;
  } else if (answer && 'error' in answer && answer.error === 'refused' && 'reason' in answer) {
    state.connected = false;
    if (fromConnect) {
      return true;
    }
    state.ending = { kind: 'refused', reason: answer.reason, help: answer.help };
  } else {
    state.ending = { kind: 'network' };
  }
  app.changed();
  app.rerender('calendars');
  return false;
}

async function poll(app: App, s: UiSource): Promise<void> {
  const state = microsoftState(app, s);
  const flow = state.flow;
  if (!flow) {
    stopPolling(s.id);
    return;
  }
  if (polling.has(s.id)) {
    return;
  }
  polling.add(s.id);
  const answer = await callServer<PollAnswer>('/microsoft/poll', { id: s.id }).finally(() => polling.delete(s.id));
  if (state.flow !== flow || !answer || answer.state === 'waiting') {
    return; // closed or replaced by a new code meanwhile, or asked again at the next interval
  }
  stopPolling(s.id);
  state.flow = null;
  if (answer.state === 'done') {
    state.connected = true;
    state.ending = null;
    app.rerender('calendars');
    if (s.useCalendar) {
      await listCalendars(app, s);
    }
    return;
  }
  state.ending = answer.state === 'refused' ? { kind: 'refused', reason: answer.reason, help: answer.help } : { kind: 'expired' };
  app.rerender('calendars');
}

async function connect(app: App, s: UiSource): Promise<void> {
  const state = microsoftState(app, s);
  if (state.busy || state.flow || !ready(app, s)) {
    return;
  }
  state.ending = null;
  if (state.connected && s.useCalendar && !(await listCalendars(app, s, true))) {
    return;
  }
  state.busy = true;
  state.busyLabel = MICROSOFT.gettingCode;
  app.rerender('calendars');
  const answer = await callServer<StartAnswer>('/microsoft/start', {
    id: s.id, tenantId: s.tenantId.trim(), clientId: s.clientId.trim(), useTeamsStatus: s.useTeamsStatus, useCalendar: s.useCalendar,
  });
  state.busy = false;
  state.busyLabel = null;
  if (answer && 'userCode' in answer) {
    state.flow = { verificationUri: answer.verificationUri, userCode: answer.userCode, copied: false };
    stopPolling(s.id);
    timers.set(s.id, window.setInterval(() => void poll(app, s), POLL_MS));
  } else if (answer && 'error' in answer && answer.error === 'refused') {
    state.ending = { kind: 'refused', reason: answer.reason, help: answer.help };
  } else {
    state.ending = { kind: 'network' };
  }
  app.rerender('calendars');
}

/** The code view (SPEC 11.3 C), in the card body's place while a code waits. */
function codeView(app: App, s: UiSource, state: MicrosoftState): HTMLElement {
  const flow = state.flow!;
  const copy = button(flow.copied ? MICROSOFT.copied : MICROSOFT.copyCode, () => {
    void copyText(flow.userCode).then((ok) => {
      if (ok && state.flow === flow) {
        flow.copied = true;
        copy.textContent = MICROSOFT.copied;
      }
    });
  }, 'btn btn-primary btn-sm');
  const href = /^https:\/\//i.test(flow.verificationUri) ? flow.verificationUri : 'https://microsoft.com/devicelogin';
  return el('div', { class: 'bl-code-view', role: 'status' },
    el('div', { class: 'fw-semibold bl-code-title' }, MICROSOFT.codeTitle),
    paragraph(MICROSOFT.codeBody, 'bl-code-body'),
    el('div', { class: 'font-monospace bl-code' }, flow.userCode),
    el('div', { class: 'bl-actions' },
      copy,
      outLink(MICROSOFT.openSignIn, href, 'btn btn-outline-primary btn-sm ns-footer-action'),
      linkButton(CALENDARS.cancel, () => {
        stopPolling(s.id);
        state.flow = null;
        void callServer('/microsoft/cancel', { id: s.id });
        app.rerender('calendars');
      }),
    ),
    paragraph(MICROSOFT.waiting, 'form-text bl-code-waiting'),
  );
}

function calendarsArea(app: App, s: UiSource, state: MicrosoftState): HTMLElement {
  const savedSource = app.saved.calendars.find((o) => o.id === s.id && o.type === s.type);
  const saved = savedSource?.calendars ?? [];
  const showRows = state.listed !== null || saved.length > 0 || s.calendars.length > 0;
  return el('div', { class: 'bl-calendars' },
    el('div', { class: 'bl-subheading' }, CALENDARS.calendarsHeading),
    el('div', { class: 'form-text ns-help bl-subheading-help' }, MICROSOFT.calendarsHelp),
    showRows ? calendarList(app, s, {
      state, saved,
      badges: (row: Row) => rowBadges(row, state, saved, { isDefault: MICROSOFT.isDefault }),
    }) : null,
    !showRows && savedSource ? paragraph(MICROSOFT.defaultCalendar, 'form-text bl-default-line') : null,
    state.error === 'signInAgain' ? paragraph(MICROSOFT.signInAgain, 'form-text bl-sign-in-again') : null,
    state.listed === null ? paragraph(CALENDARS.connectToSee, 'form-text bl-connect-line') : null,
  );
}

export function microsoftBody(app: App, s: UiSource, title: HTMLElement, nameField: (app: App, s: UiSource, title: HTMLElement) => HTMLElement): Child[] {
  const state = microsoftState(app, s);
  if (state.flow) {
    return [codeView(app, s, state)];
  }
  return [
    el('p', { class: 'form-text bl-ms-note' }, MICROSOFT.note, ' ', outLink(MICROSOFT.whatToAsk, MICROSOFT.adminUrl)),
    nameField(app, s, title),
    grid(
      gridCell(6, textField(MICROSOFT.tenantId, s.tenantId, (v) => {
        s.tenantId = v;
        app.changed();
      }, { path: sourcePath(s, 'tenantId'), required: true, monospace: true, placeholder: MICROSOFT.guidPlaceholder })),
      gridCell(6, textField(MICROSOFT.clientId, s.clientId, (v) => {
        s.clientId = v;
        app.changed();
      }, { path: sourcePath(s, 'clientId'), required: true, monospace: true, placeholder: MICROSOFT.guidPlaceholder })),
    ),
    checkboxField(MICROSOFT.useTeamsStatus, s.useTeamsStatus, (v) => {
      s.useTeamsStatus = v;
      app.changed();
      // The statuses Colors and the sensors show follow Teams status on the page (SPEC 11.3 D and E).
      statusesChanged(app);
    }, { path: sourcePath(s, 'useTeamsStatus') }),
    checkboxField(MICROSOFT.useCalendars, s.useCalendar, (v) => {
      s.useCalendar = v;
      app.changed();
      app.rerender('calendars');
      app.focusLater(sourcePath(s, 'useCalendar'));
    }, { path: sourcePath(s, 'useCalendar') }),
    s.useCalendar ? calendarsArea(app, s, state) : null,
  ];
}

/** How the last Connect ended, under the body: expired, refused with the instructions, or Microsoft not reachable. */
export function microsoftResults(app: App, s: UiSource): Child {
  const ending = microsoftState(app, s).ending;
  if (!ending) {
    return null;
  }
  switch (ending.kind) {
  case 'expired':
    return statusBox('warning', MICROSOFT.expired);
  case 'refused':
    return statusBox('danger', MICROSOFT.refused(ending.reason), ' ',
      outLink(MICROSOFT.instructions, /^https:\/\//.test(ending.help) ? ending.help : MICROSOFT.adminUrl));
  default:
    return statusBox('danger', MICROSOFT.network);
  }
}

export function microsoftFooter(app: App, s: UiSource): { left: Child[]; right: Child } {
  const state = microsoftState(app, s);
  if (state.flow) {
    return { left: [], right: null };
  }
  const left: Child[] = [];
  if (state.connected) {
    left.push(inlineConfirm({
      start: linkButton(MICROSOFT.disconnect, () => undefined, 'bl-disconnect'),
      question: MICROSOFT.disconnectQuestion,
      confirmLabel: MICROSOFT.disconnect,
      confirmClass: 'btn btn-danger btn-sm',
      cancelLabel: MICROSOFT.keep,
      open: state.disconnectOpen,
      onOpen: (open) => {
        state.disconnectOpen = open;
      },
      onConfirm: () => {
        state.disconnectOpen = false;
        state.connected = false;
        state.listed = null;
        state.error = null;
        void callServer('/microsoft/disconnect', { id: s.id });
        app.rerender('calendars');
      },
    }));
  }
  const connectButton = footerAction(state.busy && state.busyLabel ? state.busyLabel : MICROSOFT.connect, () => void connect(app, s));
  connectButton.disabled = state.busy;
  return { left, right: connectButton };
}
