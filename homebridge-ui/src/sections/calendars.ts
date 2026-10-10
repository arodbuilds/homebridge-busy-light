/**
 * Calendars (SPEC 11.3 C): one card per source, then Add calendar, which opens the chooser tiles in its place. Each
 * card's header holds the name (live as typed), the type badge, the state pill from the state file and the Last
 * checked meta, and opens and closes the card. iCloud lists its calendars after Connect; Google Calendar and Calendar
 * URL test their address; Microsoft 365 signs in from the card (microsoft.ts).
 */

import { callServer } from '../api.js';
import type { App, ListState, StatusSource, TestResult } from '../app.js';
import { badge, card, cardName, type BadgeKind } from '../card.js';
import { CALENDARS, CHOOSER, GOOGLE, ICLOUD, OUTLOOK, PILLS, SHELL, SOURCE_TYPES, TEST, URL_CARD } from '../copy.js';
import * as RETIRING from '../retiring.js';
import {
  clear, dangerLinkButton, disclosure, el, footerAction, grid, gridCell, inlineConfirm, outLink, outlineButton, paragraph, passwordField,
  primaryButton, selectField, statusBox, textField, type Child,
} from '../dom.js';
import { formatDuration, parseDate, relativeTime } from '../format.js';
import { intervalOptions, SAME_AS_SETTINGS } from '../intervals.js';
import { emptySource, INTERVALS, newId, SOURCE_TYPES as TYPES, type SourceType, type UiSource } from '../model.js';
import { cardLabel, sourcePath } from '../validate.js';
import { adoptIds, calendarList, rowBadges, type Row } from './calendar-list.js';
import { statusesChanged } from './colors.js';
import { microsoftBody, microsoftFooter, microsoftOnStatus, microsoftResults, stopMicrosoft } from './microsoft.js';

const PILL_KIND: Record<StatusSource['state'], BadgeKind> = {
  connected: 'connected', checking: 'checking', signInNeeded: 'warning', notReachable: 'danger',
};

/** The saved source this card edits, if it is in the saved configuration. */
export function savedSource(app: App, s: UiSource): UiSource | undefined {
  return app.saved.calendars.find((o) => o.id === s.id && o.type === s.type);
}

/** The state file's entry for this card (SPEC 11.2 addition 6). */
export function statusEntry(app: App, s: UiSource): StatusSource | undefined {
  return app.status?.sources.find((e) => e.id === s.id);
}

export function listState(app: App, s: UiSource): ListState {
  let state = app.ui.icloud.get(s.id);
  if (!state) {
    state = { busy: false, listed: null, tickedBefore: new Set(), error: null };
    app.ui.icloud.set(s.id, state);
  }
  return state;
}

/** The header's pill, meta and the error line under it: the state file's view, or Not saved yet. */
function statusParts(app: App, s: UiSource): { pill: HTMLElement | null; meta: string | null; notice: HTMLElement | null } {
  if (!savedSource(app, s)) {
    return { pill: badge(PILLS.notSaved, 'checking'), meta: null, notice: null };
  }
  const entry = statusEntry(app, s);
  if (!entry) {
    return { pill: null, meta: null, notice: null };
  }
  const checked = parseDate(entry.lastChecked);
  const kind = PILL_KIND[entry.state] ?? 'checking';
  return {
    pill: badge(PILLS[entry.state] ?? PILLS.checking, kind),
    meta: checked ? CALENDARS.lastChecked(relativeTime(checked)) : null,
    notice: entry.error ? el('div', { class: `bl-card-error bl-tone-${kind}`, role: 'status' }, entry.error) : null,
  };
}

