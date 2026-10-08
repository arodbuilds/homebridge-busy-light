/**
 * Colors (SPEC 11.3 D): one card holding a row per status in the precedence order of SPEC 6.3: the display name, a
 * swatch that opens the browser's color picker, the hex value, and an Off checkbox that disables both. The statuses only
 * Teams presence can give carry a muted Teams only badge while no Microsoft 365 source, saved or not, uses Teams status.
 */

import type { App } from '../app.js';
import { badge } from '../card.js';
import { COLORS, STATUS_NAMES, type StatusKey } from '../copy.js';
import { el, linkButton, paragraph, uniqueId } from '../dom.js';
import { DEFAULTS, STATUS_KEYS } from '../model.js';

/** The statuses that come from Teams presence alone (SPEC 6.3 rules 3, 4, 6, 8 and 11). */
export const TEAMS_ONLY: readonly StatusKey[] = ['doNotDisturb', 'inCall', 'busy', 'away', 'offline'];

const HEX = /^#[0-9a-f]{6}$/i;

/** The last color each status had before Off was ticked, so unticking it puts that color back. */
const lastColor = new Map<StatusKey, string>();

/** True when any Microsoft 365 source on the page or in the saved configuration has Use Teams status on. */
export function usesTeams(app: App): boolean {
  return [...app.config.calendars, ...app.saved.calendars].some((s) => s.type === 'microsoft' && s.useTeamsStatus);
}

function colorRow(app: App, key: StatusKey, teams: boolean): HTMLElement {
  const value = app.config.colors[key];
  const off = value.trim().toLowerCase() === 'off';
  if (HEX.test(value)) {
    lastColor.set(key, value.toUpperCase());
  }
  const shown = HEX.test(value) ? value.toUpperCase() : off ? lastColor.get(key) ?? '' : value;
  const hexId = uniqueId('hex');
  const offId = uniqueId('off');
  const swatch = el('input', {
    type: 'color', class: 'form-control form-control-color bl-color-swatch', value: HEX.test(shown) ? shown.toLowerCase() : '#000000',
    'aria-label': STATUS_NAMES[key],
  });
  const hex = el('input', {
    id: hexId, type: 'text', class: 'form-control font-monospace ns-control bl-color-hex', value: shown, maxlength: '7', autocomplete: 'off',
    spellcheck: 'false',
  });
  const offBox = el('input', { id: offId, type: 'checkbox', class: 'form-check-input' });
  offBox.checked = off;
  swatch.disabled = off;
  hex.disabled = off;
  swatch.addEventListener('input', () => {
    hex.value = swatch.value.toUpperCase();
    app.config.colors[key] = hex.value;
    lastColor.set(key, hex.value);
    app.changed();
  });
  hex.addEventListener('input', () => {
    app.config.colors[key] = hex.value;
    if (HEX.test(hex.value.trim())) {
      swatch.value = hex.value.trim().toLowerCase();
      lastColor.set(key, hex.value.trim().toUpperCase());
    }
    app.changed();
  });
  offBox.addEventListener('change', () => {
    if (offBox.checked) {
      app.config.colors[key] = 'off';
    } else {
      app.config.colors[key] = lastColor.get(key) ?? swatch.value.toUpperCase();
      hex.value = app.config.colors[key];
    }
    swatch.disabled = offBox.checked;
    hex.disabled = offBox.checked;
    app.changed();
  });
  return el('div', { class: 'bl-color-row', 'data-path': `colors.${key}` },
    el('label', { class: 'bl-color-name', for: hexId }, STATUS_NAMES[key], teams ? null : badge(COLORS.teamsOnly, 'muted')),
    el('span', { class: 'bl-color-controls' },
      el('span', { class: 'bl-color-swatch-holder' }, swatch),
      hex,
      el('span', { class: 'form-check bl-color-off' }, offBox, el('label', { class: 'form-check-label', for: offId }, COLORS.off)),
    ),
    el('div', { class: 'invalid-feedback' }),
  );
}

export function renderColors(app: App, container: HTMLElement): void {
  const teams = usesTeams(app);
  const rows = STATUS_KEYS.map((key) => colorRow(app, key, teams || !TEAMS_ONLY.includes(key)));
  container.appendChild(el('div', { class: 'card ns-card bl-colors-card' },
    el('div', { class: 'card-body' },
      el('div', { class: 'bl-color-rows' }, ...rows),
      paragraph(COLORS.precedence, 'form-text bl-precedence'),
      el('div', { class: 'bl-actions' }, linkButton(COLORS.reset, () => {
        app.config.colors = { ...DEFAULTS.colors };
        lastColor.clear();
        app.changed();
        app.rerender('colors');
      }, 'bl-reset-colors')),
    ),
  ));
}
