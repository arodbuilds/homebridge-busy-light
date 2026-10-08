/**
 * Tiny DOM helpers. The UI is plain HTML built with these; Bootstrap 5 classes come from the
 * Homebridge UI, which injects its stylesheet and theme into the settings iframe.
 */

import { GET_STARTED, RESULT_BAR } from './copy.js';

type Child = Node | string | null | undefined | false;

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
    } else if (key === 'text') {
      node.textContent = String(value);
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

export interface HelpLinkSpec {
  text: string;
  href: string;
}

export interface FieldOptions {
  /** Validation path this control edits, for example `providers[0].apiKeySid`; used to show inline errors. */
  path?: string;
  /** One sentence of field help; hidden by the card's "Show help" toggle. */
  help?: string;
  /** A "Where do I find this?" style link appended to the help sentence. */
  helpLink?: HelpLinkSpec;
  /** Extra control rendered on the label row, right aligned (the Variables toggle). */
  labelExtra?: HTMLElement;
  placeholder?: string;
  type?: string;
  required?: boolean;
  autocomplete?: string;
  inputmode?: string;
  min?: number;
  max?: number;
  monospace?: boolean;
}

/** An outlined link that opens in a new tab, styled as a button. */
export function linkOut(label: string, href: string, cls = 'btn btn-outline-primary btn-sm'): HTMLAnchorElement {
  return el('a', { class: cls, href, target: '_blank', rel: 'noopener noreferrer', role: 'button' }, label);
}

/** A plain link to the README that opens in a new tab. */
export function helpLink(link: HelpLinkSpec): HTMLAnchorElement {
  return el('a', { class: 'ns-help-link', href: link.href, target: '_blank', rel: 'noopener noreferrer' }, link.text);
}

/**
 * One line of field help: a sentence and, optionally, a README link. Carries `ns-help` so the card's
 * "Show help" toggle can collapse it; status lines and counters do not carry the class and stay visible.
 */
export function helpText(text: string, link?: HelpLinkSpec, extra = ''): HTMLElement {
  return el('div', { class: `form-text ns-help${extra ? ` ${extra}` : ''}` }, text, link ? ' ' : null, link ? helpLink(link) : null);
}

function wrapField(id: string, label: string, control: HTMLElement, opts: FieldOptions, invalidTarget?: HTMLElement): HTMLElement {
  const star = opts.required ? el('span', { class: 'text-danger ms-1', 'aria-hidden': 'true' }, '*') : null;
  const labelNode = el('label', { class: 'form-label', for: id }, label, star);
  return el('div', { class: 'mb-3', 'data-path': opts.path, 'data-invalid-target': invalidTarget ? 'group' : undefined },
    opts.labelExtra ? el('div', { class: 'ns-label-row' }, labelNode, opts.labelExtra) : labelNode,
    control,
    opts.help ? helpText(opts.help, opts.helpLink) : null,
    el('div', { class: 'invalid-feedback' }),
  );
}

/**
 * A collapsed disclosure ("Advanced", "Common settings"). The summary is secondary text in the theme's
 * colour so it stays readable in dark mode (SPEC section 11.2, item 18).
 */
export function disclosure(summary: string, body: Node[], opts: { open?: boolean; cls?: string; attrs?: Record<string, string> } = {}): HTMLDetailsElement {
  const details = el('details', { class: `ns-advanced${opts.cls ? ` ${opts.cls}` : ''}`, ...(opts.attrs ?? {}) },
    el('summary', { class: 'ns-secondary small' }, summary),
    el('div', { class: 'mt-2' }, ...body),
  );
  if (opts.open) {
    details.open = true;
  }
  return details;
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

/** A number input; `onChange` receives the parsed integer or NaN. */
export function numberField(label: string, value: number, onChange: (value: number) => void, opts: FieldOptions = {}): HTMLElement {
  const id = uniqueId();
  const input = el('input', {
    id, class: 'form-control', type: 'number', value: String(value), inputmode: 'numeric',
    min: opts.min !== undefined ? String(opts.min) : undefined, max: opts.max !== undefined ? String(opts.max) : undefined, step: '1',
  });
  input.addEventListener('input', () => onChange(input.value.trim() === '' ? Number.NaN : Number(input.value)));
  return wrapField(id, label, input, opts);
}

/**
 * A password input with a Show/Hide toggle. The value is never echoed anywhere but the input itself.
 * `autocomplete` is `new-password` because browsers ignore `off` on password inputs and would offer the
 * saved Homebridge login, silently replacing a pasted secret. The toggle only flips `type`; the value is untouched.
 */
export function passwordField(label: string, value: string, onChange: (value: string) => void, opts: FieldOptions = {}): HTMLElement {
  const id = uniqueId();
  const input = el('input', { id, class: 'form-control font-monospace', type: 'password', value, autocomplete: 'new-password', spellcheck: 'false' });
  input.addEventListener('input', () => onChange(input.value));
  const toggle = el('button', { class: 'btn btn-outline-secondary', type: 'button', 'aria-label': `Show ${label}` }, 'Show');
  toggle.addEventListener('click', () => {
    const reveal = input.type === 'password';
    input.type = reveal ? 'text' : 'password';
    toggle.textContent = reveal ? 'Hide' : 'Show';
    toggle.setAttribute('aria-label', `${reveal ? 'Hide' : 'Show'} ${label}`);
  });
  const group = el('div', { class: 'input-group' }, input, toggle);
  return wrapField(id, label, group, opts, input);
}

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export function selectField(label: string, value: string, options: SelectOption[], onChange: (value: string) => void, opts: FieldOptions = {}): HTMLElement {
  const id = uniqueId();
  const select = el('select', { id, class: 'form-select' });
  for (const option of options) {
    const node = el('option', { value: option.value, disabled: option.disabled }, option.label);
    if (option.value === value) {
      node.selected = true;
    }
    select.appendChild(node);
  }
  select.addEventListener('change', () => onChange(select.value));
  return wrapField(id, label, select, opts);
}

export function checkboxField(label: string, checked: boolean, onChange: (checked: boolean) => void, opts: FieldOptions = {}): HTMLElement {
  const id = uniqueId();
  const input = el('input', { id, class: 'form-check-input', type: 'checkbox' });
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  const wrapper = el('div', { class: 'form-check mb-3', 'data-path': opts.path },
    input,
    el('label', { class: 'form-check-label', for: id }, label),
    opts.help ? helpText(opts.help, opts.helpLink) : null,
    el('div', { class: 'invalid-feedback' }),
  );
  return wrapper;
}

export function textareaField(label: string, value: string, onChange: (value: string) => void, opts: FieldOptions & { rows?: number } = {}): HTMLElement {
  const id = uniqueId();
  const input = el('textarea', { id, class: 'form-control', rows: String(opts.rows ?? 3), placeholder: opts.placeholder });
  input.value = value;
  input.addEventListener('input', () => onChange(input.value));
  return wrapField(id, label, input, opts);
}

export function button(label: string, onClick: () => void, cls = 'btn btn-outline-primary btn-sm'): HTMLButtonElement {
  const node = el('button', { type: 'button', class: cls }, label);
  node.addEventListener('click', onClick);
  return node;
}

export function paragraph(text: string, cls = 'section-copy'): HTMLElement {
  return el('p', { class: cls }, text);
}

/** The classes of a section's Add button (SPEC section 11.2, item 28): 38px primary, or outlined secondary while gated. */
export function sectionAddClass(enabled: boolean): string {
  return enabled ? 'btn btn-primary ns-section-add' : 'btn btn-outline-secondary ns-section-add';
}

/**
 * A section's Add button (Add group, Add switch): the one 38px primary button of a section (SPEC section 11.2,
 * item 28). While no provider exists it is disabled, drawn as an outlined button so it reads as disabled on
 * every theme, with the "Add a provider first." hint beside it (item 19).
 */
export function addButton(label: string, onClick: () => void, enabled: boolean): HTMLElement {
  const node = button(label, onClick, sectionAddClass(enabled));
  if (enabled) {
    return node;
  }
  node.disabled = true;
  node.title = GET_STARTED.addProviderFirst;
  return el('div', { class: 'ns-add-row' }, node, el('span', { class: 'form-text ns-add-hint' }, GET_STARTED.addProviderFirst));
}

/** A cell of the 12-column grid (SPEC section 11.2, item 28): `span` columns wide, full width below 600px. */
export function gridCell(span: number, ...children: Child[]): HTMLElement {
  return el('div', { class: `ns-span-${span}` }, ...children);
}

/** The 12-column grid with its 8px column gap; `cells` come from `gridCell`. */
export function grid(...cells: Child[]): HTMLElement {
  return el('div', { class: 'ns-grid' }, ...cells);
}


/** Inline status line under a button: `kind` picks the Bootstrap alert colour. */
export function statusBox(): { el: HTMLElement; set(kind: 'success' | 'danger' | 'warning' | 'info' | 'none', message: string, detail?: Node): void } {
  const box = el('div', { class: 'status-box', role: 'status' });
  return {
    el: box,
    set(kind, message, detail) {
      clear(box);
      box.className = 'status-box';
      if (kind === 'none') {
        return;
      }
      box.className = `status-box alert alert-${kind} py-2 px-3 mb-0`;
      append(box, el('div', {}, message), detail ?? null);
    },
  };
}

/** A link-style (text) button: no border or background, used for secondary actions such as Cancel and Dismiss. */
export function linkButton(label: string, onClick: () => void, extra = ''): HTMLButtonElement {
  return button(label, onClick, `btn btn-link btn-sm p-0 ns-link-button${extra ? ` ${extra}` : ''}`);
}

/**
 * The result bar of a card (SPEC section 11.2, item 28): between the body and the footer strip, holding a Test
 * connection or Test send result until its Dismiss link is used. Empty, it takes no space.
 */
export function resultBar(): { el: HTMLElement; show(...content: Node[]): void; clear(): void } {
  const bar = el('div', { class: 'ns-card-results' });
  return {
    el: bar,
    show(...content) {
      clear(bar);
      append(bar, ...content, linkButton(RESULT_BAR.dismiss, () => clear(bar), 'ns-result-dismiss'));
    },
    clear: () => clear(bar),
  };
}

/** An outlined secondary button: every "Add …" control and Cancel in the chooser (SPEC section 11.2, item 11). */
export function outlineButton(label: string, onClick: () => void, extra = ''): HTMLButtonElement {
  return button(label, onClick, `btn btn-outline-secondary btn-sm${extra ? ` ${extra}` : ''}`);
}

/** Replaces the sentence and link of a field's help line (the SMTP password help follows the chosen mail provider). */
export function setHelp(field: HTMLElement, text: string, link?: HelpLinkSpec): void {
  const help = field.querySelector<HTMLElement>(':scope > .ns-help');
  if (!help) {
    return;
  }
  clear(help);
  append(help, text, link ? ' ' : null, link ? helpLink(link) : null);
}

export interface InlineConfirmOptions {
  /** The button that opens the confirmation; it is put back when the confirmation closes. */
  start: HTMLElement;
  /** The question shown in place of the button, computed when it opens. */
  question: () => string;
  confirmLabel: string;
  /** Classes of the confirm button, for example `btn btn-danger btn-sm`. */
  confirmClass: string;
  cancelLabel: string;
  onConfirm: () => void;
  /** Extra class on the container, for tests and layout. */
  cls?: string;
}

/**
 * In-place confirmation (SPEC section 11.2, item 11): clicking `start` replaces it with the question, a
 * confirm button and a text Cancel button. Escape or Cancel restores the original button. Shared by Test
 * send and the three Remove buttons so they behave the same way.
 */
export function inlineConfirm(opts: InlineConfirmOptions): HTMLElement {
  const control = el('span', { class: `d-inline-flex flex-wrap align-items-center gap-2 ns-inline-confirm${opts.cls ? ` ${opts.cls}` : ''}` });
  let onKey: (event: KeyboardEvent) => void = () => undefined;
  const reset = (): void => {
    document.removeEventListener('keydown', onKey);
    clear(control);
    control.appendChild(opts.start);
  };
  onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      reset();
    }
  };
  opts.start.addEventListener('click', () => {
    clear(control);
    control.appendChild(el('span', { class: 'small ns-confirm-question' }, opts.question()));
    const confirm = button(opts.confirmLabel, () => {
      reset();
      opts.onConfirm();
    }, opts.confirmClass);
    control.appendChild(confirm);
    control.appendChild(linkButton(opts.cancelLabel, reset));
    document.addEventListener('keydown', onKey);
    confirm.focus();
  });
  control.appendChild(opts.start);
  return control;
}

