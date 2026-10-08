/**
 * The Mobile Link account card in its four states (SPEC section 11.3 B) and the two-step Connect flow that
 * replaces it in place (11.3 C). The card is drawn from /status and the page state on every redraw; the flow
 * hands control back to it when it ends. The password and the code live in the flow state until the request
 * that carries them returns, and are never written anywhere.
 */

import { callServer } from '../api.js';
import type { App, ConnectFlow } from '../app.js';
import { badge, card, cardName } from '../card.js';
import { ACCOUNT, CONNECT } from '../copy.js';
import {
  el, grid, gridCell, inlineConfirm, linkButton, outlineButton, paragraph, passwordField, primaryButton, statusBox, textField,
} from '../dom.js';
import { parseDate, relativeTime } from '../format.js';

type StartResponse = { step: 'code'; method: 'sms' | 'otp' | 'email' } | { step: 'done' } | { error: string };
type CodeResponse = { step: 'done' } | { error: string };

/** Checking this long after the sign-in, the card adds the restart line (SPEC section 11.3 B). */
export const CHECKING_HINT_MS = 120 * 1000;

function startFlow(app: App): void {
  app.ui.flow = { step: 'credentials', email: '', password: '', error: null, busy: false };
  app.rerender('account');
}

/** Not connected; before the first /status answer the Connect button waits disabled. */
function notConnectedCard(app: App, ready: boolean): HTMLElement {
  const connect = primaryButton(ACCOUNT.connect, () => startFlow(app));
  connect.disabled = !ready;
  return card({
    title: cardName(ACCOUNT.title),
    body: [paragraph(ACCOUNT.notConnectedBody, 'gn-body'), el('div', { class: 'gn-actions' }, connect)],
    cls: 'gn-account-card',
  });
}

/** Signed in, and the platform has not polled with the new credentials yet: no button, one line, then the restart line. */
function checkingCard(app: App, email: string): HTMLElement {
  const since = app.ui.checkingSince;
  const slow = since !== null && Date.now() - since >= CHECKING_HINT_MS;
  return card({
    title: cardName(ACCOUNT.title),
    badges: [badge(ACCOUNT.checking, 'outline')],
    body: [
      email ? el('div', { class: 'gn-row' }, el('span', { class: 'gn-email' }, email)) : null,
      paragraph(ACCOUNT.checkingBody, 'gn-body'),
      slow ? paragraph(ACCOUNT.checkingSlow, 'gn-body') : null,
    ],
    cls: 'gn-account-card',
  });
}

function connectedCard(app: App, email: string, lastChecked: string | undefined): HTMLElement {
  const checked = parseDate(lastChecked);
  const disconnect = inlineConfirm({
    start: linkButton(ACCOUNT.disconnect, () => undefined, 'gn-disconnect'),
    question: ACCOUNT.disconnectQuestion,
    confirmLabel: ACCOUNT.disconnect,
    confirmClass: 'btn btn-danger btn-sm',
    cancelLabel: ACCOUNT.keep,
    open: app.ui.disconnectOpen,
    onOpen: (open) => {
      app.ui.disconnectOpen = open;
    },
    onConfirm: () => {
      void callServer('/disconnect').then(() => app.refreshStatus());
      if (app.status) {
        app.status.account = { state: 'not_connected' };
      }
      app.rerender('account');
    },
  });
  return card({
    title: cardName(ACCOUNT.title),
    badges: [badge(ACCOUNT.connected, 'status')],
    body: [
      el('div', { class: 'gn-row' }, el('span', { class: 'gn-email' }, email)),
      checked ? el('p', { class: 'gn-meta' }, ACCOUNT.lastChecked(relativeTime(checked))) : null,
    ],
    footerRight: disconnect,
    cls: 'gn-account-card',
  });
}

function reconnectCard(app: App, email: string): HTMLElement {
  return card({
    title: cardName(ACCOUNT.title),
    badges: [badge(ACCOUNT.reconnectBadge, 'warn')],
    body: [
      email ? el('div', { class: 'gn-row' }, el('span', { class: 'gn-email' }, email)) : null,
      paragraph(ACCOUNT.reconnectBody, 'gn-body'),
      app.config.attentionSensor ? paragraph(ACCOUNT.reconnectAttention, 'gn-body') : null,
      el('div', { class: 'gn-actions' }, primaryButton(ACCOUNT.reconnect, () => startFlow(app))),
    ],
    cls: 'gn-account-card',
  });
}

// ---------------------------------------------------------------------------
// Connect flow (SPEC section 11.3 C)
// ---------------------------------------------------------------------------

function endFlow(app: App): void {
  void callServer('/connect/cancel');
  app.ui.flow = null;
  app.rerender('account');
}

/**
 * The sign-in finished: the flow ends and the card renderer takes over. The platform picks the credentials up
 * within a minute, so the card reads Checking until /status says otherwise; every /status answer redraws it.
 */
function finishFlow(app: App, email: string): void {
  app.ui.flow = null;
  app.ui.checkingSince = Date.now();
  if (app.status) {
    app.status.account = { state: 'checking', email };
  }
  app.rerender('account');
  void app.refreshStatus();
}

const START_ERRORS: Record<string, string> = {
  wrong_password: CONNECT.wrongPassword,
  unknown_email: CONNECT.unknownEmail,
  network: CONNECT.network,
};

const CODE_ERRORS: Record<string, string> = {
  wrong_code: CONNECT.wrongCode,
  too_many: CONNECT.tooMany,
  expired: CONNECT.expired,
};

