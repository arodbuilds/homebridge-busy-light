/**
 * Tiny DOM helpers on the shell's field and button anatomy (homebridge-notify-switch homebridge-ui/src/dom.ts, the
 * pieces this page needs). The UI is plain HTML built with these; Bootstrap 5 classes come from the Homebridge
 * UI, which injects its stylesheet and theme into the settings iframe.
 */

import { SHELL } from './copy.js';

export type Child = Node | string | null | undefined | false;

export function append(parent: Node, ...children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) {
      continue;
    }
    parent.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, attrs: Record<string, string | boolean | undefined> = {}, ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) {
      continue;
    }
    if (key === 'class') {
      node.className = String(value);
    } else if (value === true) {
      node.setAttribute(key, '');
    } else {
      node.setAttribute(key, value);
    }
  }
  append(node, ...children);
  return node;
}

export function clear(node: Node): void {
  while (node.firstChild) {
    node.removeChild(node.firstChild);
  }
}

let idCounter = 0;
export function uniqueId(prefix = 'f'): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

export interface FieldOptions {
  /** Validation path this control edits (`name`, `generators[2].name`); used to show inline errors. */
  path?: string;
  help?: string;
  placeholder?: string;
  type?: string;
  required?: boolean;
  autocomplete?: string;
  inputmode?: string;
  min?: number;
  max?: number;
  step?: string;
  monospace?: boolean;
  /** How a number field shows a value on load and after blur; null leaves the typed text alone (an invalid value keeps its message). */
  format?: (value: number) => string | null;
}

/** One line of field help. Carries `ns-help` like the shell so a help toggle could collapse it. */
export function helpText(text: string, extra = ''): HTMLElement {
  return el('div', { class: `form-text ns-help${extra ? ` ${extra}` : ''}` }, text);
}

function wrapField(id: string, label: string, control: HTMLElement, opts: FieldOptions, invalidTarget?: HTMLElement): HTMLElement {
  const star = opts.required ? el('span', { class: 'text-danger ms-1', 'aria-hidden': 'true' }, '*') : null;
  return el('div', { class: 'mb-3', 'data-path': opts.path, 'data-invalid-target': invalidTarget ? 'group' : undefined },
    el('label', { class: 'form-label', for: id }, label, star),
    control,
    opts.help ? helpText(opts.help) : null,
    el('div', { class: 'invalid-feedback' }),
  );
}

/** A labelled input with optional help text, calling `onChange` with the new string on every input event. */
export function textField(label: string, value: string, onChange: (value: string) => void, opts: FieldOptions = {}): HTMLElement {
  const id = uniqueId();
  const input = el('input', {
    id,
    class: `form-control${opts.monospace ? ' font-monospace' : ''}`,
    type: opts.type ?? 'text',
    value,
    placeholder: opts.placeholder,
    autocomplete: opts.autocomplete ?? 'off',
    inputmode: opts.inputmode,
    spellcheck: 'false',
  });
  input.addEventListener('input', () => onChange(input.value));
  return wrapField(id, label, input, opts);
}

/** A number input; `onChange` receives the parsed number or NaN. With `format`, the value is shown formatted on load and after blur. */
export function numberField(label: string, value: number, onChange: (value: number) => void, opts: FieldOptions = {}): HTMLElement {
  const id = uniqueId();
  const shown = (v: number): string => (Number.isFinite(v) ? opts.format?.(v) ?? String(v) : '');
  const input = el('input', {
    id, class: 'form-control', type: 'number', value: shown(value), inputmode: opts.step ? 'decimal' : 'numeric',
    min: opts.min !== undefined ? String(opts.min) : undefined, max: opts.max !== undefined ? String(opts.max) : undefined, step: opts.step ?? '1',
  });
  const parse = (): number => (input.value.trim() === '' ? Number.NaN : Number(input.value));
  input.addEventListener('input', () => onChange(parse()));
  if (opts.format) {
    input.addEventListener('blur', () => {
      const formatted = shown(parse());
      if (formatted && formatted !== input.value) {
        input.value = formatted;
      }
    });
  }
  return wrapField(id, label, input, opts);
}