/** The state pills, metas and error lines of every card, redrawn in place from /status so nothing being typed is lost. */
export function calendarsOnStatus(app: App, container: HTMLElement): void {
  if (microsoftOnStatus(app) && !container.contains(document.activeElement)) {
    app.rerender('calendars');
    return;
  }
  for (const s of app.config.calendars) {
    const node = container.querySelector<HTMLElement>(`[data-card-id="${s.id}"]`);
    if (!node) {
      continue;
    }
    const parts = statusParts(app, s);
    const holder = node.querySelector<HTMLElement>('.bl-pill-holder');
    if (holder) {
      clear(holder);
      if (parts.pill) {
        holder.appendChild(parts.pill);
      }
    }
    const header = node.querySelector<HTMLElement>('.ns-card-header');
    header?.querySelector('.ns-card-meta')?.remove();
    if (header && parts.meta) {
      header.appendChild(el('span', { class: 'ns-card-meta' }, parts.meta));
    }
    node.querySelector('.bl-card-error')?.remove();
    if (header && parts.notice) {
      header.parentNode?.insertBefore(parts.notice, header.nextSibling);
    }
  }
}

/** Name: every card's first field. The header follows it as it is typed. */
function nameField(app: App, s: UiSource, title: HTMLElement): HTMLElement {
  return textField(CALENDARS.name, s.name, (v) => {
    s.name = v;
    title.textContent = cardLabel(s);
    app.changed();
  }, { path: sourcePath(s, 'name'), required: true, placeholder: CALENDARS.namePlaceholder, help: CALENDARS.nameHelp, maxlength: 64 });
}

/** Counts for, on a Google Calendar or Calendar URL card itself. */
function countsFor(app: App, s: UiSource): HTMLElement {
  return selectField(CALENDARS.countsFor, s.use, [
    { value: 'all', label: CALENDARS.countsAll },
    { value: 'outOfOffice', label: CALENDARS.countsOutOfOffice },
  ], (v) => {
    s.use = v === 'outOfOffice' ? 'outOfOffice' : 'all';
    app.changed();
  }, { path: sourcePath(s, 'use'), help: CALENDARS.countsHelp });
}

/** True when the fields a request needs are filled in and valid; otherwise they are marked so their messages show. */
function ready(app: App, s: UiSource, fields: string[]): boolean {
  const paths = fields.map((f) => sourcePath(s, f));
  const bad = app.issues().filter((i) => paths.includes(i.path));
  for (const issue of bad) {
    app.touch(issue.path);
  }
  return bad.length === 0;
}

// ---------------------------------------------------------------------------
// iCloud
// ---------------------------------------------------------------------------

type ICloudAnswer = { calendars: Array<{ id: string; name: string; shared: boolean; subscribed: boolean; eventsToday: number | null }> }
  | { error: 'rejected' | 'network' | 'unexpected' };

const ICLOUD_ERRORS = { rejected: RETIRING.ICLOUD.rejected, network: ICLOUD.network, unexpected: ICLOUD.unexpected };

async function connectICloud(app: App, s: UiSource): Promise<void> {
  const state = listState(app, s);
  if (state.busy || !ready(app, s, ['appleId', 'appPassword'])) {
    return;
  }
  state.busy = true;
  state.error = null;
  app.rerender('calendars');
  // Only the two fields this call needs leave the page (SPEC 10.3 item 7).
  const answer = await callServer<ICloudAnswer>('/icloud/calendars', { appleId: s.appleId.trim(), appPassword: s.appPassword });
  state.busy = false;
  if (answer && 'calendars' in answer) {
    state.listed = answer.calendars;
    adoptIds(s, answer.calendars.map((c) => ({ ...c, isDefault: false })));
    for (const choice of s.calendars) {
      if (choice.id !== null) {
        state.tickedBefore.add(choice.id);
      }
    }
  } else {
    state.error = answer && 'error' in answer && answer.error in ICLOUD_ERRORS ? answer.error : 'network';
  }
  app.changed();
  app.rerender('calendars');
}

/** The App-specific password help, with account.apple.com as a link, then "How to create one" (SPEC 11.3 C, 17). */
function appPasswordHelp(): Child[] {
  const [before, after] = RETIRING.ICLOUD.appPasswordHelp.split(ICLOUD.accountSite);
  return [before, outLink(ICLOUD.accountSite, ICLOUD.accountUrl), after, ' ', outLink(ICLOUD.howTo, ICLOUD.howToUrl)];
}

