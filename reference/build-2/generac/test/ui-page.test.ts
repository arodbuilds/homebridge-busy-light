/**
 * The settings page rendered under node:test on the fake DOM (test/fake-dom.ts): what the page draws from the
 * platform block and from /status, and the paths Alex's live pass on the Pi exercised (SPEC section 16,
 * September 15, 2026): the affiliation line under the intro, the threshold with one decimal place, the account
 * card after the Connect flow, and the Reset and Disconnect confirmations in the page flow.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { FakeEvent, flush, installFakeDom, text, type, type FakeElement } from './fake-dom.js';
import { fixturesDir } from './helpers.js';

const dom = installFakeDom();

/** The host: /status and the Connect endpoints answer from a script the test sets; every request is recorded. */
const requests: Array<{ path: string; payload: unknown }> = [];
const answers = new Map<string, unknown | (() => unknown)>();
const pushed: unknown[][] = [];
const save = { enabled: undefined as boolean | undefined };
const toasts: string[] = [];
dom.window.homebridge = {
  request: async (path: string, payload: unknown = {}) => {
    requests.push({ path, payload });
    const answer = answers.get(path);
    if (answer === undefined) {
      throw new Error(`No answer for ${path}`);
    }
    // A copy, as postMessage would hand the page: the page edits its status object after Connect, Disconnect and Reset.
    return structuredClone(typeof answer === 'function' ? (answer as () => unknown)() : answer);
  },
  getPluginConfig: async () => [],
  updatePluginConfig: async (blocks: unknown[]) => {
    pushed.push(blocks);
  },
  toast: { error: (m: string) => toasts.push(`error: ${m}`), success: (m: string) => toasts.push(`success: ${m}`) },
  enableSaveButton: () => {
    save.enabled = true;
  },
  disableSaveButton: () => {
    save.enabled = false;
  },
  showSpinner: () => undefined,
  hideSpinner: () => undefined,
};

// The page modules read window and document at call time; they are imported once the fake DOM is in place.
const { Page } = await import('../homebridge-ui/src/main.js');
const { readConfig } = await import('../homebridge-ui/src/model.js');
const { ACCOUNT, CONNECT, INTRO, SETTINGS, SHELL } = await import('../homebridge-ui/src/copy.js');

const CONNECTED = {
  account: { state: 'connected', email: 'you@example.com', lastChecked: '2026-09-15T19:12:00Z' }, generators: [], others: [], version: '0.1.0-beta.1',
};
const NOT_CONNECTED = { account: { state: 'not_connected' }, generators: [], others: [], version: '0.1.0-beta.1' };
const CHECKING = { account: { state: 'checking', email: 'you@example.com' }, generators: [], others: [], version: '0.1.0-beta.1' };

function mount(raw: Record<string, unknown> = { platform: 'Generac' }): { root: FakeElement; page: InstanceType<typeof Page> } {
  const root = dom.document.createElement('div');
  root.setAttribute('id', 'app');
  dom.document.body.appendChild(root);
  const page = new Page(readConfig(raw), root as unknown as HTMLElement);
  page.setOtherBlocks([]);
  page.renderAll();
  return { root, page };
}

function field(root: FakeElement, path: string): FakeElement {
  const input = root.querySelector(`[data-path="${path}"] input`);
  assert.ok(input, `no field ${path}`);
  return input;
}

function feedback(root: FakeElement, path: string): string {
  return text(root.querySelector(`[data-path="${path}"] > .invalid-feedback`));
}

function buttons(node: FakeElement): string[] {
  return node.querySelectorAll('button').map((b) => text(b));
}

function accountCard(root: FakeElement): FakeElement {
  const card = root.querySelector('#section-account .gn-account-card');
  assert.ok(card, 'no account card');
  return card;
}

afterEach(() => {
  dom.clock.clearAll();
  for (const node of dom.document.body.children) {
    node.remove();
  }
  requests.length = 0;
  answers.clear();
  pushed.length = 0;
  toasts.length = 0;
});

