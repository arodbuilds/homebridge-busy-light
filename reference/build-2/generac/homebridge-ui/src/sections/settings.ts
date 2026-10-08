/**
 * The Settings section (SPEC section 11.3 E): one collapsed disclosure holding every platform setting, and the
 * Reset dialog. Validation runs on blur through the page; the messages come from copy.ts.
 */

import { callServer, toastSuccess } from '../api.js';
import type { App } from '../app.js';
import { SETTINGS, SHELL } from '../copy.js';
import {
  button, checkboxField, dangerLinkButton, disclosure, el, grid, gridCell, inlineDialog, linkButton, numberField, reveal, textField,
} from '../dom.js';
import { formatVolts } from '../format.js';
import { DEFAULTS, emptyConfig } from '../model.js';
import { hasOneDecimal } from '../validate.js';

/**
 * The Reset dialog: the three lines from SPEC section 11.3 E, "Type RESET to confirm.", Confirm disabled until
 * RESET is typed in any case. It renders inline directly below the Reset link (SPEC section 11.2) and is page state,
 * so a redraw of the section keeps it open; opening it by click focuses the field and scrolls the host modal to the
 * dialog. Confirm redraws the page with the done state in the dialog's place and scrolls the host to it.
 */
function resetDialog(app: App, opened: boolean): HTMLElement {
  const confirmInput = el('input', { type: 'text', class: 'form-control', autocomplete: 'off', spellcheck: 'false', id: 'gn-reset-confirm' });
  let close: () => void = () => undefined;
  const confirm = button(SHELL.resetConfirm, () => {
    close();
    // The done state replaces the dialog in place when the page is redrawn below (SPEC section 11.3 E).
    app.ui.resetDone = true;
    // Sign out and forget the saved state on the server; the platform removes the accessories on its next start.
    void callServer('/reset').then(() => app.refreshStatus());
    if (app.status) {
      app.status.account = { state: 'not_connected' };
    }
    app.ui.flow = null;
    app.ui.disconnectOpen = false;
    app.ui.rename = null;
    app.replaceConfig(emptyConfig());
    toastSuccess(SHELL.resetDone);
    const done = document.querySelector<HTMLElement>('.gn-reset-done');
    if (done) {
      reveal(done);
    }
  }, 'btn btn-danger btn-sm');
  confirm.disabled = true;
  confirmInput.addEventListener('input', () => {
    // RESET in any case (SPEC section 11.3 E); the prompt still reads "Type RESET to confirm."
    confirm.disabled = confirmInput.value.trim().toUpperCase() !== 'RESET';
  });
  const dialog = inlineDialog({
    title: SHELL.resetTitle,
    body: el('div', {},
      el('ul', { class: 'ps-3' }, ...SETTINGS.resetLines.map((line) => el('li', {}, line))),
      el('label', { class: 'form-label', for: 'gn-reset-confirm' }, SHELL.resetPrompt),
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

/**
 * The done state after Confirm (SPEC section 11.3 E): the dialog's place on the page, a card with the title and one
 * line, no buttons. It stays until the page reloads.
 */
function resetDoneState(): HTMLElement {
  return el('div', { class: 'card ns-inline-dialog gn-reset-done', role: 'status' },
    el('div', { class: 'ns-inline-dialog-title fw-semibold' }, SETTINGS.resetDoneTitle),
    el('div', { class: 'ns-inline-dialog-body' }, el('p', { class: 'mb-0' }, SETTINGS.resetDoneBody)),
  );
}

/** The Reset link, with the dialog directly below it while open; after Confirm, only the done state. */
function resetControl(app: App): HTMLElement {
  const holder = el('div', { class: 'gn-reset' });
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
    }, { path: 'name', required: true })),
    gridCell(6),
    gridCell(6, numberField(SETTINGS.pollIdle, c.pollIdleMinutes, (v) => {
      c.pollIdleMinutes = v;
      app.changed();
    }, { path: 'pollIdleMinutes', min: DEFAULTS.pollIdleMinutesMin, help: SETTINGS.pollIdleHelp })),
    gridCell(6, numberField(SETTINGS.pollActive, c.pollActiveSeconds, (v) => {
      c.pollActiveSeconds = v;
      app.changed();
    }, { path: 'pollActiveSeconds', min: DEFAULTS.pollActiveSecondsMin, help: SETTINGS.pollActiveHelp })),
    gridCell(6, numberField(SETTINGS.batteryLow, c.batteryLowVoltage, (v) => {
      c.batteryLowVoltage = v;
      app.changed();
    }, {
      path: 'batteryLowVoltage', step: '0.1', help: SETTINGS.batteryLowHelp,
      // One decimal place on load and after blur (12.0, 11.8); more than one keeps its text and its message (SPEC section 11.3 E).
      format: (v) => (hasOneDecimal(v) ? formatVolts(v) : null),
    })),
    gridCell(6),
    gridCell(12, checkboxField(SETTINGS.faultOnStopped, c.faultOnStopped, (v) => {
      c.faultOnStopped = v;
      app.changed();
    }, { path: 'faultOnStopped', help: SETTINGS.faultOnStoppedHelp })),
    gridCell(12, checkboxField(SETTINGS.faultOnDisconnected, c.faultOnDisconnected, (v) => {
      c.faultOnDisconnected = v;
      app.changed();
    }, { path: 'faultOnDisconnected', help: SETTINGS.faultOnDisconnectedHelp })),
    gridCell(12, checkboxField(SETTINGS.attentionSensor, c.attentionSensor, (v) => {
      c.attentionSensor = v;
      app.changed();
      // The Reconnect needed card mentions the sensor only while it is on.
      app.rerender('account');
    }, { path: 'attentionSensor', help: SETTINGS.attentionSensorHelp })),
    gridCell(12, checkboxField(SETTINGS.exerciseSensor, c.exerciseSensor, (v) => {
      c.exerciseSensor = v;
      app.changed();
    }, { path: 'exerciseSensor', help: SETTINGS.exerciseSensorHelp })),
    gridCell(6, textField(SETTINGS.exerciseTime, c.exerciseTime, (v) => {
      c.exerciseTime = v;
      app.changed();
      // The generator card's Exercise time row shows the configured value.
      app.rerender('generators');
    }, { path: 'exerciseTime', placeholder: SETTINGS.exerciseTimePlaceholder, help: SETTINGS.exerciseTimeHelp, inputmode: 'numeric', monospace: true })),
    gridCell(6, numberField(SETTINGS.exerciseHold, c.exerciseHoldMinutes, (v) => {
      c.exerciseHoldMinutes = v;
      app.changed();
    }, { path: 'exerciseHoldMinutes', min: DEFAULTS.exerciseHoldMinutesMin, help: SETTINGS.exerciseHoldHelp })),
    gridCell(12, checkboxField(SETTINGS.debug, c.debug, (v) => {
      c.debug = v;
      app.changed();
    }, { path: 'debug', help: SETTINGS.debugHelp })),
  );
  container.appendChild(disclosure(SHELL.advanced, [fields, resetControl(app)], { cls: 'gn-settings' }));
}