function icloudBody(app: App, s: UiSource, title: HTMLElement): Child[] {
  const state = listState(app, s);
  const saved = savedSource(app, s)?.calendars ?? [];
  const showRows = state.listed !== null || saved.length > 0 || s.calendars.length > 0;
  return [
    nameField(app, s, title),
    grid(
      gridCell(6, textField(RETIRING.ICLOUD.appleId, s.appleId, (v) => {
        s.appleId = v;
        app.changed();
      }, {
        path: sourcePath(s, 'appleId'), required: true, type: 'email', placeholder: ICLOUD.appleIdPlaceholder, autocomplete: 'username', inputmode: 'email',
      })),
      gridCell(6, passwordField(ICLOUD.appPassword, s.appPassword, (v) => {
        s.appPassword = v;
        app.changed();
      }, { path: sourcePath(s, 'appPassword'), required: true, help: appPasswordHelp() })),
    ),
    el('div', { class: 'bl-calendars' },
      el('div', { class: 'bl-subheading' }, CALENDARS.calendarsHeading),
      el('div', { class: 'form-text ns-help bl-subheading-help' }, ICLOUD.calendarsHelp),
      showRows ? calendarList(app, s, {
        state, saved,
        badges: (row: Row) => rowBadges(row, state, saved, {}),
        disabledLine: (row: Row) => (row.subscribed ? ICLOUD.subscribed : null),
      }) : null,
      state.listed === null ? paragraph(CALENDARS.connectToSee, 'form-text bl-connect-line') : null,
    ),
  ];
}

// ---------------------------------------------------------------------------
// Google Calendar and Calendar URL
// ---------------------------------------------------------------------------

function testState(app: App, s: UiSource): { busy: boolean; result: TestResult | null } {
  let state = app.ui.tests.get(s.id);
  if (!state) {
    state = { busy: false, result: null };
    app.ui.tests.set(s.id, state);
  }
  return state;
}

function hostName(url: string): string {
  try {
    return new URL(url.trim().replace(/^webcal:/i, 'https:')).host;
  } catch {
    return '';
  }
}

async function testAddress(app: App, s: UiSource): Promise<void> {
  const state = testState(app, s);
  if (state.busy || !ready(app, s, s.type === 'google' ? ['url', 'email'] : ['url'])) {
    return;
  }
  state.busy = true;
  state.result = null;
  app.rerender('calendars');
  const payload: Record<string, string> = { url: s.url.trim() };
  if (s.type === 'google' && s.email.trim()) {
    payload.email = s.email.trim();
  }
  const answer = await callServer<TestResult>('/url/test', payload);
  state.busy = false;
  state.result = answer ?? { error: 'network', host: hostName(s.url) };
  app.rerender('calendars');
}

/** The Test result line (SPEC 11.3 C), in the success or danger tone. */
function testResult(s: UiSource, result: TestResult): HTMLElement {
  if ('eventsToday' in result) {
    return statusBox('success', TEST.result(result.eventsToday));
  }
  switch (result.error) {
  case 'insecure':
    return statusBox('danger', TEST.insecure);
  case 'notCalendar':
    return statusBox('danger', s.type === 'google' ? `${TEST.notCalendar} ${TEST.notCalendarGoogle}` : TEST.notCalendar);
  case 'http':
    return statusBox('danger', TEST.http(result.host, String(result.code ?? '')));
  case 'tooLarge':
    return statusBox('danger', TEST.tooLarge);
  default:
    return statusBox('danger', TEST.network(result.host));
  }
}

/** The hosts of an Outlook published calendar link (SPEC 11.3 C). */
const OUTLOOK_HOSTS = ['outlook.office365.com', 'outlook.office.com', 'outlook.live.com'];