/**
 * A password input with a Show/Hide toggle. The value is never echoed anywhere but the input itself.
 * `autocomplete` is `new-password` because browsers ignore `off` on password inputs and would offer the
 * saved Homebridge login. The toggle only flips `type`; the value is untouched.
 */
export function passwordField(label: string, value: string, onChange: (value: string) => void, opts: FieldOptions = {}): HTMLElement {
  const id = uniqueId();
  const input = el('input', { id, class: 'form-control font-monospace', type: 'password', value, autocomplete: 'new-password', spellcheck: 'false' });
  input.addEventListener('input', () => onChange(input.value));
  const toggle = el('button', { class: 'btn btn-outline-secondary', type: 'button', 'aria-label': `${SHELL.show} ${label}` }, SHELL.show);
  toggle.addEventListener('click', () => {
    const reveal = input.type === 'password';
    input.type = reveal ? 'text' : 'password';
    toggle.textContent = reveal ? SHELL.hide : SHELL.show;
    toggle.setAttribute('aria-label', `${reveal ? SHELL.hide : SHELL.show} ${label}`);
  });
  const group = el('div', { class: 'input-group' }, input, toggle);
  return wrapField(id, label, group, opts, input);
}

export function checkboxField(label: string, checked: boolean, onChange: (checked: boolean) => void, opts: FieldOptions = {}): HTMLElement {
  const id = uniqueId();
  const input = el('input', { id, class: 'form-check-input', type: 'checkbox' });
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  return el('div', { class: 'form-check mb-3', 'data-path': opts.path },
    input,
    el('label', { class: 'form-check-label', for: id }, label),
    opts.help ? helpText(opts.help) : null,
    el('div', { class: 'invalid-feedback' }),
  );
}

export function button(label: string, onClick: () => void, cls = 'btn btn-outline-primary btn-sm'): HTMLButtonElement {
  const node = el('button', { type: 'button', class: cls }, label);
  node.addEventListener('click', onClick);
  return node;
}

export function paragraph(text: string, cls = 'section-copy'): HTMLElement {
  return el('p', { class: cls }, text);
}

/** The one 38px primary button of a section (Connect, Reconnect, Sign in, Continue). */
export function primaryButton(label: string, onClick: () => void): HTMLButtonElement {
  return button(label, onClick, 'btn btn-primary ns-section-add');
}

/** A link-style (text) button: no border or background, for Cancel, Keep and Disconnect. */
export function linkButton(label: string, onClick: () => void, extra = ''): HTMLButtonElement {
  return button(label, onClick, `btn btn-link btn-sm p-0 ns-link-button${extra ? ` ${extra}` : ''}`);
}

/** A red text button: Reset only. */
export function dangerLinkButton(label: string, onClick: () => void): HTMLButtonElement {
  return linkButton(label, onClick, 'text-danger ns-danger-link');
}

/** An outlined secondary 31px button (the Unsupported factor Cancel). */
export function outlineButton(label: string, onClick: () => void, extra = ''): HTMLButtonElement {
  return button(label, onClick, `btn btn-outline-secondary btn-sm${extra ? ` ${extra}` : ''}`);
}

/** The card footer's primary action (Rename): an outlined, link-coloured 31px button. */
export function footerAction(label: string, onClick: () => void): HTMLButtonElement {
  return button(label, onClick, 'btn btn-outline-primary btn-sm ns-footer-action');
}

/** A cell of the 12-column grid: `span` columns wide, full width below 600px. */
export function gridCell(span: number, ...children: Child[]): HTMLElement {
  return el('div', { class: `ns-span-${span}` }, ...children);
}

/** The 12-column grid with its 8px column gap; `cells` come from `gridCell`. */
export function grid(...cells: Child[]): HTMLElement {
  return el('div', { class: 'ns-grid' }, ...cells);
}

/** A collapsed disclosure ("Advanced"). */
export function disclosure(summary: string, body: Node[], opts: { open?: boolean; cls?: string } = {}): HTMLDetailsElement {
  const details = el('details', { class: `ns-advanced${opts.cls ? ` ${opts.cls}` : ''}` },
    el('summary', { class: 'ns-secondary small' }, summary),
    el('div', { class: 'mt-2' }, ...body),
  );
  if (opts.open) {
    details.open = true;
  }
  return details;
}

