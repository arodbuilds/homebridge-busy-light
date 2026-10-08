/**
 * Status from other apps (SPEC 11.3 I, section 18): the checkbox that turns the status input on, and with it the
 * addresses and setup code built from /input/info, the key with Show, Copy and Replace, Test, Allow the plain key and
 * the port; then the apps reporting now, from the state file, and the On a Call switch. The key is generated here,
 * with `crypto.getRandomValues`, when the checkbox is first ticked and no key exists. Drafts never hold it.
 */

import { callServer } from '../api.js';
import type { App, InputUiState } from '../app.js';
import { badge } from '../card.js';
import { SHELL, STATUS_INPUT, STATUS_NAMES } from '../copy.js';
import {
  button, checkboxField, copyText, disclosure, el, grid, gridCell, helpText, inlineConfirm, linkButton, numberField, outLink, paragraph,
  statusBox, uniqueId,
} from '../dom.js';
import { parseDate, relativeTime } from '../format.js';
import { DEFAULTS, LIMITS, isInputKey, newInputKey } from '../model.js';

type InputInfoAnswer = { hostname: string | null; addresses: string[]; port: number; id: string } | { error: string; message: string };
type InputTestAnswer = { ok: true } | { error: 'notListening' | 'unauthorized' | 'other'; message: string };

/** `http://{host}:{port}`, with an IPv6 address in brackets (SPEC 18.11 item 3). */
export function inputUrl(host: string, port: number): string {
  return `http://${host.includes(':') ? `[${host}]` : host}:${port}`;
}

/** The setup code (SPEC 18.11 item 3): the host name, or the first address. It contains the key. */
export function setupCode(host: string, port: number, key: string, id: string): string {
  return `busylight://${host.includes(':') ? `[${host}]` : host}:${port}/?key=${key}&id=${id}`;
}

/** Asks /input/info once a visit while the status input is on (and again after it failed, when the box is ticked). */
async function loadInfo(app: App): Promise<void> {
  const state = app.ui.input;
  if (state.loading) {
    return;
  }
  state.loading = true;
  const answer = await callServer<InputInfoAnswer>('/input/info');
  state.loading = false;
  if (answer && 'id' in answer) {
    state.info = answer;
    state.failed = false;
  } else {
    state.failed = true;
  }
  app.rerender('statusInput');
}

async function test(app: App): Promise<void> {
  const state = app.ui.input;
  const input = app.config.statusInput;
  if (state.testing) {
    return;
  }
  state.testing = true;
  state.result = null;
  app.rerender('statusInput');
  const answer = await callServer<InputTestAnswer>('/input/test', { port: input.port, key: input.key });
  state.testing = false;
  if (answer && 'ok' in answer) {
    state.result = { kind: 'received', message: STATUS_INPUT.received };
  } else if (answer && answer.error === 'unauthorized') {
    state.result = { kind: 'unauthorized', message: STATUS_INPUT.unauthorized };
  } else if (!answer || answer.error === 'notListening') {
    state.result = { kind: 'notListening', message: STATUS_INPUT.notListening };
  } else {
    state.result = { kind: 'other', message: answer.message };
  }
  app.rerender('statusInput');
}

function resultBox(state: InputUiState): HTMLElement | null {
  if (!state.result) {
    return null;
  }
  const tone = state.result.kind === 'received' ? 'success' : state.result.kind === 'other' ? 'danger' : 'warning';
  return statusBox(tone, state.result.message);
}

/** A read-only field: the label and a monospace box, one line per value. */
function readOnlyLines(label: string, lines: string[], cls: string): HTMLElement {
  const id = uniqueId();
  return el('div', { class: `mb-3 ${cls}` },
    el('div', { class: 'form-label', id }, label),
    el('div', { class: 'form-control font-monospace bl-readonly', role: 'textbox', 'aria-readonly': 'true', 'aria-labelledby': id },
      ...lines.map((line) => el('div', { class: 'bl-readonly-line' }, line))),
  );
}

function copyButton(app: App, label: string, which: 'key' | 'code', value: string): HTMLButtonElement {
  const state = app.ui.input;
  const node = button(state.copied === which ? STATUS_INPUT.copied : label, () => {
    void copyText(value).then((ok) => {
      if (ok) {
        state.copied = which;
        node.textContent = STATUS_INPUT.copied;
      }
    });
  }, `btn btn-outline-primary btn-sm bl-copy-${which}`);
  return node;
}

