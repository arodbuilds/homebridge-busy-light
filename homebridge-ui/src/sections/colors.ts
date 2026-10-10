/**
 * Colors (SPEC 11.3 D): one card holding a row per status in the precedence order of SPEC 6.3: the display name and a
 * radio group of preset swatches (Red, Orange, Yellow, Green, Blue, Purple, White, Off and Custom). A saved color equal
 * to a preset selects it; any other `#RRGGBB` selects Custom, which shows the browser's color picker and the hex field.
 * Arrow keys move between the swatches. The configuration format does not change: `#RRGGBB` or `off`.
 *
 * From build 3.1 only the statuses the configuration on the page can produce have rows; the others wait behind a line
 * and Show all statuses. Statuses stay in the engine and in `config.json` as they are; only the page chooses what to show.
 */

import type { App } from '../app.js';
import { COLORS, STATUS_NAMES, type StatusKey } from '../copy.js';
import { el, grid, gridCell, linkButton, paragraph, selectField, uniqueId, type SelectOption } from '../dom.js';
import { formatDuration, parseDate } from '../format.js';
import { DEFAULTS, MEETING_WARNINGS, STATUS_KEYS } from '../model.js';

/** The statuses only a live source can give: Teams presence, another app, or (In a call) the On a Call switch. */
const LIVE: readonly StatusKey[] = ['doNotDisturb', 'inCall', 'busy', 'away', 'offline'];

/** An app's report shows a status's row for this long after it (SPEC 11.3 D, from build 3.2). */
export const REPORTED_SHOWS_MS = 30 * 86_400_000;

/**
 * Whether a status can happen with the configuration on the page, as edited, and the reports the running plugin has
 * seen (SPEC 11.3 D): Out of office, In a meeting, Tentative and Available always; In a call with the On a Call switch,
 * the status input or Teams status; Do not disturb, Busy, Away and Offline with Teams status, or once an app has
 * reported that status in the last 30 days. The status input alone no longer shows those four (build 3.2).
 */
export function canHappen(app: App, key: StatusKey): boolean {
  if (!LIVE.includes(key)) {
    return true;
  }
  const c = app.config;
  if (c.calendars.some((s) => s.type === 'microsoft' && s.useTeamsStatus)) {
    return true;
  }
  if (key === 'inCall') {
    return c.callSwitch.enabled || c.statusInput.enabled;
  }
  const at = parseDate(app.status?.statusInput?.reported?.[key]);
  return at !== null && Date.now() - at.getTime() <= REPORTED_SHOWS_MS;
}

/** Which statuses can happen, as one value, so a /status answer redraws Colors and the sensors only when it changes. */
function shownKey(app: App): string {
  return STATUS_KEYS.filter((key) => canHappen(app, key)).join(',');
}

/** The status input, the On a Call switch or a source's Teams status changed: Colors and the sensors follow. */
export function statusesChanged(app: App): void {
  app.rerender('colors');
  app.rerender('lights');
}

/** After each /status answer: a status reported for the first time in 30 days shows its row (SPEC 11.3 D). */
export function colorsOnStatus(app: App): void {
  if (app.ui.colorsShown !== shownKey(app)) {
    statusesChanged(app);
  }
}

const HEX = /^#[0-9a-f]{6}$/i;

/** One choice of the radio group: a preset, Off or Custom. */
type Choice = { kind: 'preset'; name: string; hex: string } | { kind: 'off' } | { kind: 'custom' };

const CHOICES: Choice[] = [...COLORS.presets.map((p) => ({ kind: 'preset' as const, ...p })), { kind: 'off' }, { kind: 'custom' }];

/** Rows where Custom was chosen on this page, so a custom color equal to a preset stays under Custom while edited. */
const customChosen = new Set<StatusKey>();
/** The last custom color of each row, so choosing Custom again after a preset or Off brings it back. */
const lastCustom = new Map<StatusKey, string>();

/** The preset a color selects (SPEC 11.3 D), without regard to case, or null. */
export function presetOf(value: string): string | null {
  const v = value.trim().toUpperCase();
  return COLORS.presets.find((p) => p.hex === v)?.name ?? null;
}

