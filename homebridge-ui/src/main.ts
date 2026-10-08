import { callServer, setSaveEnabled, toastError } from './api.js';
import type { App, Section, StatusData, UiState } from './app.js';
import { BANNER, CALENDARS, COLORS, INTRO, LIGHTS, RIGHT_NOW, SETTINGS, SHELL, STATUS_INPUT } from './copy.js';
import { button, clear, el, linkButton, outlineButton } from './dom.js';
import { clearDraft, readDraft, saveDraft, stableStringify } from './draft.js';
import { renderFooter, type FooterHandle } from './footer.js';
import { exportConfig, isInputKey, newInputKey, PLATFORM, readConfig, restoreSecrets, withoutSecrets, type UiConfig } from './model.js';
import { calendarsOnStatus, renderCalendars } from './sections/calendars.js';
import { renderColors } from './sections/colors.js';
import { lightsOnStatus, renderLights } from './sections/lights.js';
import { renderRightNow } from './sections/right-now.js';
import { renderSettings } from './sections/settings.js';
import { renderStatusInput, statusInputOnStatus } from './sections/status-input.js';
import { validate, type UiIssue, type ValidationContext } from './validate.js';

/**
 * The settings page (SPEC section 11): reads the platform block with `getPluginConfig`, pushes every change with
 * `updatePluginConfig`, leaves saving to the Homebridge UI's Save button (disabled while validation finds issues), and
 * asks the plugin's UI server for /status every 15 seconds while the page is open. Opening the page calls only
 * /version and /status (SPEC 11.2 addition 5), and /input/info when the status input is on (it shows the addresses).
 */

export const STATUS_POLL_MS = 15 * 1000;
/** Past this many entries the summary box collapses to a count (shell rule F4). */
export const ISSUES_SHOWN = 3;

interface SectionDef {
  key: Section;
  title: string;
  help: string;
  render(app: App, container: HTMLElement): void;
  /** Called after every /status answer; without it the section is redrawn only when it reads the status itself. */
  onStatus?(app: App, container: HTMLElement): void;
}

const SECTIONS: SectionDef[] = [
  { key: 'rightNow', title: RIGHT_NOW.heading, help: '', render: renderRightNow, onStatus: (app) => app.rerender('rightNow') },
  { key: 'calendars', title: CALENDARS.heading, help: CALENDARS.help, render: renderCalendars, onStatus: calendarsOnStatus },
  { key: 'statusInput', title: STATUS_INPUT.heading, help: '', render: renderStatusInput, onStatus: statusInputOnStatus },
  { key: 'colors', title: COLORS.heading, help: COLORS.help, render: renderColors },
  { key: 'lights', title: LIGHTS.heading, help: '', render: renderLights, onStatus: lightsOnStatus },
  { key: 'settings', title: SETTINGS.heading, help: '', render: renderSettings },
];

const CONTROLS = ':scope > .form-control, :scope > .form-select, :scope > .input-group > .form-control, :scope > .form-check-input, '
  + ':scope .ns-control';