/** The key: a read-only password field with Show and Hide, and Copy key. */
function keyField(app: App, key: string): HTMLElement {
  const id = uniqueId();
  const input = el('input', {
    id, class: 'form-control font-monospace', type: 'password', value: key, readonly: true, autocomplete: 'off', spellcheck: 'false',
  });
  const toggle = el('button', { class: 'btn btn-outline-secondary', type: 'button', 'aria-controls': id }, SHELL.show);
  toggle.addEventListener('click', () => {
    const reveal = input.type === 'password';
    input.type = reveal ? 'text' : 'password';
    toggle.textContent = reveal ? SHELL.hide : SHELL.show;
  });
  return el('div', { class: 'mb-3 bl-input-key' },
    el('label', { class: 'form-label', for: id }, STATUS_INPUT.key),
    el('div', { class: 'input-group' }, input, toggle),
    el('div', { class: 'bl-actions mt-2' }, copyButton(app, STATUS_INPUT.copyKey, 'key', key)),
  );
}

/** What shows while the checkbox is ticked (SPEC 11.3 I). */
function enabledBody(app: App): HTMLElement {
  const input = app.config.statusInput;
  const state = app.ui.input;
  const info = state.info;
  const body = el('div', { class: 'bl-input-body' });
  const error = app.status?.statusInput?.error ? statusBox('danger', STATUS_INPUT.portError(app.status.statusInput.port)) : null;
  body.appendChild(el('div', { class: 'bl-input-error' }, error));
  if (info) {
    const lines = [...(info.hostname ? [inputUrl(info.hostname, input.port)] : []), ...info.addresses.map((a) => inputUrl(a, input.port))];
    body.appendChild(readOnlyLines(STATUS_INPUT.address, lines, 'bl-input-addresses'));
    if (!info.hostname) {
      body.appendChild(helpText(STATUS_INPUT.reserveHelp, 'bl-reserve-help mb-3'));
    }
  }
  body.appendChild(keyField(app, input.key));
  const host = info ? info.hostname ?? info.addresses[0] : undefined;
  if (info && host) {
    const code = setupCode(host, input.port, input.key, info.id);
    body.appendChild(el('div', { class: 'mb-3 bl-setup-code' },
      readOnlyLines(STATUS_INPUT.setupCode, [code], 'mb-0'),
      el('div', { class: 'bl-actions mt-2' }, copyButton(app, STATUS_INPUT.copySetupCode, 'code', code)),
      helpText(STATUS_INPUT.setupCodeHelp),
    ));
  }
  const replace = inlineConfirm({
    start: linkButton(STATUS_INPUT.replaceKey, () => undefined, 'bl-replace-key'),
    question: STATUS_INPUT.replaceQuestion,
    confirmLabel: STATUS_INPUT.replace,
    confirmClass: 'btn btn-danger btn-sm',
    cancelLabel: STATUS_INPUT.cancel,
    open: state.replaceOpen,
    onOpen: (open) => {
      state.replaceOpen = open;
    },
    onConfirm: () => {
      state.replaceOpen = false;
      input.key = newInputKey();
      state.result = null;
      state.copied = null;
      app.changed();
      app.rerender('statusInput');
    },
  });
  body.appendChild(el('div', { class: 'mb-3 bl-replace' }, replace));
  const testButton = button(state.testing ? STATUS_INPUT.testing : STATUS_INPUT.test, () => void test(app), 'btn btn-outline-primary btn-sm bl-input-test');
  testButton.disabled = state.testing;
  body.appendChild(el('div', { class: 'mb-3 bl-test' },
    el('div', { class: 'bl-actions' }, testButton, el('span', { class: 'form-text bl-test-help' }, STATUS_INPUT.testHelp)),
    el('div', { class: 'bl-input-result mt-2', role: 'status' }, resultBox(state)),
  ));
  body.appendChild(checkboxField(STATUS_INPUT.allowPlainKey, input.allowPlainKey, (v) => {
    input.allowPlainKey = v;
    app.changed();
  }, { path: 'statusInput.allowPlainKey', help: STATUS_INPUT.allowPlainKeyHelp }));
  body.appendChild(disclosure(SHELL.advanced, [grid(gridCell(6, numberField(STATUS_INPUT.port, input.port, (v) => {
    input.port = v;
    app.changed();
  }, { path: 'statusInput.port', min: LIMITS.port[0], max: LIMITS.port[1], help: STATUS_INPUT.portHelp(DEFAULTS.statusInput.port) })))], {
    cls: 'bl-input-advanced', open: input.port !== DEFAULTS.statusInput.port,
  }));
  return body;
}