/** The choice a row shows for its value. */
function selected(key: StatusKey, value: string): number {
  if (value.trim().toLowerCase() === 'off') {
    return CHOICES.findIndex((c) => c.kind === 'off');
  }
  const preset = presetOf(value);
  if (preset && !customChosen.has(key)) {
    return CHOICES.findIndex((c) => c.kind === 'preset' && c.name === preset);
  }
  return CHOICES.findIndex((c) => c.kind === 'custom');
}

function choiceName(c: Choice): string {
  return c.kind === 'preset' ? c.name : c.kind === 'off' ? COLORS.off : COLORS.custom;
}

function colorRow(app: App, key: StatusKey): HTMLElement {
  const nameId = uniqueId('color');
  const hexId = uniqueId('hex');
  const value = (): string => app.config.colors[key];
  if (HEX.test(value()) && !presetOf(value())) {
    lastCustom.set(key, value().toUpperCase());
  }
  const customValue = (): string => (HEX.test(value()) ? value().toUpperCase() : lastCustom.get(key) ?? '#FFFFFF');
  const picker = el('input', { type: 'color', class: 'form-control form-control-color bl-color-swatch', 'aria-labelledby': nameId });
  const hex = el('input', {
    id: hexId, type: 'text', class: 'form-control font-monospace ns-control bl-color-hex', maxlength: '7', autocomplete: 'off', spellcheck: 'false',
    'aria-labelledby': nameId,
  });
  const custom = el('div', { class: 'bl-color-custom' }, picker, hex);
  const buttons = CHOICES.map((c) => {
    const swatch = el('span', { class: `bl-preset-swatch${c.kind === 'off' ? ' bl-preset-off' : ''}`, 'aria-hidden': 'true' });
    if (c.kind === 'preset') {
      swatch.setAttribute('style', `background-color: ${c.hex}`);
    }
    return el('button', {
      type: 'button', role: 'radio', class: `bl-preset bl-preset-${c.kind === 'preset' ? c.name.toLowerCase() : c.kind}`,
      'aria-label': choiceName(c), title: choiceName(c),
    }, swatch, el('span', { class: 'bl-preset-label', 'aria-hidden': 'true' }, choiceName(c)));
  });
  const customSwatch = buttons[buttons.length - 1].querySelector<HTMLElement>('.bl-preset-swatch')!;

  /** Draws the row's state in place, so focus stays on the swatch the keyboard is on. */
  const draw = (): void => {
    const index = selected(key, value());
    buttons.forEach((b, i) => {
      b.setAttribute('aria-checked', i === index ? 'true' : 'false');
      b.setAttribute('tabindex', i === index ? '0' : '-1');
    });
    const isCustom = CHOICES[index].kind === 'custom';
    custom.hidden = !isCustom;
    const shown = customValue();
    customSwatch.setAttribute('style', `background-color: ${shown}`);
    if (isCustom && document.activeElement !== hex) {
      hex.value = HEX.test(value()) ? value().toUpperCase() : value();
    }
    picker.value = shown.toLowerCase();
  };

  const choose = (index: number): void => {
    const c = CHOICES[index];
    if (c.kind === 'custom') {
      customChosen.add(key);
      if (!HEX.test(value())) {
        app.config.colors[key] = customValue();
      }
    } else {
      if (HEX.test(value()) && (customChosen.has(key) || !presetOf(value()))) {
        lastCustom.set(key, value().toUpperCase());
      }
      customChosen.delete(key);
      app.config.colors[key] = c.kind === 'off' ? 'off' : c.hex;
    }
    app.changed();
    draw();
  };

  buttons.forEach((b, i) => b.addEventListener('click', () => choose(i)));
  const group = el('div', { class: 'bl-presets', role: 'radiogroup', 'aria-labelledby': nameId }, ...buttons);
  group.addEventListener('keydown', (event) => {
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) {
      return;
    }
    const moves: Record<string, number> = { ArrowRight: at + 1, ArrowDown: at + 1, ArrowLeft: at - 1, ArrowUp: at - 1, Home: 0, End: buttons.length - 1 };
    if (!(event.key in moves)) {
      return;
    }
    event.preventDefault();
    const next = (moves[event.key] + buttons.length) % buttons.length;
    buttons[next].focus();
    choose(next);
  });
  picker.addEventListener('input', () => {
    customChosen.add(key);
    app.config.colors[key] = picker.value.toUpperCase();
    lastCustom.set(key, app.config.colors[key]);
    hex.value = app.config.colors[key];
    app.changed();
    draw();
  });
  hex.addEventListener('input', () => {
    customChosen.add(key);
    app.config.colors[key] = hex.value;
    if (HEX.test(hex.value.trim())) {
      lastCustom.set(key, hex.value.trim().toUpperCase());
    }
    app.changed();
    draw();
  });
  draw();
  return el('div', { class: 'bl-color-row', 'data-path': `colors.${key}` },
    el('div', { class: 'bl-color-name', id: nameId }, STATUS_NAMES[key]),
    group,
    custom,
    el('div', { class: 'invalid-feedback' }),
  );
}