/** How to get a published Outlook link: the three steps, the help when publishing is turned off, and the link to Outlook. */
function outlookSteps(): HTMLElement {
  return el('div', { class: 'bl-outlook-steps' },
    el('ol', { class: 'ns-steps' }, ...OUTLOOK.steps.map((step, i) => el('li', { class: 'ns-step' },
      el('span', { class: 'ns-step-number', 'aria-hidden': 'true' }, String(i + 1)),
      el('span', { class: 'ns-step-text' }, step),
    ))),
    el('p', { class: 'form-text bl-outlook-missing' }, OUTLOOK.missing, ' ', outLink(OUTLOOK.open, OUTLOOK.url)),
  );
}

/**
 * Above the Address of a Calendar URL card (SPEC 11.3 C, from build 3.1): the steps, open, on a card added as a
 * published Outlook link on this page; collapsed under How to get this link on any other card whose address is on an
 * Outlook host; nothing otherwise.
 */
function outlookBlock(app: App, s: UiSource): HTMLElement | null {
  if (app.ui.outlookCards.has(s.id)) {
    return outlookSteps();
  }
  if (OUTLOOK_HOSTS.includes(hostName(s.url).toLowerCase())) {
    return disclosure(OUTLOOK.howTo, [outlookSteps()], { cls: 'bl-outlook-howto' });
  }
  return null;
}

function addressBody(app: App, s: UiSource, title: HTMLElement): Child[] {
  if (s.type === 'google') {
    return [
      nameField(app, s, title),
      passwordField(GOOGLE.secret, s.url, (v) => {
        s.url = v;
        app.changed();
      }, { path: sourcePath(s, 'url'), required: true, help: GOOGLE.secretHelp }),
      textField(GOOGLE.email, s.email, (v) => {
        s.email = v;
        app.changed();
      }, { path: sourcePath(s, 'email'), type: 'email', placeholder: GOOGLE.emailPlaceholder, help: GOOGLE.emailHelp, inputmode: 'email' }),
      countsFor(app, s),
    ];
  }
  return [
    nameField(app, s, title),
    outlookBlock(app, s),
    textField(URL_CARD.address, s.url, (v) => {
      s.url = v;
      app.changed();
    }, { path: sourcePath(s, 'url'), required: true, help: RETIRING.URL_ADDRESS_HELP, inputmode: 'url' }),
    countsFor(app, s),
  ];
}

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

function removeSource(app: App, s: UiSource): void {
  stopMicrosoft(app, s);
  app.config.calendars = app.config.calendars.filter((o) => o !== s);
  app.ui.expanded.delete(s.id);
  app.ui.icloud.delete(s.id);
  app.ui.tests.delete(s.id);
  app.ui.removeOpen = null;
  app.changed();
  app.rerender('calendars');
  if (s.type === 'microsoft') {
    statusesChanged(app);
  }
}

/** The card select's `Same as Settings ({duration})` option, with the platform interval as edited (SPEC 11.3 C). */
function sameAsSettings(app: App): string {
  return CALENDARS.sameAsSettings(formatDuration(app.config.calendarSeconds));
}

/** After Reload calendars every changes under Settings, every card's `Same as Settings` option follows it, in place. */
export function followPlatformInterval(app: App): void {
  for (const option of document.querySelectorAll<HTMLElement>('#section-calendars option.bl-same-as-settings')) {
    option.textContent = sameAsSettings(app);
  }
}

/**
 * The card's own check interval (SPEC 11.3 C, 9.1 item 19), a select under an Advanced disclosure at the bottom of the
 * body: `Same as Settings` saves no `calendarSeconds`; the others save their seconds.
 */
