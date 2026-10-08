/**
 * The Generators section (SPEC section 11.3 D): one card per generator with its status badges, fault reasons,
 * the detail rows, and Rename in the footer editing in place; the empty line; and the "Also on your account"
 * lines for the devices the plugin skips.
 */

import type { App, UiGenerator } from '../app.js';
import { badge, card, type BadgeKind } from '../card.js';
import { GENERATOR, INTRO, SHELL } from '../copy.js';
import { button, el, footerAction, linkButton, paragraph, textField } from '../dom.js';
import { formatDate, formatTime, formatTimeOrDate, formatVolts, hhmmTo12h, parseDate, relativeTime } from '../format.js';
import { overrideFor, setOverride } from '../model.js';

const STATUS = { READY: 1, RUNNING: 2, EXERCISING: 3 };
const DEVICE = { PROPANE_MONITOR: 2, LINKED_ECOBEE: 7 };

export function displayName(app: App, g: UiGenerator): string {
  return overrideFor(app.config, g.id) ?? g.name;
}

/** The status badges of a card (SPEC section 11.3 D). */
export function statusBadges(g: UiGenerator): Array<[string, BadgeKind]> {
  if (!g.connected) {
    return [[GENERATOR.notResponding, 'muted']];
  }
  const out: Array<[string, BadgeKind]> = [];
  if (g.status === STATUS.RUNNING) {
    out.push([GENERATOR.running, 'running']);
  } else if (g.status === STATUS.EXERCISING) {
    out.push([GENERATOR.exercising, 'exercising']);
  } else if (g.status === STATUS.READY) {
    out.push([g.statusLabel || GENERATOR.ready, 'ready']);
  } else if (!g.fault && g.statusLabel) {
    out.push([g.statusLabel, 'muted']);
  }
  if (g.fault) {
    out.push([GENERATOR.fault, 'fault']);
  }
  return out;
}

function row(label: string, ...value: Array<Node | string | null>): Node[] {
  return [el('dt', {}, label), el('dd', {}, ...value)];
}

/** The inline Name field with Save name and Cancel (SPEC section 11.3 D); "Name is required." on blur. */
function renameEditor(app: App, g: UiGenerator, rename: { id: number; value: string }, titleNode: HTMLElement): HTMLElement {
  const path = `generators[${g.id}].name`;
  const field = textField(GENERATOR.name, rename.value, (v) => {
    rename.value = v;
    titleNode.textContent = v.trim() || g.name;
  }, { path, required: true });
  const feedback = field.querySelector<HTMLElement>('.invalid-feedback');
  const input = field.querySelector<HTMLInputElement>('input')!;
  const showRequired = (): boolean => {
    const missing = !rename.value.trim();
    field.classList.toggle('has-issue', missing);
    input.classList.toggle('is-invalid', missing);
    if (feedback) {
      feedback.textContent = missing ? SHELL.required(GENERATOR.name) : '';
    }
    return missing;
  };
  const save = button(GENERATOR.saveName, () => {
    if (showRequired()) {
      input.focus();
      return;
    }
    setOverride(app.config, g.id, rename.value, g.name);
    app.ui.rename = null;
    app.changed();
    app.rerender('generators');
  }, 'btn btn-primary btn-sm');
  const cancel = linkButton(GENERATOR.cancel, () => {
    app.ui.rename = null;
    app.rerender('generators');
  });
  input.addEventListener('blur', () => showRequired());
  input.addEventListener('input', () => {
    if (rename.value.trim()) {
      showRequired();
    }
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      save.click();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancel.click();
    }
  });
  window.setTimeout(() => {
    input.focus();
    input.select();
  }, 0);
  return el('span', { class: 'gn-rename-editor' }, field, el('span', { class: 'gn-rename-actions' }, save, cancel));
}

function generatorCard(app: App, g: UiGenerator): HTMLElement {
  const name = displayName(app, g);
  const title = el('span', { class: 'gn-title-block' },
    el('span', { class: 'ns-card-name' }, name),
    el('span', { class: 'gn-model' }, g.model),
    el('span', { class: 'gn-serial' }, GENERATOR.serial(g.serial)),
  );
  const badges = g.maintenanceDue ? [badge(GENERATOR.maintenanceDue, 'warn')] : [];

  const statusRow = el('div', { class: 'gn-status' }, ...statusBadges(g).map(([text, kind]) => badge(text, kind)));
  const lastSeen = parseDate(g.lastSeen);
  if (!g.connected) {
    statusRow.appendChild(el('span', { class: 'gn-note' }, GENERATOR.notRespondingNote(lastSeen ? formatTimeOrDate(lastSeen) : '?')));
  } else if (g.fault && g.faultReasons.length > 0) {
    statusRow.appendChild(el('ul', { class: 'gn-reasons' }, ...g.faultReasons.map((r) => el('li', {}, r))));
  }

  const rows: Node[] = [];
  if (g.batteryVoltage !== null) {
    const low = g.batteryVoltage <= app.config.batteryLowVoltage;
    rows.push(...row(GENERATOR.battery, GENERATOR.volts(formatVolts(g.batteryVoltage)), low ? badge(GENERATOR.low, 'warn') : null));
  }
  if (g.fuelType === 'propane' && typeof g.fuelPercent === 'number') {
    rows.push(...row(GENERATOR.fuel, GENERATOR.percent(String(Math.round(g.fuelPercent))), el('span', { class: 'gn-help' }, GENERATOR.fuelHelp)));
  }
  if (g.engineHours !== null) {
    rows.push(...row(GENERATOR.engineHours, GENERATOR.hours(String(g.engineHours))));
  }
  const exercise = hhmmTo12h(app.config.exerciseTime) ?? hhmmTo12h(g.exerciseTimeFromApi) ?? g.exerciseTime;
  if (exercise) {
    rows.push(...row(GENERATOR.exerciseTime, GENERATOR.weekly(exercise)));
  }
  const lastExercise = parseDate(g.lastExerciseAt);
  if (lastExercise) {
    rows.push(...row(GENERATOR.lastExercise, GENERATOR.dateAt(formatDate(lastExercise), formatTime(lastExercise))));
  }
  if (lastSeen) {
    rows.push(...row(GENERATOR.lastSeen, relativeTime(lastSeen)));
  }

  const footer = el('span', { class: 'gn-rename' });
  const rename = app.ui.rename;
  if (rename && rename.id === g.id) {
    footer.appendChild(renameEditor(app, g, rename, title.firstElementChild as HTMLElement));
  } else {
    footer.appendChild(footerAction(GENERATOR.rename, () => {
      app.ui.rename = { id: g.id, value: name };
      app.rerender('generators');
    }));
  }

  return card({
    title,
    badges,
    body: [statusRow, rows.length > 0 ? el('dl', { class: 'gn-kv' }, ...rows) : null],
    footerRight: footer,
    cls: 'gn-generator-card',
  });
}

export function renderGenerators(app: App, container: HTMLElement): void {
  const generators = app.status?.generators ?? [];
  if (generators.length === 0) {
    container.appendChild(paragraph(INTRO.generatorsEmpty, 'gn-empty'));
  }
  for (const g of generators) {
    container.appendChild(generatorCard(app, g));
  }
  for (const other of app.status?.others ?? []) {
    if (other.type === DEVICE.PROPANE_MONITOR) {
      container.appendChild(paragraph(GENERATOR.alsoPropane, 'gn-also'));
    } else if (other.type === DEVICE.LINKED_ECOBEE) {
      container.appendChild(paragraph(GENERATOR.alsoEcobee(other.name), 'gn-also'));
    }
  }
}