/**
 * Warn before meetings (SPEC 11.3 D, 6.7): Off, then durations. A saved value not in the list, possible only by hand, is
 * one more option, as for the intervals, and the plugin falls back to no warning with its warning line.
 */
function warningOptions(app: App): SelectOption[] {
  const values: number[] = [...MEETING_WARNINGS];
  for (const value of [app.saved.meetingWarningSeconds, app.config.meetingWarningSeconds]) {
    if (Number.isFinite(value) && !values.includes(value)) {
      values.push(value);
    }
  }
  return values.sort((a, b) => a - b).map((value) => ({ value: String(value), label: value === 0 ? COLORS.off : formatDuration(value) }));
}

export function renderColors(app: App, container: HTMLElement): void {
  app.ui.colorsShown = shownKey(app);
  // The second help line (SPEC 11.3 D, from build 3.2).
  container.appendChild(paragraph(COLORS.meetingsHelp, 'section-copy bl-colors-meetings'));
  const hidden = STATUS_KEYS.filter((key) => !canHappen(app, key));
  const shown = app.ui.colorsExpanded ? STATUS_KEYS : STATUS_KEYS.filter((key) => canHappen(app, key));
  const rows = shown.map((key) => colorRow(app, key));
  // The statuses the setup cannot produce wait behind one line; their saved colors are kept as they are.
  const more = hidden.length === 0 ? null : el('div', { class: 'bl-more-statuses form-text' },
    el('span', {}, hidden.length === 1 ? COLORS.moreStatus : COLORS.moreStatuses(hidden.length)), ' ',
    linkButton(app.ui.colorsExpanded ? COLORS.showFewer : COLORS.showAll, () => {
      app.ui.colorsExpanded = !app.ui.colorsExpanded;
      app.rerender('colors');
      document.querySelector<HTMLElement>('#section-colors .bl-more-statuses button')?.focus();
    }, 'bl-show-statuses'));
  container.appendChild(el('div', { class: 'card ns-card bl-colors-card' },
    el('div', { class: 'card-body' },
      el('div', { class: 'bl-color-rows' }, ...rows),
      more,
      paragraph(COLORS.precedence, 'form-text bl-precedence'),
      el('div', { class: 'bl-actions' }, linkButton(COLORS.reset, () => {
        app.config.colors = { ...DEFAULTS.colors };
        customChosen.clear();
        lastCustom.clear();
        app.changed();
        app.rerender('colors');
      }, 'bl-reset-colors')),
      el('div', { class: 'bl-meeting-warning' }, grid(gridCell(6, selectField(COLORS.warn, String(app.config.meetingWarningSeconds),
        warningOptions(app), (v) => {
          app.config.meetingWarningSeconds = Number(v);
          app.changed();
          // The Meeting Soon sensor can happen once the warning is on (SPEC 11.3 E).
          app.rerender('lights');
        }, { path: 'meetingWarningSeconds', help: COLORS.warnHelp })))),
    ),
  ));
}