describe('settings page: intro and affiliation line (SPEC section 11.1)', () => {
  it('draws the affiliation line directly under the intro paragraphs and nowhere in the footer', () => {
    const { root } = mount();
    const classes = root.children.map((c) => `${c.tagName.toLowerCase()}.${c.className.split(' ').join('.')}`);
    assert.deepEqual(classes.slice(0, 4), ['img.ns-banner', 'p.lead-copy', 'p.lead-copy', 'p.form-text.gn-affiliation']);
    assert.equal(text(root.children[3]), INTRO.affiliation);
    const footer = root.querySelector('footer');
    assert.ok(footer);
    assert.equal(footer.nextElementSibling, null, 'the footer is the last element');
    assert.equal(text(footer).includes('affiliated'), false);
  });
});

describe('settings page: low battery threshold (SPEC section 11.3 E)', () => {
  it('shows one decimal place on load: 12.0 for the default, 11.8 as saved', () => {
    assert.equal(field(mount().root, 'batteryLowVoltage').value, '12.0');
    assert.equal(field(mount({ platform: 'Generac', batteryLowVoltage: 11.8 }).root, 'batteryLowVoltage').value, '11.8');
    assert.equal(field(mount({ platform: 'Generac', batteryLowVoltage: 12 }).root, 'batteryLowVoltage').value, '12.0');
  });

  it('accepts one decimal and shows it with one decimal place after blur', async () => {
    const { root, page } = mount();
    const input = field(root, 'batteryLowVoltage');
    input.focus();
    type(input, '12');
    assert.equal(page.config.batteryLowVoltage, 12);
    assert.deepEqual(page.issues(), []);
    input.blur();
    assert.equal(input.value, '12.0');
    assert.equal(feedback(root, 'batteryLowVoltage'), '');
    input.focus();
    type(input, '11.8');
    input.blur();
    assert.equal(input.value, '11.8');
    assert.equal(page.config.batteryLowVoltage, 11.8);
    await dom.clock.advance(200);
    const block = pushed[pushed.length - 1][0] as Record<string, unknown>;
    assert.equal(block.batteryLowVoltage, 11.8);
    assert.equal(save.enabled, true);
  });

  it('rejects more than one decimal with the 11.3 E message and keeps the typed text', () => {
    const { root, page } = mount();
    const input = field(root, 'batteryLowVoltage');
    input.focus();
    type(input, '12.05');
    assert.deepEqual(page.issues(), [{ path: 'batteryLowVoltage', message: SETTINGS.batteryLowError }]);
    assert.equal(feedback(root, 'batteryLowVoltage'), '', 'no message while the field still has focus');
    input.blur();
    assert.equal(input.value, '12.05', 'an invalid value is not reformatted');
    assert.equal(feedback(root, 'batteryLowVoltage'), SETTINGS.batteryLowError);
    assert.equal(input.classList.contains('is-invalid'), true);
    assert.equal(save.enabled, false);
    input.focus();
    type(input, '12.1');
    assert.equal(feedback(root, 'batteryLowVoltage'), '', 'typing a valid value clears the message at once');
    input.blur();
    assert.equal(input.value, '12.1');
    assert.equal(save.enabled, true);
  });
});

/** A scripted /status: each poll takes the next answer; the last one repeats. */
function statusScript(...sequence: unknown[]): unknown[] {
  const queue = [...sequence];
  answers.set('/status', () => (queue.length > 1 ? queue.shift() : queue[0]));
  return queue;
}

