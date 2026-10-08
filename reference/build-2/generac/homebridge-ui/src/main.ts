import { callServer, setSaveEnabled, toastError } from './api.js';
import type { App, Section, StatusData, UiState } from './app.js';
import { BANNER, INTRO, SHELL } from './copy.js';
import { clear, el } from './dom.js';
import { renderFooter, type FooterHandle } from './footer.js';
import { exportConfig, PLATFORM, readConfig, type UiConfig } from './model.js';
import { renderAccount } from './sections/account.js';
import { renderGenerators } from './sections/generators.js';
import { renderSettings } from './sections/settings.js';
import { validate, type UiIssue } from './validate.js';

/**
 * The settings page (SPEC section 11): reads the platform block with `getPluginConfig`, pushes every change with
 * `updatePluginConfig`, leaves saving to the Homebridge UI's Save button (disabled while validation finds errors),
 * and asks the plugin's UI server for /status every 15 seconds while the page is open.
 */

export const STATUS_POLL_MS = 15 * 1000;

const SECTIONS: Array<{ key: Section; title: string; help: string; render(app: App, container: HTMLElement): void }> = [
  { key: 'account', title: INTRO.accountHeading, help: INTRO.accountHelp, render: renderAccount },
  { key: 'generators', title: INTRO.generatorsHeading, help: INTRO.generatorsHelp, render: renderGenerators },
  { key: 'settings', title: INTRO.settingsHeading, help: '', render: renderSettings },
];

const CONTROLS = ':scope > .form-control, :scope > .input-group > .form-control, :scope > .form-check-input';