/** A red text button: Remove and Reset only (SPEC section 11.3). `ns-danger-link` keeps it red under the host's dark marker (item 28). */
export function dangerLinkButton(label: string, onClick: () => void): HTMLButtonElement {
  return linkButton(label, onClick, 'text-danger ns-danger-link');
}

/**
 * Card footer strip (SPEC section 11.2, items 11 and 28): the red text button on the left (with the Duplicate text
 * button beside it on switch and group cards), at most one outlined primary action on the right. `right` may be
 * empty. The primary side comes first in the markup and the stylesheet reverses the row, so when the footer wraps
 * on a phone the primary action stays on top.
 */
export function cardFooter(left: HTMLElement | HTMLElement[] | null, right: HTMLElement | null): HTMLElement {
  return el('div', { class: 'card-footer ns-card-footer' },
    el('div', { class: 'ns-footer-right' }, right),
    el('div', { class: 'ns-footer-left' }, ...(Array.isArray(left) ? left : [left])),
  );
}

/**
 * The footer's primary action (Test connection, Test send): an outlined, link-coloured 31px button
 * (SPEC section 11.2, item 28).
 */
export function footerAction(label: string, onClick?: () => void): HTMLButtonElement {
  return button(label, onClick ?? (() => undefined), 'btn btn-outline-primary btn-sm ns-footer-action');
}