/** Mounts the page against a not-connected account, runs the Connect flow through the SMS code step, and returns the page. */
async function connectThroughCode(): Promise<{ root: FakeElement; page: InstanceType<typeof Page> }> {
  const { root, page } = mount();
  page.startPolling();
  await flush();
  assert.deepEqual(buttons(accountCard(root)), [ACCOUNT.connect]);
  accountCard(root).querySelector('button')!.click();
  type(field(root, 'connect.email'), 'you@example.com');
  type(field(root, 'connect.password'), 'hunter2');
  answers.set('/connect/start', { step: 'code', method: 'sms' });
  accountCard(root).querySelectorAll('button').find((b) => text(b) === CONNECT.signIn)!.click();
  await flush();
  assert.equal(text(accountCard(root).querySelector('.ns-card-name')), CONNECT.codeTitle);
  assert.ok(text(accountCard(root)).includes(CONNECT.codeBodySms));
  type(field(root, 'connect.code'), '123456');
  answers.set('/connect/code', { step: 'done' });
  accountCard(root).querySelectorAll('button').find((b) => text(b) === CONNECT.continue)!.click();
  await flush();
  return { root, page };
}

describe('settings page: account card after Connect (SPEC section 11.3 B, defect a of September 15, 2026)', () => {
  it('reads Checking with the signed-in line and no button after the code step, then Connected from /status within 60 s', async () => {
    statusScript(NOT_CONNECTED, CHECKING, CHECKING, CONNECTED);
    const { root, page } = await connectThroughCode();
    let card = accountCard(root);
    assert.equal(text(card.querySelector('.badge')), ACCOUNT.checking);
    assert.ok(text(card).includes(ACCOUNT.checkingBody));
    assert.equal(text(card).includes(ACCOUNT.notConnectedBody), false, 'the Not connected body is gone');
    assert.equal(text(card).includes(ACCOUNT.checkingSlow), false);
    assert.deepEqual(buttons(card), [], 'no Connect button while Checking');
    assert.equal(page.ui.flow, null, 'the flow handed control back');
    assert.equal(requests.filter((r) => r.path === '/connect/cancel').length, 0);

    await dom.clock.advance(15 * 1000);
    card = accountCard(root);
    assert.equal(text(card.querySelector('.badge')), ACCOUNT.checking);
    assert.deepEqual(buttons(card), []);

    await dom.clock.advance(45 * 1000);
    card = accountCard(root);
    assert.equal(text(card.querySelector('.badge')), ACCOUNT.connected);
    assert.equal(text(card.querySelector('.gn-email')), 'you@example.com');
    assert.deepEqual(buttons(card), [ACCOUNT.disconnect]);
    assert.equal(page.ui.checkingSince, null);
  });

  it('adds the restart line when /status still reports checking 120 s after the code step, and nothing else', async () => {
    statusScript(NOT_CONNECTED, CHECKING);
    const { root } = await connectThroughCode();
    await dom.clock.advance(105 * 1000);
    let card = accountCard(root);
    assert.equal(text(card).includes(ACCOUNT.checkingSlow), false, 'not yet at 105 s');
    await dom.clock.advance(30 * 1000);
    card = accountCard(root);
    assert.equal(text(card.querySelector('.badge')), ACCOUNT.checking);
    assert.ok(text(card).includes(ACCOUNT.checkingBody));
    assert.ok(text(card).includes(ACCOUNT.checkingSlow), 'the restart line at 120 s and after');
    assert.deepEqual(buttons(card), []);
    assert.deepEqual(card.querySelectorAll('.gn-body').map((p) => text(p)), [ACCOUNT.checkingBody, ACCOUNT.checkingSlow]);

    statusScript(CONNECTED);
    await dom.clock.advance(15 * 1000);
    card = accountCard(root);
    assert.equal(text(card.querySelector('.badge')), ACCOUNT.connected);
    assert.equal(text(card).includes(ACCOUNT.checkingSlow), false);
  });

  it('keeps the Connect flow in place across a poll, and leaves no local view behind on Cancel', async () => {
    statusScript(NOT_CONNECTED);
    const { root, page } = mount();
    page.startPolling();
    await flush();
    accountCard(root).querySelector('button')!.click();
    type(field(root, 'connect.email'), 'you@example.com');
    await dom.clock.advance(15 * 1000);
    assert.equal(field(root, 'connect.email').value, 'you@example.com', 'the flow is not redrawn by the poll');
    answers.set('/connect/cancel', { ok: true });
    accountCard(root).querySelectorAll('button').find((b) => text(b) === CONNECT.cancel)!.click();
    await flush();
    assert.deepEqual(buttons(accountCard(root)), [ACCOUNT.connect]);
    statusScript(CONNECTED);
    await dom.clock.advance(15 * 1000);
    assert.equal(text(accountCard(root).querySelector('.badge')), ACCOUNT.connected);
  });

  it('redraws the Connected card from every /status answer, keeping the Disconnect question open as page state', async () => {
    statusScript(CONNECTED);
    const { root, page } = mount();
    page.startPolling();
    await flush();
    accountCard(root).querySelectorAll('button').find((b) => text(b) === ACCOUNT.disconnect)!.click();
    assert.equal(page.ui.disconnectOpen, true);
    assert.deepEqual(buttons(accountCard(root)), [ACCOUNT.disconnect, ACCOUNT.keep]);
    statusScript({ ...CONNECTED, account: { ...CONNECTED.account, email: 'other@example.com' } });
    await dom.clock.advance(15 * 1000);
    let card = accountCard(root);
    assert.equal(text(card.querySelector('.gn-email')), 'other@example.com', 'the card is redrawn from /status');
    assert.ok(text(card).includes(ACCOUNT.disconnectQuestion), 'the question survives the redraw');
    card.querySelectorAll('button').find((b) => text(b) === ACCOUNT.keep)!.click();
    assert.equal(page.ui.disconnectOpen, false);
    assert.deepEqual(buttons(accountCard(root)), [ACCOUNT.disconnect]);
    await dom.clock.advance(15 * 1000);
    card = accountCard(root);
    assert.deepEqual(buttons(card), [ACCOUNT.disconnect], 'closed stays closed after the next poll');
  });

  it('draws the Checking card on load and adds the restart line 120 s after first seeing it', async () => {
    statusScript(CHECKING);
    const { root, page } = mount();
    page.startPolling();
    await flush();
    assert.equal(text(accountCard(root).querySelector('.badge')), ACCOUNT.checking);
    assert.deepEqual(buttons(accountCard(root)), []);
    await dom.clock.advance(120 * 1000);
    assert.ok(text(accountCard(root)).includes(ACCOUNT.checkingSlow));
  });
});

