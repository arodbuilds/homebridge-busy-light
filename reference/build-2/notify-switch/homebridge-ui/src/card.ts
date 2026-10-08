import { formatDate, formatDateTime, formatTime } from '../../src/template.js';
import { HELP_TOGGLE, ID_FIELD, TELEGRAM_ONBOARDING, VARIABLES } from './copy.js';
import { clear, copyButton, el, helpLink, helpText, linkButton, linkOut, uniqueId } from './dom.js';
import type { UiConfig, UiSwitch } from './model.js';
import { qrElement } from './qr.js';

/**
 * Pieces shared by the provider, group and switch cards: the "Show help" toggle, the ID field under
 * Advanced, the Variables toggle next to message fields, and the QR block with its phone-friendly
 * alternative (SPEC section 11.2, items 14, 16 and 17).
 */

/** Remembered for the session only, per provider, group or switch object; nothing is written anywhere. */
const helpChoice = new WeakMap<object, boolean>();

/** Help text is expanded on wide screens and collapsed below 600px unless the user chose otherwise this session. */
export function helpExpanded(item: object): boolean {
  const remembered = helpChoice.get(item);
  if (remembered !== undefined) {
    return remembered;
  }
  return window.innerWidth >= 600;
}

/**
 * The per-card "Show help" / "Hide help" text button. It toggles `ns-help-hidden` on the card, which hides
 * every `.ns-help` line inside it (field help only; status lines, counters and errors stay visible).
 */
export function helpToggle(card: HTMLElement, item: object): HTMLButtonElement {
  const toggle = linkButton(HELP_TOGGLE.show, () => undefined, 'ns-help-toggle ns-secondary');
  const apply = (expanded: boolean): void => {
    card.classList.toggle('ns-help-hidden', !expanded);
    toggle.textContent = expanded ? HELP_TOGGLE.hide : HELP_TOGGLE.show;
    toggle.setAttribute('aria-pressed', expanded ? 'true' : 'false');
  };
  toggle.addEventListener('click', () => {
    const next = !helpExpanded(item);
    helpChoice.set(item, next);
    apply(next);
  });
  apply(helpExpanded(item));
  return toggle;
}

/**
 * The header strip shared by every card (SPEC section 11.2, item 28). Left cluster: the bold title (weight 700), the type badge and
 * the status badges (`badges`, filled later by the card); right cluster: the card's header links (`actions`, such as
 * "Make default for {channel}") and then the "Show help" / "Hide help" toggle. Every string is inserted as text.
 */
export function cardHeader(card: HTMLElement, item: object, title: HTMLElement, badges: HTMLElement[], actions: HTMLElement[]): HTMLElement {
  return el('div', { class: 'card-header ns-card-header' },
    el('span', { class: 'ns-card-title' }, title, ...badges),
    el('span', { class: 'ns-card-actions' }, ...actions, helpToggle(card, item)),
  );
}

/** A type badge (secondary fill) or a status badge (success fill, "Default for {channel}") for a card header. */
export function headerBadge(text: string, kind: 'type' | 'status', extra = ''): HTMLElement {
  const fill = kind === 'status' ? 'text-bg-success ns-status-badge' : 'text-bg-secondary ns-type-badge';
  return el('span', { class: `badge ${fill}${extra ? ` ${extra}` : ''}` }, text);
}

export interface IdFieldOptions {
  path: string;
  value: string;
  help: string;
  onChange?(value: string): void;
  /** False for the switch id, which is generated and never edited (SPEC section 11.2, item 8). Default true. */
  editable?: boolean;
}

/**
 * The ID, read-only with an Edit toggle, for people who hand-edit config.json (SPEC section 11.2, item 14).
 * Uniqueness and format are still validated; an issue opens the disclosure it sits in. Without `editable`
 * the field stays read-only and has no Edit link (the switch id, item 8).
 */
export function idField(opts: IdFieldOptions): HTMLElement {
  const id = uniqueId('id');
  const input = el('input', {
    id, class: 'form-control font-monospace', type: 'text', value: opts.value, autocomplete: 'off', spellcheck: 'false', readonly: true,
    'data-id-input': 'true',
  });
  const label = el('label', { class: 'form-label', for: id }, ID_FIELD.label);
  let labelRow: HTMLElement = label;
  if (opts.editable !== false) {
    input.addEventListener('input', () => opts.onChange?.(input.value));
    const edit = linkButton(ID_FIELD.edit, () => {
      input.readOnly = false;
      input.focus();
      input.select();
      edit.hidden = true;
    }, 'ns-id-edit');
    edit.setAttribute('aria-label', `${ID_FIELD.edit} ${ID_FIELD.label}`);
    labelRow = el('div', { class: 'ns-label-row' }, label, edit);
  }
  return el('div', { class: 'mb-3 ns-id-field', 'data-path': opts.path },
    labelRow,
    input,
    helpText(opts.help),
    el('div', { class: 'invalid-feedback' }),
  );
}

/** A template variable as the list shows it: the token and the value it would render right now. */
export type VariableValue = [token: string, value: string];

/**
 * What each variable would render at this moment (SPEC section 11.2, item 17): the switch's current name (or
 * "Switch name" while it is empty) and the time, date and both together in the platform's current Time format and
 * Date format settings, so the list doubles as a preview of those settings.
 */