function intervalField(app: App, s: UiSource): HTMLElement {
  const saved = savedSource(app, s)?.calendarSeconds ?? null;
  const options = [
    { value: SAME_AS_SETTINGS, label: sameAsSettings(app), cls: 'bl-same-as-settings' },
    ...intervalOptions(INTERVALS.sourceCalendarSeconds, s.calendarSeconds, saved),
  ];
  const value = s.calendarSeconds === null ? SAME_AS_SETTINGS : String(s.calendarSeconds);
  const select = selectField(CALENDARS.checkEvery, value, options, (v) => {
    s.calendarSeconds = v === SAME_AS_SETTINGS ? null : Number(v);
    app.changed();
  }, { path: sourcePath(s, 'calendarSeconds'), help: CALENDARS.checkEveryHelp });
  return disclosure(SHELL.advanced, [grid(gridCell(6, select))], { cls: 'bl-source-advanced', open: s.calendarSeconds !== null });
}

function sourceCard(app: App, s: UiSource): HTMLElement {
  const title = cardName(cardLabel(s));
  const parts = statusParts(app, s);
  const expanded = app.ui.expanded.has(s.id);
  let body: Child[] = [];
  let results: Child = null;
  let footerRight: Child = null;
  const footerLeft: Child[] = [];
  if (expanded) {
    footerLeft.push(inlineConfirm({
      start: dangerLinkButton(CALENDARS.remove, () => undefined),
      question: CALENDARS.removeQuestion(cardLabel(s)),
      confirmLabel: CALENDARS.remove,
      confirmClass: 'btn btn-danger btn-sm',
      cancelLabel: CALENDARS.cancel,
      open: app.ui.removeOpen === s.id,
      onOpen: (open) => {
        app.ui.removeOpen = open ? s.id : null;
      },
      onConfirm: () => removeSource(app, s),
    }));
    if (s.type === 'icloud') {
      const state = listState(app, s);
      body = icloudBody(app, s, title);
      results = state.error ? statusBox('danger', ICLOUD_ERRORS[state.error as keyof typeof ICLOUD_ERRORS] ?? ICLOUD.network) : null;
      const connect = footerAction(state.busy ? ICLOUD.connecting : state.listed ? ICLOUD.refresh : ICLOUD.connect, () => void connectICloud(app, s));
      connect.disabled = state.busy;
      footerRight = connect;
    } else if (s.type === 'google' || s.type === 'url') {
      const state = testState(app, s);
      body = addressBody(app, s, title);
      results = state.result ? testResult(s, state.result) : null;
      const test = footerAction(state.busy ? TEST.testing : TEST.test, () => void testAddress(app, s));
      test.disabled = state.busy;
      footerRight = test;
    } else {
      body = microsoftBody(app, s, title, nameField);
      results = microsoftResults(app, s);
      const footer = microsoftFooter(app, s);
      footerLeft.push(...footer.left);
      footerRight = footer.right;
    }
    // Every card type, except while the Microsoft code view stands in the body's place.
    if (!(s.type === 'microsoft' && app.ui.microsoft.get(s.id)?.flow)) {
      body = [...body, intervalField(app, s)];
    }
  }
  return card({
    title,
    badges: [badge(s.type === 'microsoft' ? RETIRING.MICROSOFT_TITLE : SOURCE_TYPES[s.type].title, 'type'),
      el('span', { class: 'bl-pill-holder' }, parts.pill)],
    meta: parts.meta,
    notice: parts.notice,
    toggle: {
      expanded,
      onToggle: () => {
        if (app.ui.expanded.has(s.id)) {
          app.ui.expanded.delete(s.id);
        } else {
          app.ui.expanded.add(s.id);
        }
        app.rerender('calendars');
        document.querySelector<HTMLElement>(`[data-card-id="${s.id}"] .ns-card-toggle`)?.focus();
      },
    },
    body,
    results,
    footerLeft,
    footerRight,
    cls: `bl-source-card bl-source-${s.type}`,
    attrs: { 'data-card-id': s.id },
  });
}

/**
 * Adds a card of the chosen type: a new id (SPEC 11.2 addition 3), open, with its Name field taking focus. A published
 * Outlook link is a Calendar URL card named Outlook, with its steps open and the Address taking focus (11.3 C).
 */