export interface ModalHandle {
  el: HTMLElement;
  close(): void;
}

/**
 * A full-page modal over the settings page, closed by its Close button, the backdrop, or Escape.
 * `body` is the content; `actions` go in the footer row. The Homebridge UI's own modal does not
 * reach into the iframe, so the page draws its own.
 */
export function openModal(opts: { title: string; body: Node; actions?: Node[]; wide?: boolean }): ModalHandle {
  const backdrop = el('div', { class: 'ns-modal-backdrop', role: 'presentation' });
  const dialog = el('div', { class: `ns-modal${opts.wide ? ' ns-modal-wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.title });
  let onKey: (event: KeyboardEvent) => void = () => undefined;
  const close = (): void => {
    document.removeEventListener('keydown', onKey);
    backdrop.remove();
  };
  onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  };
  document.addEventListener('keydown', onKey);
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) {
      close();
    }
  });
  const closeButton = el('button', { type: 'button', class: 'btn-close', 'aria-label': 'Close' });
  closeButton.addEventListener('click', close);
  dialog.appendChild(el('div', { class: 'ns-modal-header' }, el('div', { class: 'fw-semibold' }, opts.title), closeButton));
  dialog.appendChild(el('div', { class: 'ns-modal-body' }, opts.body));
  if (opts.actions && opts.actions.length > 0) {
    dialog.appendChild(el('div', { class: 'ns-modal-actions' }, ...opts.actions));
  }
  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);
  return { el: dialog, close };
}

/**
 * Copies text to the clipboard. The Homebridge UI usually runs over plain http on the LAN, where the
 * async clipboard API is unavailable, so a hidden textarea and `execCommand` are the fallback.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const area = el('textarea', { class: 'ns-clipboard', 'aria-hidden': 'true' });
    area.value = text;
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

/** A button that copies `text` and briefly reads "Copied" afterwards. */
export function copyButton(label: string, text: () => string, cls = 'btn btn-outline-secondary btn-sm'): HTMLButtonElement {
  const node = button(label, () => {
    copyText(text()).then((ok) => {
      node.textContent = ok ? 'Copied' : 'Could not copy';
      window.setTimeout(() => {
        node.textContent = label;
      }, 1500);
    }).catch(() => undefined);
  }, cls);
  return node;
}