/** True on phones and tablets: the page then gives every button a 44px touch target. */
export function isTouchDevice(): boolean {
  try {
    return (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || navigator.maxTouchPoints > 0;
  } catch {
    return false;
  }
}

export class Page implements App {
  status: StatusData | null = null;
  readonly ui: UiState = { flow: null, disconnectOpen: false, resetOpen: false, resetDone: false, rename: null, checkingSince: null };
  private readonly containers = new Map<Section, HTMLElement>();
  private readonly footer: FooterHandle;
  private readonly touched = new Set<string>();
  /** The messages currently shown inline, by path. A focused field only ever loses its message, never gains one. */
  private shown = new Map<string, string>();
  private pushTimer: number | undefined;
  private pollTimer: number | undefined;
  private otherBlocks: Array<Record<string, unknown>> = [];
  /** True once the exercise time was prefilled from Mobile Link or the user edited it; the prefill happens once. */
  private exerciseTimeSettled: boolean;

  constructor(public config: UiConfig, private readonly root: HTMLElement) {
    this.exerciseTimeSettled = config.exerciseTime.trim().length > 0;
    root.appendChild(el('img', {
      class: 'ns-banner', src: BANNER.file, alt: `${BANNER.title}: ${BANNER.tagline}`, width: '1280', height: '320',
    }));
    root.appendChild(el('p', { class: 'lead-copy' }, INTRO.one));
    root.appendChild(el('p', { class: 'lead-copy' }, INTRO.two));
    root.appendChild(el('p', { class: 'form-text gn-affiliation' }, INTRO.affiliation));
    for (const section of SECTIONS) {
      const container = el('div', { class: 'section-body' });
      this.containers.set(section.key, container);
      root.appendChild(el('section', { class: 'ns-section', id: `section-${section.key}` },
        el('h2', { class: 'h5' }, section.title),
        section.help ? el('p', { class: 'section-copy' }, section.help) : null,
        container,
      ));
    }
    root.appendChild(el('p', { class: 'lead-copy mt-3' }, INTRO.closing));
    this.footer = renderFooter();
    root.appendChild(this.footer.el);

    // Validation on blur: leaving a control touches its field; typing alone does not. Typing does clear a message
    // the moment the field is fixed, so nothing under the field moves when it is left (a button below it would
    // otherwise shift between mousedown and mouseup).
    root.addEventListener('focusout', (event) => {
      if (event.target instanceof HTMLElement && event.target.matches('input, select, textarea')) {
        const path = event.target.closest<HTMLElement>('[data-path]')?.dataset.path;
        if (path) {
          if (path === 'exerciseTime') {
            this.exerciseTimeSettled = true;
          }
          this.touch(path);
        }
      }
    });
    root.addEventListener('input', (event) => {
      if (event.target instanceof HTMLElement && event.target.matches('input, select, textarea')) {
        this.markIssues(validate(this.config));
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
    const open = [...container.querySelectorAll('details')].map((d) => d.open);
    clear(container);
    SECTIONS.find((s) => s.key === section)?.render(this, container);
    [...container.querySelectorAll('details')].forEach((d, i) => {
      d.open = open[i] ?? d.open;
    });
    this.markIssues(validate(this.config));
  }

  changed(): void {
    this.revalidate();
    this.push();
  }

  replaceConfig(config: UiConfig): void {
    this.config = config;
    this.touched.clear();
    this.exerciseTimeSettled = true;
    this.renderAll();
    this.push();
  }

  touch(path: string): void {
    this.touched.add(path);
    this.markIssues(validate(this.config));
  }

  untouch(path: string): void {
    this.touched.delete(path);
  }

  issues(): UiIssue[] {
    return validate(this.config);
  }

  /**
   * Asks the server for /status and redraws the account card from the answer (unless the Connect flow is in
   * progress) and the generator cards (unless a Rename editor is open).
   */
  async refreshStatus(): Promise<void> {
    const status = await callServer<StatusData>('/status');
    if (!status || !status.account) {
      return;
    }
    this.status = status;
    this.footer.setVersion(status.version);
    this.prefillExerciseTime();
    if (status.account.state === 'checking') {
      this.ui.checkingSince ??= Date.now();
    } else {
      this.ui.checkingSince = null;
    }
    if (!this.ui.flow) {
      this.rerender('account');
    }
    if (!this.ui.rename) {
      this.rerender('generators');
    }
  }

  /** The Exercise time setting is prefilled from Mobile Link once (SPEC section 11.3 E) and pushed, so Save keeps it. */
  private prefillExerciseTime(): void {
    if (this.exerciseTimeSettled || !this.status) {
      return;
    }
    const fromApi = this.status.generators.map((g) => g.exerciseTimeFromApi).find((t) => typeof t === 'string' && t.length > 0);
    if (!fromApi) {
      return;
    }
    this.exerciseTimeSettled = true;
    this.config.exerciseTime = fromApi;
    const settings = this.containers.get('settings');
    if (settings && !settings.contains(document.activeElement)) {
      this.rerender('settings');
    }
    this.changed();
  }

  startPolling(): void {
    void this.refreshStatus();
    this.pollTimer = window.setInterval(() => void this.refreshStatus(), STATUS_POLL_MS);
    window.addEventListener('pagehide', () => {
      if (this.pollTimer !== undefined) {
        window.clearInterval(this.pollTimer);
        this.pollTimer = undefined;
      }
    });
  }

  private revalidate(): void {
    const issues = validate(this.config);
    this.markIssues(issues);
    setSaveEnabled(issues.length === 0);
  }

  private push(): void {
    if (this.pushTimer !== undefined) {
      window.clearTimeout(this.pushTimer);
    }
    this.pushTimer = window.setTimeout(() => {
      this.pushTimer = undefined;
      window.homebridge.updatePluginConfig([exportConfig(this.config), ...this.otherBlocks]).catch((err: unknown) => {
        toastError(`${SHELL.updateFailed} ${err instanceof Error ? err.message : String(err)}`);
      });
    }, 150);
  }

  /**
   * Draws the inline state of every field: the issue on a touched field as a message under it, nothing otherwise.
   * The field that has focus never gains a message; one it already shows is kept until the issue is gone.
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
      if (path.startsWith('connect.') || path.startsWith('generators[')) {
        // The Connect flow and the Rename editor validate their own required fields.
        this.markRequired(node, path, path === activePath);
        continue;
      }
      const issue = byPath.get(path);
      let message = issue && this.touched.has(path) ? issue.message : undefined;
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
        // An issue on a field under the collapsed disclosure would otherwise be invisible.
        for (let details = node.closest('details'); details; details = details.parentElement?.closest('details') ?? null) {
          details.open = true;
        }
      }
    }
    this.shown = shown;
  }

  /** "{Label} is required." for the Connect fields once touched (SPEC section 11.2); a focused field only loses it. */
  private markRequired(node: HTMLElement, path: string, focused: boolean): void {
    if (!path.startsWith('connect.') || !this.touched.has(path)) {
      return;
    }
    const control = node.querySelector<HTMLInputElement>(CONTROLS);
    const label = node.querySelector<HTMLElement>('label')?.firstChild?.textContent?.trim() ?? '';
    const missing = !!control && control.value.trim() === '' && (!focused || node.classList.contains('has-issue'));
    node.classList.toggle('has-issue', missing);
    control?.classList.toggle('is-invalid', missing);
    const feedback = node.querySelector<HTMLElement>(':scope > .invalid-feedback');
    if (feedback) {
      feedback.textContent = missing ? `${label} is required.` : '';
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
    const page = new Page(readConfig(raw), root);
    page.setOtherBlocks(blocks.filter((_, i) => i !== index));
    page.renderAll();
    if (index < 0) {
      // A fresh install: the block exists once Save is clicked.
      page.changed();
    }
    page.startPolling();
  } catch (err) {
    root.appendChild(el('div', { class: 'alert alert-danger' }, `${SHELL.loadFailed} ${err instanceof Error ? err.message : String(err)}`));
  } finally {
    hb.hideSpinner();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    start().catch(() => undefined);
  });
} else {
  start().catch(() => undefined);
}