/** Apps reporting now (SPEC 11.3 I), from the state file's `inputs`. */
function senderList(app: App): HTMLElement {
  const list = el('div', { class: 'bl-senders' });
  const status = app.status;
  if (status === undefined) {
    return list; // the first /status answer arrives in a moment
  }
  const inputs = status?.inputs ?? [];
  if (inputs.length === 0) {
    list.appendChild(paragraph(STATUS_INPUT.noneReporting, 'form-text bl-senders-empty'));
    return list;
  }
  for (const entry of inputs) {
    const heard = parseDate(entry.lastHeard);
    const badges = [badge(entry.active ? STATUS_INPUT.active : STATUS_INPUT.expired, entry.active ? 'connected' : 'checking')];
    if (entry.via === 'api' && entry.auth) {
      badges.push(badge(entry.auth === 'signed' ? STATUS_INPUT.signed : STATUS_INPUT.plainKey, entry.auth === 'signed' ? 'checking' : 'warning'));
    }
    list.appendChild(el('div', { class: 'bl-sender-row' },
      el('div', { class: 'bl-sender-text' },
        el('div', { class: 'bl-sender-name' }, entry.sender),
        el('div', { class: 'form-text bl-sender-status' }, `${STATUS_NAMES[entry.status]}${entry.app ? STATUS_INPUT.fromApp(entry.app) : ''}`),
        heard ? el('div', { class: 'form-text bl-sender-meta' }, STATUS_INPUT.lastHeard(relativeTime(heard, new Date(Date.now())))) : null,
      ),
      el('div', { class: 'bl-sender-badges' }, ...badges),
    ));
  }
  return list;
}

export function renderStatusInput(app: App, container: HTMLElement): void {
  const input = app.config.statusInput;
  const call = app.config.callSwitch;
  container.appendChild(el('p', { class: 'section-copy' }, STATUS_INPUT.help, ' ', outLink(STATUS_INPUT.howAppsConnect, STATUS_INPUT.docsUrl)));
  container.appendChild(checkboxField(STATUS_INPUT.enable, input.enabled, (v) => {
    input.enabled = v;
    if (v && !isInputKey(input.key)) {
      input.key = newInputKey();
    }
    app.changed();
    app.rerender('statusInput');
    app.rerender('colors');
    app.focusLater('statusInput.enabled');
    if (v && !app.ui.input.info) {
      void loadInfo(app);
    }
  }, { path: 'statusInput.enabled' }));
  if (input.enabled) {
    if (!app.ui.input.info && !app.ui.input.loading && !app.ui.input.failed) {
      void loadInfo(app);
    }
    container.appendChild(enabledBody(app));
  }
  container.appendChild(el('h3', { class: 'bl-subheading bl-senders-heading' }, STATUS_INPUT.reporting));
  container.appendChild(senderList(app));
  container.appendChild(checkboxField(STATUS_INPUT.callSwitch, call.enabled, (v) => {
    call.enabled = v;
    app.changed();
    app.rerender('statusInput');
    app.rerender('colors');
    app.focusLater('callSwitch.enabled');
  }, { path: 'callSwitch.enabled', help: STATUS_INPUT.callSwitchHelp }));
  if (call.enabled) {
    container.appendChild(grid(gridCell(6, numberField(STATUS_INPUT.callSwitchHours, call.hours, (v) => {
      call.hours = v;
      app.changed();
    }, { path: 'callSwitch.hours', min: LIMITS.hours[0], max: LIMITS.hours[1] }))));
  }
}

/** After each /status answer: the sender list and the port error are redrawn in place, so typing elsewhere is undisturbed. */
export function statusInputOnStatus(app: App, container: HTMLElement): void {
  const senders = container.querySelector('.bl-senders');
  if (senders?.parentNode) {
    senders.parentNode.insertBefore(senderList(app), senders);
    senders.remove();
  }
  const error = container.querySelector('.bl-input-error');
  if (error) {
    while (error.firstChild) {
      error.removeChild(error.firstChild);
    }
    if (app.status?.statusInput?.error) {
      error.appendChild(statusBox('danger', STATUS_INPUT.portError(app.status.statusInput.port)));
    }
  }
}
