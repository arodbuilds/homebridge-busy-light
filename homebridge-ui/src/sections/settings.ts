/**
 * Settings (SPEC 11.3 F): one collapsed Advanced disclosure holding the platform's own settings, in the order of the
 * SPEC, and Reset plugin to fresh install with its inline dialog and done state.
 */

import { callServer } from '../api.js';
import type { App } from '../app.js';
import { SETTINGS, SHELL } from '../copy.js';
import { button, checkboxField, dangerLinkButton, disclosure, el, grid, gridCell, inlineDialog, linkButton, numberField, reveal, textField } from '../dom.js';
import { emptyConfig, LIMITS } from '../model.js';
import { stopMicrosoft } from './microsoft.js';

/**
 * The Reset dialog: the three lines of SPEC 11.3 F, "Type RESET to confirm.", Confirm disabled until RESET is typed in
 * any case. It renders inline directly below the Reset link (SPEC 11.2) and is page state, so a redraw keeps it open;
 * opening it by click focuses the field and scrolls the host modal to the dialog.
 */
function resetDialog(app: App, opened: boolean): HTMLElement {
  const confirmInput = el('input', { type: 'text', class: 'form-control', autocomplete: 'off', spellcheck: 'false', id: 'bl-reset-confirm' });
  let close: () => void = () => undefined;
  const confirm = button(SHELL.resetConfirm, () => {
    close();
    for (const s of app.config.calendars) {
      stopMicrosoft(app, s);
    }
    // Sign out and forget the saved state on the server; the platform removes the accessories on its next start.
    void callServer('/reset').then(() => app.refreshStatus());
    const ui = app.ui;
    ui.resetDone = true;
    ui.chooserOpen = false;
    ui.expanded.clear();
    ui.removeOpen = null;
    ui.icloud.clear();
    ui.tests.clear();
    ui.microsoft.clear();
    ui.lifx = { searching: false, bulbs: null, testing: false, answered: null };
    app.replaceConfig(emptyConfig(), { draft: false });
    const done = document.querySelector<HTMLElement>('.bl-reset-done');
    if (done) {
      reveal(done);
    }
  }, 'btn btn-danger btn-sm');
  confirm.disabled = true;
  confirmInput.addEventListener('input', () => {
    confirm.disabled = confirmInput.value.trim().toUpperCase() !== 'RESET';
  });
  const dialog = inlineDialog({
    title: SHELL.resetTitle,
    body: el('div', {},
      el('ul', { class: 'ps-3' }, ...SETTINGS.resetLines.map((line) => el('li', {}, line))),
      el('label', { class: 'form-label', for: 'bl-reset-confirm' }, SHELL.resetPrompt),
      confirmInput,
    ),
    actions: [confirm, linkButton(SHELL.resetCancel, () => close())],
    onClose: () => {
      app.ui.resetOpen = false;
    },
  });
  close = dialog.close;
  if (opened) {
    window.setTimeout(() => {
      confirmInput.focus();
      reveal(dialog.el);
    }, 0);
  }
  return dialog.el;
}

/** The done state after Confirm: the dialog's place on the page, a card with the title and one line. It stays until a reload. */
function resetDoneState(): HTMLElement {
  return el('div', { class: 'card ns-inline-dialog bl-reset-done', role: 'status' },
    el('div', { class: 'ns-inline-dialog-title fw-semibold' }, SETTINGS.resetDoneTitle),
    el('div', { class: 'ns-inline-dialog-body' }, el('p', { class: 'mb-0' }, SETTINGS.resetDoneBody)),
  );
}

function resetControl(app: App): HTMLElement {
  const holder = el('div', { class: 'bl-reset' });
  if (app.ui.resetDone) {
    holder.appendChild(resetDoneState());
    return holder;
  }
  const link = dangerLinkButton(SHELL.reset, () => {
    if (app.ui.resetOpen) {
      return;
    }
    app.ui.resetOpen = true;
    holder.appendChild(resetDialog(app, true));
  });
  holder.appendChild(link);
  if (app.ui.resetOpen) {
    holder.appendChild(resetDialog(app, false));
  }
  return holder;
}

export function renderSettings(app: App, container: HTMLElement): void {
  const c = app.config;
  const fields = grid(
    gridCell(6, textField(SETTINGS.name, c.name, (v) => {
      c.name = v;
      app.changed();
      // The sensors' names and the automation steps under Lights follow the name.
      app.rerender('lights');
    }, { path: 'name', required: true, help: SETTINGS.nameHelp, maxlength: 64 })),
    gridCell(6),
    gridCell(6, numberField(SETTINGS.pollSeconds, c.pollSeconds, (v) => {
      c.pollSeconds = v;
      app.changed();
    }, { path: 'pollSeconds', min: LIMITS.pollSeconds[0], max: LIMITS.pollSeconds[1] })),
    gridCell(6, numberField(SETTINGS.calendarSeconds, c.calendarSeconds, (v) => {
      c.calendarSeconds = v;
      app.changed();
    }, { path: 'calendarSeconds', min: LIMITS.calendarSeconds[0], max: LIMITS.calendarSeconds[1] })),
    gridCell(12, checkboxField(SETTINGS.ignoreAllDayBusy, c.ignoreAllDayBusy, (v) => {
      c.ignoreAllDayBusy = v;
      app.changed();
    }, { path: 'ignoreAllDayBusy', help: SETTINGS.ignoreAllDayBusyHelp })),
    gridCell(12, textField(SETTINGS.outOfOfficeWords, c.outOfOfficeWords, (v) => {
      c.outOfOfficeWords = v;
      app.changed();
    }, { path: 'outOfOfficeWords', help: SETTINGS.outOfOfficeWordsHelp })),
    gridCell(12, checkboxField(SETTINGS.overrideSwitch, c.overrideSwitch, (v) => {
      c.overrideSwitch = v;
      app.changed();
    }, { path: 'overrideSwitch', help: SETTINGS.overrideSwitchHelp })),
    gridCell(12, checkboxField(SETTINGS.debug, c.debug, (v) => {
      c.debug = v;
      app.changed();
    }, { path: 'debug', help: SETTINGS.debugHelp })),
  );
  container.appendChild(disclosure(SHELL.advanced, [fields, resetControl(app)], { cls: 'bl-settings' }));
}