/** True on phones and tablets: the page then gives every button a 44px touch target. */
export function isTouchDevice(): boolean {
  try {
    return (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || navigator.maxTouchPoints > 0;
  } catch {
    return false;
  }
}

export function emptyUiState(): UiState {
  return {
    chooserOpen: false, expanded: new Set(), removeOpen: null, icloud: new Map(), tests: new Map(), microsoft: new Map(),
    lifx: { searching: false, bulbs: null, testing: false, answered: null },
    input: { info: null, loading: false, failed: false, testing: false, result: null, copied: null, replaceOpen: false, revealed: false },
    resetOpen: false, resetDone: false, issuesExpanded: false,
  };
}

export class Page implements App {
  status: StatusData | null | undefined = undefined;
  readonly ui: UiState = emptyUiState();
  private readonly containers = new Map<Section, HTMLElement>();
  private readonly footer: FooterHandle;
  private readonly draftHolder: HTMLElement;
  private readonly issuesBox: HTMLElement;
  private readonly touched = new Set<string>();
  /** After Restore every field counts as touched, so the restored draft's problems show at once. */
  private allTouched = false;
  /** The messages currently shown inline, by path. A focused field only ever loses its message, never gains one. */
  private shown = new Map<string, string>();
  /** The summary box entries, by path, so a validation pass updates them in place and never replaces one under the pointer. */
  private readonly entries = new Map<string, HTMLElement>();
  private pushTimer: number | undefined;
  private pollTimer: number | undefined;
  private otherBlocks: Array<Record<string, unknown>> = [];
  /** A draft is written only once the user has changed something (shell rule M1). */
  private draftAllowed = false;

  constructor(public config: UiConfig, readonly saved: UiConfig, private readonly root: HTMLElement) {
    root.appendChild(el('img', { class: 'ns-banner', src: BANNER.file, alt: BANNER.alt, width: '1280', height: '320' }));
    this.draftHolder = el('div', { class: 'ns-draft-holder' });
    root.appendChild(this.draftHolder);
    root.appendChild(el('p', { class: 'lead-copy' }, INTRO.one));
    root.appendChild(el('p', { class: 'lead-copy' }, INTRO.two));
    root.appendChild(el('p', { class: 'form-text bl-affiliation' }, INTRO.affiliation));
    for (const section of SECTIONS) {
      const container = el('div', { class: 'section-body' });
      this.containers.set(section.key, container);
      root.appendChild(el('section', { class: 'ns-section', id: `section-${section.key}` },
        el('h2', { class: 'h5' }, section.title),
        section.help ? el('p', { class: 'section-copy' }, section.help) : null,
        container,
      ));
    }
    this.issuesBox = el('div', { class: 'alert alert-warning ns-issues', role: 'status', hidden: true });
    root.appendChild(this.issuesBox);
    root.appendChild(el('p', { class: 'lead-copy mt-3' }, INTRO.closing));
    this.footer = renderFooter();
    root.appendChild(this.footer.el);

    // Validation on blur: leaving a control touches its field; typing alone does not. Typing does clear a message the
    // moment the field is fixed, so nothing under the field moves when it is left (a button below it would otherwise
    // shift between mousedown and mouseup). A select, checkbox or radio touches its field when it changes.
    root.addEventListener('focusout', (event) => {
      if (event.target instanceof HTMLElement && event.target.matches('input, select, textarea')) {
        const path = event.target.closest<HTMLElement>('[data-path]')?.dataset.path;
        if (path) {
          this.touch(path);
        }
      }
    });
    root.addEventListener('change', (event) => {
      if (event.target instanceof HTMLElement && event.target.matches('select, input[type="checkbox"], input[type="radio"]')) {
        const path = event.target.closest<HTMLElement>('[data-path]')?.dataset.path;
        if (path) {
          this.touch(path);
        }
      }
    });
    root.addEventListener('input', (event) => {
      if (event.target instanceof HTMLElement && event.target.matches('input, select, textarea')) {
        this.markIssues(this.issues());
      }
    });
  }

  setOtherBlocks(blocks: Array<Record<string, unknown>>): void {
    this.otherBlocks = blocks;
  }

  renderAll(): void {
    for (const section of SECTIONS) {
      this.rerender(section.key);
    }
    this.revalidate();
  }

  rerender(section: Section): void {
    const container = this.containers.get(section);
    if (!container) {
      return;
    }
    // Disclosures keep their open state across a redraw, by position.
    const open = [...container.querySelectorAll('details')].map((d) => d.open);
    clear(container);
    SECTIONS.find((s) => s.key === section)?.render(this, container);
    [...container.querySelectorAll('details')].forEach((d, i) => {
      d.open = open[i] ?? d.open;
    });
    this.markIssues(this.issues());
  }

  changed(): void {
    this.draftAllowed = true;
    this.revalidate();
    this.push();
    saveDraft(exportConfig(this.config));
  }

  replaceConfig(config: UiConfig, opts: { draft?: boolean } = {}): void {
    this.config = config;
    this.touched.clear();
    this.allTouched = false;
    this.renderAll();
    this.push();
    if (opts.draft === false) {
      this.draftAllowed = false;
      clearDraft();
    } else if (this.draftAllowed) {
      saveDraft(exportConfig(this.config));
    }
  }

  touch(path: string): void {
    this.touched.add(path);
    this.markIssues(this.issues());
  }

  untouch(path: string): void {
    this.touched.delete(path);
  }

  /** Which cards show a list of calendars to tick: after Connect on this page, or the saved rows before it. */
  validationContext(): ValidationContext {
    const listsShown = new Set<string>();
    for (const s of this.config.calendars) {
      if (s.type !== 'icloud' && s.type !== 'microsoft') {
        continue;
      }
      const state = s.type === 'icloud' ? this.ui.icloud.get(s.id) : this.ui.microsoft.get(s.id);
      const saved = this.saved.calendars.find((o) => o.id === s.id && o.type === s.type);
      if (state?.listed || (saved && saved.calendars.length > 0)) {
        listsShown.add(s.id);
      }
    }
    return { listsShown };
  }

  issues(): UiIssue[] {
    return validate(this.config, this.validationContext());
  }

  focusLater(path: string): void {
    window.setTimeout(() => this.focusField(path), 0);
  }

  /** Focuses a field's own control, opening the closed card or disclosure it sits in first. */
  private focusField(path: string): void {
    const node = this.root.querySelector<HTMLElement>(`[data-path="${path}"]`);
    if (!node) {
      return;
    }
    for (let details = node.closest('details'); details; details = details.parentElement?.closest('details') ?? null) {
      details.open = true;
    }
    const control = node.querySelector<HTMLElement>('input, select, textarea');
    control?.focus();
  }

  /** A summary box entry: marks its field touched, opens its card or disclosure and moves focus to its control. */
  private jumpTo(path: string): void {
    this.touched.add(path);
    const cardId = /^calendars\.([^.]+)\./.exec(path)?.[1];
    if (cardId && !this.ui.expanded.has(cardId) && this.config.calendars.some((s) => s.id === cardId)) {
      this.ui.expanded.add(cardId);
      this.rerender('calendars');
    }
    this.markIssues(this.issues());
    this.focusField(path);
  }

  /** Asks the server for /status, then redraws Right now and the calendar cards' state pills. */
  async refreshStatus(): Promise<void> {
    const status = await callServer<StatusData | { status: null }>('/status');
    if (!status) {
      return;
    }
    this.status = 'version' in status ? status : null;
    for (const section of SECTIONS) {
      const container = this.containers.get(section.key);
      if (section.onStatus && container) {
        section.onStatus(this, container);
      }
    }
  }

  startPolling(): void {
    void callServer<{ version?: string }>('/version').then((r) => this.footer.setVersion(r?.version));
    void this.refreshStatus();
    this.pollTimer = window.setInterval(() => void this.refreshStatus(), STATUS_POLL_MS);
    window.addEventListener('pagehide', () => {
      if (this.pollTimer !== undefined) {
        window.clearInterval(this.pollTimer);
        this.pollTimer = undefined;
      }
    });
  }

  /**
   * The draft banner (shell rule M1) under the page banner, when a draft younger than a day differs from the saved
   * configuration. A draft equal to it (the changes were saved) is deleted.
   */
  offerDraft(): void {
    const draft = readDraft();
    if (!draft) {
      return;
    }
    const savedBlock = stableStringify(withoutSecrets(exportConfig(this.saved)));
    if (stableStringify(draft.config) === savedBlock) {
      clearDraft();
      return;
    }
    const close = (): void => clear(this.draftHolder);
    const banner = el('div', { class: 'alert alert-info ns-draft-banner', role: 'status' },
      el('span', { class: 'ns-draft-text' }, SHELL.draft),
      button(SHELL.restore, () => {
        close();
        const config = readConfig(draft.config);
        restoreSecrets(config, this.saved);
        if (config.statusInput.enabled && !isInputKey(config.statusInput.key)) {
          // The draft never holds the key; with none saved, the page makes one as it does when the box is ticked.
          config.statusInput.key = newInputKey();
        }
        this.draftAllowed = true;
        this.replaceConfig(config);
        this.allTouched = true;
        this.changed();
      }, 'btn btn-primary btn-sm'),
      outlineButton(SHELL.discard, () => {
        close();
        clearDraft();
      }),
    );
    this.draftHolder.appendChild(banner);
  }

  /** Pushes the block to the host without counting as a change (a fresh install, so Save can write it). */
  pushOnly(): void {
    this.push();
  }

  private revalidate(): void {
    const issues = this.issues();
    this.markIssues(issues);
    setSaveEnabled(issues.length === 0);
  }

  private push(): void {
    if (this.pushTimer !== undefined) {
      window.clearTimeout(this.pushTimer);
    }
    this.pushTimer = window.setTimeout(() => {
      this.pushTimer = undefined;
      window.homebridge.updatePluginConfig([exportConfig(this.config), ...this.otherBlocks]).catch(() => {
        toastError(SHELL.updateFailed);
      });
    }, 150);
  }

  private isTouched(path: string): boolean {
    return this.allTouched || this.touched.has(path);
  }

  /**
   * Draws the inline state of every field: the issue on a touched field as a message under it, nothing otherwise. The
   * field that has focus never gains a message; one it already shows is kept until the issue is gone. Then the
   * summary box.
   */
  private markIssues(issues: UiIssue[]): void {
    const active = document.activeElement instanceof HTMLElement ? document.activeElement.closest<HTMLElement>('[data-path]') : null;
    const activePath = active?.dataset.path;
    const byPath = new Map<string, UiIssue>();
    for (const issue of issues) {
      if (!byPath.has(issue.path)) {
        byPath.set(issue.path, issue);
      }
    }
    const shown = new Map<string, string>();
    for (const node of this.root.querySelectorAll<HTMLElement>('[data-path]')) {
      const path = node.dataset.path ?? '';
      const issue = byPath.get(path);
      let message = issue && this.isTouched(path) ? issue.message : undefined;
      if (path === activePath && message !== undefined) {
        message = this.shown.get(path);
      }
      if (message !== undefined) {
        shown.set(path, message);
      }
      const feedback = node.querySelector<HTMLElement>(':scope > .invalid-feedback');
      node.classList.toggle('has-issue', message !== undefined);
      if (feedback) {
        feedback.textContent = message ?? '';
      }
      for (const control of node.querySelectorAll<HTMLElement>(CONTROLS)) {
        control.classList.toggle('is-invalid', message !== undefined);
      }
      if (message !== undefined) {
        // An issue on a field under a collapsed disclosure would otherwise be invisible.
        for (let details = node.closest('details'); details; details = details.parentElement?.closest('details') ?? null) {
          details.open = true;
        }
      }
    }
    this.shown = shown;
    this.drawSummary(issues);
  }

  /**
   * The summary box (shell rule F4): in the page flow after Settings, "Fix these before saving:" and one entry per
   * issue reading "{Card name}: {message}", each moving focus to its field. Past three it collapses to a count with
   * Show all. Entries are updated in place, keyed by path.
   */
  private drawSummary(issues: UiIssue[]): void {
    const box = this.issuesBox;
    box.hidden = issues.length === 0;
    if (issues.length === 0) {
      clear(box);
      this.entries.clear();
      return;
    }
    let heading = box.querySelector<HTMLElement>('.ns-issues-heading');
    let count = box.querySelector<HTMLElement>('.ns-issues-count');
    let list = box.querySelector<HTMLElement>('.ns-issue-list');
    if (!heading || !count || !list) {
      clear(box);
      this.entries.clear();
      heading = el('div', { class: 'fw-semibold ns-issues-heading' }, SHELL.issuesHeading);
      count = el('div', { class: 'ns-issues-count' });
      list = el('ul', { class: 'ns-issue-list mb-0' });
      box.appendChild(heading);
      box.appendChild(count);
      box.appendChild(list);
    }
    const unique = issues.filter((issue, i) => issues.findIndex((o) => o.path === issue.path) === i);
    const collapsible = unique.length > ISSUES_SHOWN;
    clear(count);
    if (collapsible) {
      if (!this.ui.issuesExpanded) {
        count.appendChild(document.createTextNode(`${SHELL.issuesCount(unique.length)} `));
      }
      count.appendChild(linkButton(this.ui.issuesExpanded ? SHELL.issuesHide : SHELL.issuesShowAll, () => {
        this.ui.issuesExpanded = !this.ui.issuesExpanded;
        this.drawSummary(this.issues());
      }, 'ns-issues-toggle'));
    }
    count.hidden = !collapsible;
    list.hidden = collapsible && !this.ui.issuesExpanded;
    const wanted = new Set(unique.map((i) => i.path));
    for (const [path, li] of this.entries) {
      if (!wanted.has(path)) {
        li.remove();
        this.entries.delete(path);
      }
    }
    let previous: HTMLElement | null = null;
    for (const issue of unique) {
      let li = this.entries.get(issue.path);
      const text = SHELL.issue(issue.label, issue.message);
      if (!li) {
        const link = el('button', { type: 'button', class: 'btn btn-link p-0 ns-link-button ns-issue-link', 'data-issue-path': issue.path }, text);
        link.addEventListener('click', () => this.jumpTo(issue.path));
        li = el('li', {}, link);
        this.entries.set(issue.path, li);
      } else {
        const link = li.firstElementChild as HTMLElement;
        if (link.textContent !== text) {
          link.textContent = text;
        }
      }
      const expected: Element | null = previous ? previous.nextElementSibling : list.firstElementChild;
      if (expected !== li) {
        list.insertBefore(li, expected);
      }
      previous = li;
    }
  }
}

async function start(): Promise<void> {
  const root = document.getElementById('app');
  if (!root) {
    return;
  }
  if (isTouchDevice()) {
    document.body.classList.add('ns-touch');
  }
  const hb = window.homebridge;
  hb.showSpinner();
  try {
    const blocks = await hb.getPluginConfig();
    const index = blocks.findIndex((block) => block && typeof block === 'object' && block.platform === PLATFORM);
    const raw = index >= 0 ? blocks[index] : undefined;
    const saved = readConfig(raw);
    const page = new Page(readConfig(JSON.parse(JSON.stringify(exportConfig(saved)))), saved, root);
    page.setOtherBlocks(blocks.filter((_, i) => i !== index) as Array<Record<string, unknown>>);
    page.renderAll();
    page.offerDraft();
    if (index < 0) {
      // A fresh install: the block exists once Save is clicked.
      page.pushOnly();
    }
    page.startPolling();
  } catch {
    root.appendChild(el('div', { class: 'alert alert-danger' }, SHELL.loadFailed));
  } finally {
    hb.hideSpinner();
  }
}

if (typeof document !== 'undefined' && document.getElementById?.('app')) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      start().catch(() => undefined);
    });
  } else {
    start().catch(() => undefined);
  }
}