function credentialsCard(app: App, flow: Extract<ConnectFlow, { step: 'credentials' }>): HTMLElement {
  const email = textField(CONNECT.email, flow.email, (v) => {
    flow.email = v;
  }, { path: 'connect.email', type: 'email', required: true, placeholder: CONNECT.emailPlaceholder, autocomplete: 'username', inputmode: 'email' });
  const password = passwordField(CONNECT.password, flow.password, (v) => {
    flow.password = v;
  }, { path: 'connect.password', required: true, help: CONNECT.passwordHelp });

  const signIn = primaryButton(flow.busy ? CONNECT.signingIn : CONNECT.signIn, () => {
    if (flow.busy) {
      return;
    }
    const missing = [!flow.email.trim() ? 'connect.email' : null, !flow.password ? 'connect.password' : null].filter((p): p is string => p !== null);
    if (missing.length > 0) {
      for (const path of missing) {
        app.touch(path);
      }
      return;
    }
    flow.busy = true;
    flow.error = null;
    app.rerender('account');
    const submitted = { email: flow.email.trim(), password: flow.password };
    void callServer<StartResponse>('/connect/start', submitted).then((r) => {
      if (app.ui.flow !== flow) {
        return;
      }
      flow.busy = false;
      if (r && 'step' in r) {
        if (r.step === 'done') {
          finishFlow(app, submitted.email);
          return;
        }
        app.ui.flow = { step: 'code', method: r.method, email: submitted.email, code: '', error: null, busy: false };
      } else if (r && 'error' in r && r.error === 'unsupported_factor') {
        app.ui.flow = { step: 'unsupported' };
      } else {
        const code = r && 'error' in r ? r.error : 'network';
        flow.error = code in START_ERRORS ? (code as 'wrong_password' | 'unknown_email' | 'network') : 'network';
        flow.password = '';
      }
      app.rerender('account');
    });
  });
  signIn.disabled = flow.busy;
  const cancel = linkButton(CONNECT.cancel, () => endFlow(app));
  cancel.disabled = flow.busy;

  return card({
    title: cardName(ACCOUNT.title),
    body: [
      grid(gridCell(6, email), gridCell(6, password)),
      flow.error ? statusBox('danger', START_ERRORS[flow.error]) : null,
      el('div', { class: 'gn-actions' }, signIn, cancel),
    ],
    cls: 'gn-account-card gn-connect',
  });
}

function codeCard(app: App, flow: Extract<ConnectFlow, { step: 'code' }>): HTMLElement {
  const body = flow.method === 'sms' ? CONNECT.codeBodySms : flow.method === 'otp' ? CONNECT.codeBodyOtp : CONNECT.codeBodyEmail(flow.email);
  const locked = flow.error === 'too_many' || flow.error === 'expired';
  const code = textField(CONNECT.code, flow.code, (v) => {
    flow.code = v;
  }, { path: 'connect.code', required: true, monospace: true, placeholder: CONNECT.codePlaceholder, autocomplete: 'one-time-code', inputmode: 'numeric' });

  const proceed = primaryButton(CONNECT.continue, () => {
    if (flow.busy || locked) {
      return;
    }
    if (!flow.code.trim()) {
      app.touch('connect.code');
      return;
    }
    flow.busy = true;
    flow.error = null;
    app.rerender('account');
    const submitted = flow.code.trim();
    void callServer<CodeResponse>('/connect/code', { code: submitted }).then((r) => {
      if (app.ui.flow !== flow) {
        return;
      }
      flow.busy = false;
      flow.code = '';
      app.untouch('connect.code');
      if (r && 'step' in r && r.step === 'done') {
        finishFlow(app, flow.email);
        return;
      }
      const error = r && 'error' in r ? r.error : 'expired';
      flow.error = error in CODE_ERRORS ? (error as 'wrong_code' | 'too_many' | 'expired') : 'expired';
      app.rerender('account');
    });
  });
  proceed.disabled = flow.busy || locked;
  const cancel = linkButton(CONNECT.cancel, () => endFlow(app));
  cancel.disabled = flow.busy;

  const node = card({
    title: cardName(CONNECT.codeTitle),
    body: [
      paragraph(body, 'gn-body'),
      paragraph(CONNECT.codeSecondLine, 'gn-body'),
      grid(gridCell(4, code)),
      flow.error ? statusBox('danger', CODE_ERRORS[flow.error]) : null,
      el('div', { class: 'gn-actions' }, proceed, cancel),
    ],
    cls: 'gn-account-card gn-connect',
  });
  if (!flow.busy && !locked) {
    window.setTimeout(() => node.querySelector<HTMLInputElement>('input')?.focus(), 0);
  }
  return node;
}

function unsupportedCard(app: App): HTMLElement {
  return card({
    title: cardName(ACCOUNT.title),
    body: [
      paragraph(CONNECT.unsupported, 'gn-body'),
      el('div', { class: 'gn-actions' }, outlineButton(CONNECT.cancel, () => endFlow(app))),
    ],
    cls: 'gn-account-card gn-connect',
  });
}

function renderFlow(app: App, flow: ConnectFlow): HTMLElement {
  switch (flow.step) {
  case 'credentials':
    return credentialsCard(app, flow);
  case 'code':
    return codeCard(app, flow);
  default:
    return unsupportedCard(app);
  }
}

export function renderAccount(app: App, container: HTMLElement): void {
  if (app.ui.flow) {
    container.appendChild(renderFlow(app, app.ui.flow));
    return;
  }
  const account = app.status?.account;
  if (!account) {
    container.appendChild(notConnectedCard(app, false));
    return;
  }
  switch (account.state) {
  case 'connected':
    container.appendChild(connectedCard(app, account.email ?? '', account.lastChecked));
    break;
  case 'reconnect_needed':
    container.appendChild(reconnectCard(app, account.email ?? ''));
    break;
  case 'checking':
    container.appendChild(checkingCard(app, account.email ?? ''));
    break;
  default:
    container.appendChild(notConnectedCard(app, true));
  }
}