export function variableValues(config: UiConfig, s: UiSwitch): VariableValue[] {
  const now = new Date();
  const formats = { timeFormat: config.timeFormat, dateFormat: config.dateFormat };
  return [
    ['{{switchName}}', s.name.trim() || VARIABLES.switchNamePlaceholder],
    ['{{time}}', formatTime(now, config.timeFormat)],
    ['{{date}}', formatDate(now, config.dateFormat)],
    ['{{datetime}}', formatDateTime(now, formats)],
  ];
}

/** A control the variable list can insert into: a text input or a textarea. */
type TextControl = HTMLInputElement | HTMLTextAreaElement;

/**
 * Inserts `token` at the caret of `control` (replacing any selection), puts the caret after it, returns focus to the
 * control and fires `input`, so the field's own handler runs exactly as it does for typing.
 */
function insertAtCaret(control: TextControl, token: string): void {
  const value = control.value;
  const start = control.selectionStart ?? value.length;
  const end = control.selectionEnd ?? start;
  control.value = `${value.slice(0, start)}${token}${value.slice(end)}`;
  control.focus();
  const caret = start + token.length;
  try {
    control.setSelectionRange(caret, caret);
  } catch {
    // An input type without a selection API; the value is set all the same.
  }
  control.dispatchEvent(new Event('input', { bubbles: true }));
}

export interface VariablesToggle {
  /** The link-styled toggle for the field's label row. */
  extra: HTMLElement;
  /** The variable list, inserted after the field's control. */
  box: HTMLElement;
  /** Ties the list to the control it inserts into; called once the field exists. */
  bind(control: TextControl): void;
}

/**
 * The "Show variables" / "Hide variables" toggle placed on a message or subject field's label row (SPEC
 * section 11.2, item 17): a link-styled button with a chevron that turns when the list is open. `extra`
 * goes into the field's `labelExtra`; `box` is inserted after the control and lists the template variables,
 * each a real button showing the token with the value it would render right now beside it. Clicking one
 * inserts the token at the field's caret. `values` is read every time the list opens, so the values are current.
 */
export function variablesToggle(values: () => VariableValue[]): VariablesToggle {
  let control: TextControl | undefined;
  const list = el('ul', { class: 'mb-1 ps-3 ns-variable-list' });
  const render = (): void => {
    clear(list);
    for (const [token, value] of values()) {
      const insert = linkButton('', () => {
        if (control) {
          insertAtCaret(control, token);
        }
      }, 'ns-variable');
      insert.appendChild(el('code', {}, token));
      insert.setAttribute('data-token', token);
      insert.setAttribute('aria-label', VARIABLES.insertLabel(token));
      // The value is inserted as text; a switch name can never become markup.
      list.appendChild(el('li', {}, insert, ' ', el('span', { class: 'ns-secondary ns-variable-value' }, value)));
    }
  };
  const box = el('div', { class: 'ns-variables form-text', hidden: true },
    el('div', {}, VARIABLES.intro),
    list,
    el('div', { class: 'ns-variables-help' }, VARIABLES.insertHelp),
    helpLink(VARIABLES.link),
  );
  const chevron = el('span', { class: 'ns-chevron', 'aria-hidden': 'true' });
  const label = el('span', {}, VARIABLES.show);
  const extra = linkButton('', () => {
    box.hidden = !box.hidden;
    const open = !box.hidden;
    if (open) {
      render();
    }
    extra.setAttribute('aria-expanded', open ? 'true' : 'false');
    extra.classList.toggle('ns-open', open);
    label.textContent = open ? VARIABLES.hide : VARIABLES.show;
  }, 'ns-variables-toggle');
  extra.appendChild(chevron);
  extra.appendChild(label);
  extra.setAttribute('aria-expanded', 'false');
  return {
    extra, box, bind: (target) => {
      control = target;
    },
  };
}

/**
 * A QR code with its caption. On narrow viewports and touch devices the stylesheet hides it (a phone
 * cannot scan its own screen) and shows `compactLinkActions` instead (SPEC section 11.2, item 16).
 */
export function qrBlock(url: string, label: string, caption: string): HTMLElement {
  return el('div', { class: 'ns-qr-block' }, qrElement(url, label), el('div', { class: 'ns-qr-caption ns-secondary small' }, caption));
}

/**
 * "Open in Telegram", "Copy link" and "Share" for a t.me link, shown only where the QR code is hidden.
 * Share uses the Web Share API and is hidden when the browser does not offer it.
 */
export function compactLinkActions(url: string, shareText: string): HTMLElement {
  const copy = TELEGRAM_ONBOARDING;
  const share = el('button', { type: 'button', class: 'btn btn-outline-secondary btn-sm ns-share' }, copy.share);
  const nav = navigator as Navigator & { share?: (data: { title?: string; text?: string; url?: string }) => Promise<void> };
  if (typeof nav.share !== 'function') {
    share.hidden = true;
  } else {
    share.addEventListener('click', () => {
      nav.share?.({ text: shareText, url }).catch(() => undefined);
    });
  }
  return el('div', { class: 'ns-compact-actions' },
    linkOut(copy.openInTelegram, url, 'btn btn-outline-primary btn-sm'),
    copyButton(copy.copyLink, () => url),
    share,
  );
}