function addSource(app: App, type: SourceType, outlook = false): void {
  const s = emptySource(type, newId());
  if (outlook) {
    s.name = OUTLOOK.name;
    app.ui.outlookCards.add(s.id);
  }
  app.config.calendars.push(s);
  app.ui.expanded.add(s.id);
  app.ui.chooserOpen = false;
  app.ui.chooserOutlook = false;
  app.changed();
  app.rerender('calendars');
  if (type === 'microsoft') {
    statusesChanged(app);
  }
  app.focusLater(sourcePath(s, outlook ? 'url' : 'name'));
}

/** One of the two Outlook or Microsoft 365 options: a tile with its title, an optional badge, and its text. */
function outlookOption(title: string, text: string, cls: string, onChoose: () => void, recommended = false): HTMLButtonElement {
  const option = el('button', { type: 'button', class: `ns-chooser-tile bl-outlook-option ${cls}` },
    el('span', { class: 'ns-tile-title' }, title, recommended ? ' ' : null, recommended ? badge(CHOOSER.recommended, 'connected') : null),
    el('span', { class: 'form-text ns-tile-help' }, text),
  );
  option.addEventListener('click', onChoose);
  return option;
}

/**
 * The chooser (shell rule R2): four tiles in Add calendar's place, and Cancel. Outlook or Microsoft 365 shows its two
 * options inline below the tiles (SPEC 11.3 C, from build 3.1): the published link first, recommended, then sign-in.
 */
function chooser(app: App): HTMLElement {
  const tiles = TYPES.map((type) => {
    const outlook = type === 'microsoft';
    const expanded = outlook ? String(app.ui.chooserOutlook) : undefined;
    const tile = el('button', { type: 'button', class: 'ns-chooser-tile', 'data-type': type, 'aria-expanded': expanded },
      el('span', { class: 'ns-tile-title' }, outlook ? CHOOSER.outlookTitle : SOURCE_TYPES[type].title),
      el('span', { class: 'form-text ns-tile-help' }, outlook ? CHOOSER.outlookHelp : SOURCE_TYPES[type].help),
    );
    tile.addEventListener('click', () => {
      if (!outlook) {
        addSource(app, type);
        return;
      }
      app.ui.chooserOutlook = true;
      app.rerender('calendars');
      document.querySelector<HTMLElement>('#section-calendars .bl-outlook-option')?.focus();
    });
    return tile;
  });
  const options = app.ui.chooserOutlook
    ? el('div', { class: 'ns-chooser-tiles bl-outlook-options' },
      outlookOption(CHOOSER.published, CHOOSER.publishedText, 'bl-outlook-published', () => addSource(app, 'url', true), true),
      outlookOption(RETIRING.CHOOSER_SIGN_IN, CHOOSER.signInText, 'bl-outlook-signin', () => addSource(app, 'microsoft')),
    )
    : null;
  return el('div', { class: 'ns-chooser' },
    el('div', { class: 'ns-chooser-tiles' }, ...tiles),
    options,
    outlineButton(CALENDARS.cancel, () => {
      app.ui.chooserOpen = false;
      app.ui.chooserOutlook = false;
      app.rerender('calendars');
      document.querySelector<HTMLElement>('#section-calendars .ns-section-add')?.focus();
    }),
  );
}

export function renderCalendars(app: App, container: HTMLElement): void {
  if (app.config.calendars.length === 0) {
    container.appendChild(paragraph(CALENDARS.empty, 'bl-empty'));
  }
  for (const s of app.config.calendars) {
    container.appendChild(sourceCard(app, s));
  }
  if (app.ui.chooserOpen) {
    container.appendChild(chooser(app));
  } else {
    container.appendChild(el('div', { class: 'bl-actions' }, primaryButton(CALENDARS.add, () => {
      app.ui.chooserOpen = true;
      app.rerender('calendars');
      document.querySelector<HTMLElement>('#section-calendars .ns-chooser-tile')?.focus();
    })));
  }
}