/** A toned status box (a Connect error). */
export function statusBox(kind: 'danger' | 'warning' | 'info', message: string): HTMLElement {
  return el('div', { class: `status-box alert alert-${kind} py-2 px-3 mb-3`, role: 'status' }, message);
}

/**
 * Brings a control that just opened into view. The page sits in an iframe the host sizes to the content, so a
 * `scrollIntoView` here scrolls the host's modal (same-origin). The host learns the new height a moment after the
 * page grows (its ResizeObserver posts it to the parent), so the call is made now and once more after that.
 */
export function reveal(node: HTMLElement): void {
  const scroll = (): void => {
    try {
      node.scrollIntoView({ block: 'center' });
    } catch {
      // An old browser without the options form: leave the page where it is.
    }
  };
  scroll();
  window.setTimeout(scroll, 250);
}

export interface InlineConfirmOptions {
  /** The button that opens the confirmation; it is put back when the confirmation closes. */
  start: HTMLElement;
  question: string;
  confirmLabel: string;
  confirmClass: string;
  cancelLabel: string;
  onConfirm: () => void;
  onOpen?: (open: boolean) => void;
  /** Draw the question already open (the page keeps it as state across a redraw); focus is left alone. */
  open?: boolean;
  cls?: string;
}

/**
 * In-place confirmation: clicking `start` replaces it with the question, a confirm button and a text Cancel
 * button. Escape or Cancel restores the original button.
 */
export function inlineConfirm(opts: InlineConfirmOptions): HTMLElement {
  const control = el('span', { class: `d-inline-flex flex-wrap align-items-center gap-2 ns-inline-confirm${opts.cls ? ` ${opts.cls}` : ''}` });
  let onKey: (event: KeyboardEvent) => void = () => undefined;
  const reset = (): void => {
    document.removeEventListener('keydown', onKey);
    clear(control);
    control.appendChild(opts.start);
    opts.onOpen?.(false);
  };
  onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      reset();
    }
  };
  const show = (clicked: boolean): void => {
    clear(control);
    control.appendChild(el('span', { class: 'small ns-confirm-question' }, opts.question));
    const confirm = button(opts.confirmLabel, () => {
      reset();
      opts.onConfirm();
    }, opts.confirmClass);
    control.appendChild(confirm);
    control.appendChild(linkButton(opts.cancelLabel, reset));
    document.addEventListener('keydown', onKey);
    if (clicked) {
      opts.onOpen?.(true);
      confirm.focus();
      reveal(control);
    }
  };
  opts.start.addEventListener('click', () => show(true));
  if (opts.open) {
    show(false);
  } else {
    control.appendChild(opts.start);
  }
  return control;
}

export interface InlineDialogHandle {
  el: HTMLElement;
  close(): void;
}

/**
 * A dialog in the page flow (the Reset dialog), drawn where it is opened rather than over the page: a fixed
 * overlay would pin to the iframe's own top, off-screen when the opener sits at the bottom of a scrolled host
 * modal. Escape closes it; `onClose` runs on every close, including the caller's. It is a Bootstrap `card`, so
 * the host paints it like every other card in both themes: the dark theme sets the card's fill and text itself and
 * leaves `--bs-body-bg` at its light value, so a panel of its own would be white on the dark page (SPEC section 11.2).
 */
export function inlineDialog(opts: { title: string; body: Node; actions: Node[]; onClose?: () => void }): InlineDialogHandle {
  const dialog = el('div', { class: 'card ns-inline-dialog', role: 'dialog', 'aria-label': opts.title });
  let onKey: (event: KeyboardEvent) => void = () => undefined;
  const close = (): void => {
    document.removeEventListener('keydown', onKey);
    dialog.remove();
    opts.onClose?.();
  };
  onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  };
  document.addEventListener('keydown', onKey);
  dialog.appendChild(el('div', { class: 'ns-inline-dialog-title fw-semibold' }, opts.title));
  dialog.appendChild(el('div', { class: 'ns-inline-dialog-body' }, opts.body));
  dialog.appendChild(el('div', { class: 'ns-inline-dialog-actions' }, ...opts.actions));
  return { el: dialog, close };
}