function resetLink(root: FakeElement): FakeElement {
  const link = root.querySelectorAll('#section-settings button').find((b) => text(b) === SHELL.reset);
  assert.ok(link, 'no Reset link');
  return link;
}

describe('settings page: Reset dialog and Disconnect question in the page flow (SPEC section 11.2, defect b of September 15, 2026)', () => {
  it('renders the Reset dialog inline directly below the Reset link and scrolls the host to it', async () => {
    statusScript(CONNECTED);
    const { root, page } = mount();
    page.startPolling();
    await flush();
    assert.equal(root.querySelector('.ns-inline-dialog'), null);
    resetLink(root).click();
    const dialog = root.querySelector('.ns-inline-dialog');
    assert.ok(dialog, 'the dialog is in the page');
    assert.equal(dialog.parentNode, resetLink(root).parentNode, 'in the Reset link\'s holder');
    assert.equal(resetLink(root).nextElementSibling, dialog, 'directly below the link');
    assert.equal(dom.document.body.querySelector('.ns-modal-backdrop'), null, 'no fixed overlay');
    assert.ok(dialog.classList.contains('card'), 'a card, so the host paints it in both themes');
    assert.equal(page.ui.resetOpen, true);
    assert.equal(text(dialog.querySelector('.ns-inline-dialog-title')), SHELL.resetTitle);
    assert.deepEqual(dialog.querySelectorAll('li').map((li) => text(li)), SETTINGS.resetLines);
    assert.deepEqual(buttons(dialog), [SHELL.resetConfirm, SHELL.resetCancel]);
    await dom.clock.advance(0);
    assert.equal(dom.document.activeElement, dialog.querySelector('input'), 'the RESET field has focus');
    assert.deepEqual(dialog.scrolledInto, [{ block: 'center' }], 'scrollIntoView on open');
    await dom.clock.advance(250);
    assert.deepEqual(dialog.scrolledInto, [{ block: 'center' }, { block: 'center' }], 'and again once the host has resized the iframe');
  });

  it('enables Confirm once RESET is typed in any case; Confirm resets the page, Cancel and Escape only close', async () => {
    statusScript(CONNECTED);
    const { root, page } = mount({ platform: 'Generac', name: 'Basement', debug: true });
    page.startPolling();
    await flush();
    resetLink(root).click();
    let dialog = root.querySelector('.ns-inline-dialog')!;
    const confirm = dialog.querySelectorAll('button').find((b) => text(b) === SHELL.resetConfirm)!;
    assert.equal(confirm.disabled, true);
    type(dialog.querySelector('input')!, 'RESE');
    assert.equal(confirm.disabled, true);
    type(dialog.querySelector('input')!, 'reset');
    assert.equal(confirm.disabled, false, 'lower case is accepted');
    type(dialog.querySelector('input')!, 'Reset');
    assert.equal(confirm.disabled, false, 'mixed case is accepted');
    type(dialog.querySelector('input')!, 'resets');
    assert.equal(confirm.disabled, true);
    type(dialog.querySelector('input')!, 'RESET');
    assert.equal(confirm.disabled, false);
    assert.equal(text(dialog.querySelector('label')), 'Type RESET to confirm.', 'the prompt is unchanged');
    dialog.querySelectorAll('button').find((b) => text(b) === SHELL.resetCancel)!.click();
    assert.equal(root.querySelector('.ns-inline-dialog'), null);
    assert.equal(page.ui.resetOpen, false);

    resetLink(root).click();
    assert.ok(root.querySelector('.ns-inline-dialog'));
    dom.document.dispatchEvent(new FakeEvent('keydown', true, { key: 'Escape' }));
    assert.equal(root.querySelector('.ns-inline-dialog'), null, 'Escape closes');
    assert.equal(page.ui.resetOpen, false);

    resetLink(root).click();
    dialog = root.querySelector('.ns-inline-dialog')!;
    type(dialog.querySelector('input')!, 'reset');
    answers.set('/reset', { ok: true });
    statusScript(NOT_CONNECTED);
    dialog.querySelectorAll('button').find((b) => text(b) === SHELL.resetConfirm)!.click();
    await flush();
    assert.equal(root.querySelectorAll('.ns-inline-dialog').filter((d) => !d.classList.contains('gn-reset-done')).length, 0);
    assert.equal(requests.filter((r) => r.path === '/reset').length, 1);
    assert.equal(page.config.name, 'Generac');
    assert.equal(page.config.debug, false);
    assert.equal(field(root, 'name').value, 'Generac');
    assert.deepEqual(buttons(accountCard(root)), [ACCOUNT.connect]);
    assert.deepEqual(toasts, [`success: ${SHELL.resetDone}`]);
  });

  it('replaces the dialog in place with the done state after Confirm and hides the Reset link until a reload', async () => {
    statusScript(CONNECTED);
    const { root, page } = mount({ platform: 'Generac', name: 'Basement' });
    page.startPolling();
    await flush();
    root.querySelector('#section-settings details')!.open = true;
    resetLink(root).click();
    const dialog = root.querySelector('.ns-inline-dialog')!;
    const holder = dialog.parentNode;
    type(dialog.querySelector('input')!, 'RESET');
    answers.set('/reset', { ok: true });
    statusScript(NOT_CONNECTED);
    dialog.querySelectorAll('button').find((b) => text(b) === SHELL.resetConfirm)!.click();
    await flush();
    const done = root.querySelector('.gn-reset-done');
    assert.ok(done, 'the done state is on the page');
    assert.notEqual(holder, done.parentNode, 'the section was redrawn');
    assert.ok(done.parentNode!.classList.contains('gn-reset'), 'in the Reset holder, where the dialog was');
    assert.equal(done.parentNode!.children.length, 1, 'nothing else in the holder');
    assert.equal(text(done.querySelector('.ns-inline-dialog-title')), SETTINGS.resetDoneTitle);
    assert.equal(text(done.querySelector('.ns-inline-dialog-body')), SETTINGS.resetDoneBody);
    assert.ok(done.classList.contains('card'), 'on the host\'s card surface');
    assert.deepEqual(buttons(done), []);
    assert.equal(root.querySelectorAll('#section-settings button').find((b) => text(b) === SHELL.reset), undefined, 'no Reset link');
    assert.equal(root.querySelector('#section-settings details')!.open, true, 'the disclosure stays open across the redraw');
    assert.deepEqual(done.scrolledInto, [{ block: 'center' }], 'scrolled into view');
    assert.equal(page.ui.resetOpen, false);
    assert.equal(page.ui.resetDone, true);

    // Later redraws (a /status poll, a setting change) keep the done state and keep the link hidden.
    await dom.clock.advance(15 * 1000);
    page.rerender('settings');
    assert.ok(root.querySelector('.gn-reset-done'));
    assert.equal(root.querySelectorAll('#section-settings button').find((b) => text(b) === SHELL.reset), undefined);

    // A reload is a new page: the link is back and there is no done state.
    const fresh = mount();
    assert.equal(fresh.root.querySelector('.gn-reset-done'), null);
    assert.ok(resetLink(fresh.root));
  });

  it('scrolls the host to the Disconnect question when it opens', async () => {
    statusScript(CONNECTED);
    const { root, page } = mount();
    page.startPolling();
    await flush();
    accountCard(root).querySelectorAll('button').find((b) => text(b) === ACCOUNT.disconnect)!.click();
    const control = accountCard(root).querySelector('.ns-inline-confirm')!;
    assert.ok(text(control).includes(ACCOUNT.disconnectQuestion));
    assert.deepEqual(control.scrolledInto, [{ block: 'center' }]);
    await dom.clock.advance(250);
    assert.deepEqual(control.scrolledInto, [{ block: 'center' }, { block: 'center' }]);
    await dom.clock.advance(15 * 1000);
    assert.equal(accountCard(root).querySelector('.ns-inline-confirm')!.scrolledInto.length, 0, 'a redraw from /status does not scroll');
  });
});

describe('settings page: dialogs in the host\'s dark theme (SPEC section 11.2, beta defect)', () => {
  const css = ['index.css', 'generac.css']
    .map((f) => fs.readFileSync(path.resolve(fixturesDir, '..', '..', 'homebridge-ui', 'public', f), 'utf8'))
    .join('\n')
    // Rules only: the comments explain the light-only variables by name.
    .replace(/\/\*[\s\S]*?\*\//g, '');

  it('sets no fill or text colour of its own on the Reset dialog or the Disconnect question', () => {
    const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
      .filter(([, selector]) => /ns-inline-(dialog|confirm)|ns-confirm-question/.test(selector));
    assert.ok(rules.length > 0);
    for (const [, selector, body] of rules) {
      assert.equal(/(^|[\s;])(background(-color)?|color)\s*:/.test(body), false, `${selector.trim()} sets a colour`);
    }
  });

  it('reads no light-only page variable and no fixed white anywhere a surface is painted', () => {
    assert.equal(css.includes('--bs-body-bg'), false);
    assert.equal(/background[^;]*#fff\b/i.test(css), false);
  });
});
