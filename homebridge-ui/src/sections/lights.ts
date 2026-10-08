/**
 * Lights (SPEC 11.3 E): the LIFX bulb card, with the bulb found by a search when "Use a LIFX bulb" is ticked and saved
 * as its serial number in `lifx.bulb`, Test light, and the IP address as the exception under Advanced; then "Other
 * lights in the Home app": the sensors to create and the three steps of a Home automation.
 */

import { callServer } from '../api.js';
import type { App, LifxBulb } from '../app.js';
import { card, cardName } from '../card.js';
import { LIGHTS, SENSOR_NAMES, SHELL } from '../copy.js';
import {
  checkboxField, disclosure, el, footerAction, grid, gridCell, linkButton, numberField, paragraph, statusBox, textField, uniqueId, type Child,
} from '../dom.js';
import { DEFAULTS, LIMITS, SENSOR_KEYS } from '../model.js';
import { isHost } from '../validate.js';

/** The three roll-ups (SPEC section 7), shown first; the other seven sit under Show all statuses. */
const ROLL_UPS = SENSOR_KEYS.slice(0, 3);
const OTHERS = SENSOR_KEYS.slice(3);

/** A serial number written any way, as 12 lower-case hex digits, or null when the text is a name. */
export function serialOf(value: string): string | null {
  const hex = value.replace(/[^0-9a-f]/gi, '').toLowerCase();
  return hex.length === 12 && /^[0-9a-f:\s-]+$/i.test(value.trim()) ? hex : null;
}

/** Whether a bulb is the one `lifx.bulb` names: by serial number, or by name without regard to case (SPEC 13.2). */
export function isChosen(wanted: string, bulb: LifxBulb): boolean {
  const serial = serialOf(wanted);
  return wanted.trim() !== '' && ((serial !== null && serial === bulb.serial) || bulb.label.toLowerCase() === wanted.trim().toLowerCase());
}

function bulbName(bulb: LifxBulb): string {
  return bulb.label || bulb.serial;
}

async function search(app: App): Promise<void> {
  const lifx = app.ui.lifx;
  if (lifx.searching) {
    return;
  }
  lifx.searching = true;
  lifx.answered = null;
  app.rerender('lights');
  const answer = await callServer<{ bulbs: LifxBulb[] }>('/lifx/discover');
  lifx.searching = false;
  lifx.bulbs = answer && Array.isArray(answer.bulbs) ? answer.bulbs : [];
  // One bulb, and no other bulb asked for by name or serial among those found: Busy Light uses it, by its serial number.
  const chosen = lifx.bulbs.find((b) => isChosen(app.config.lifx.bulb, b));
  if (lifx.bulbs.length === 1 && !chosen) {
    app.config.lifx.bulb = lifx.bulbs[0].serial;
    app.changed();
  } else if (chosen && app.config.lifx.bulb !== chosen.serial) {
    // A bulb saved by its name (build 1) is written as its serial number from now on.
    app.config.lifx.bulb = chosen.serial;
    app.changed();
  }
  app.rerender('lights');
}

async function testLight(app: App): Promise<void> {
  const lifx = app.ui.lifx;
  if (lifx.testing) {
    return;
  }
  const config = app.config.lifx;
  const payload: Record<string, unknown> = { brightness: config.brightness };
  const host = config.host.trim();
  const found = lifx.bulbs?.find((b) => isChosen(config.bulb, b));
  const serial = serialOf(config.bulb) ?? found?.serial ?? null;
  if (host && isHost(host)) {
    payload.host = host;
  } else {
    if (serial) {
      payload.serial = serial;
    }
    if (found) {
      payload.host = found.ip;
    }
  }
  lifx.testing = true;
  lifx.answered = null;
  app.rerender('lights');
  const answer = await callServer<{ answered: boolean }>('/lifx/test', payload);
  lifx.testing = false;
  lifx.answered = answer?.answered === true;
  app.rerender('lights');
}

/**
 * Before any search in this visit (SPEC 11.3 E): the bulb the running plugin uses, from the state file's `light`, so
 * the page does not read as if no bulb were set up. Nothing until the first /status answer.
 */
function inUse(app: App): HTMLElement | null {
  if (app.status === undefined) {
    return null;
  }
  const light = app.status?.light;
  if (!light || !light.enabled || !light.host) {
    return paragraph(LIGHTS.noBulbYet, 'bl-lifx-line bl-lifx-in-use');
  }
  const label = light.label || light.host;
  return paragraph(light.answered === false ? LIGHTS.usingBulbSilent(label, light.host) : LIGHTS.usingBulb(label, light.host),
    'bl-lifx-line bl-lifx-in-use');
}

/** The search results (SPEC 11.3 E): searching, one, several or none, and the saved bulb missing; hidden behind an IP address. */
function results(app: App): Child[] {
  const config = app.config.lifx;
  const lifx = app.ui.lifx;
  if (config.host.trim()) {
    return [paragraph(LIGHTS.usingIp(config.host.trim()), 'bl-lifx-line bl-lifx-ip')];
  }
  const out: Child[] = [];
  if (lifx.searching) {
    out.push(paragraph(LIGHTS.searching, 'bl-lifx-line bl-lifx-searching'));
  } else if (lifx.bulbs !== null) {
    const bulbs = lifx.bulbs;
    const chosen = bulbs.find((b) => isChosen(config.bulb, b));
    if (config.bulb.trim() && !chosen) {
      const label = app.status?.light?.label && serialOf(config.bulb) ? app.status.light.label : config.bulb.trim();
      out.push(paragraph(LIGHTS.savedMissing(label), 'bl-lifx-line bl-lifx-missing'));
    }
    if (bulbs.length === 0) {
      if (!config.bulb.trim()) {
        out.push(paragraph(LIGHTS.none, 'bl-lifx-line bl-lifx-none'));
      }
    } else if (bulbs.length === 1) {
      if (chosen) {
        out.push(paragraph(LIGHTS.foundOne(bulbName(chosen), chosen.ip), 'bl-lifx-line bl-lifx-one'));
      }
    } else {
      const name = uniqueId('bulb');
      out.push(el('fieldset', { class: 'bl-lifx-choice', 'data-path': 'lifx.bulb' },
        el('legend', { class: 'bl-lifx-line' }, LIGHTS.foundSeveral(bulbs.length)),
        ...bulbs.map((bulb) => {
          const id = uniqueId('radio');
          const radio = el('input', { id, class: 'form-check-input', type: 'radio', name, value: bulb.serial });
          radio.checked = chosen === bulb;
          radio.addEventListener('change', () => {
            if (radio.checked) {
              app.config.lifx.bulb = bulb.serial;
              app.changed();
              app.rerender('lights');
            }
          });
          return el('div', { class: 'form-check' }, radio, el('label', { class: 'form-check-label', for: id }, LIGHTS.bulbChoice(bulbName(bulb), bulb.ip)));
        }),
      ));
    }
  } else {
    const line = inUse(app);
    if (line) {
      out.push(line);
    }
  }
  if (!lifx.searching) {
    out.push(el('div', { class: 'bl-actions bl-lifx-actions' }, linkButton(LIGHTS.searchAgain, () => void search(app), 'bl-search-again')));
  }
  return out;
}

/** The results as nodes, for the in-place swap when the IP address is filled in or cleared. */
function resultsNow(app: App): Node[] {
  return results(app).filter((c): c is Node => typeof c === 'object' && c !== null);
}

/** Redraws the results in place (an answer from /status, or the IP address filled in or cleared). */
function refreshResults(app: App): void {
  const holder = document.querySelector<HTMLElement>('#section-lights .bl-lifx-results');
  if (!holder) {
    return;
  }
  while (holder.firstChild) {
    holder.removeChild(holder.firstChild);
  }
  for (const child of resultsNow(app)) {
    holder.appendChild(child);
  }
}

/** After each /status answer, the bulb in use, until a search in this visit replaces it. */
export function lightsOnStatus(app: App): void {
  if (app.config.lifx.enabled && app.ui.lifx.bulbs === null && !app.ui.lifx.searching) {
    refreshResults(app);
  }
}

function lifxCard(app: App): HTMLElement {
  const config = app.config.lifx;
  const lifx = app.ui.lifx;
  const enabled = checkboxField(LIGHTS.useLifx, config.enabled, (v) => {
    config.enabled = v;
    app.changed();
    app.rerender('lights');
    app.focusLater('lifx.enabled');
    if (v) {
      void search(app);
    }
  }, { path: 'lifx.enabled' });
  if (!config.enabled) {
    return card({ title: cardName(LIGHTS.lifxTitle), body: [enabled], cls: 'bl-lifx-card' });
  }
  const test = footerAction(lifx.testing ? LIGHTS.testing : LIGHTS.testLight, () => void testLight(app));
  test.disabled = lifx.testing;
  return card({
    title: cardName(LIGHTS.lifxTitle),
    body: [
      enabled,
      el('div', { class: 'bl-lifx-results', role: 'status' }, ...results(app)),
      grid(gridCell(6, numberField(LIGHTS.brightness, config.brightness, (v) => {
        config.brightness = v;
        app.changed();
      }, { path: 'lifx.brightness', min: LIMITS.brightness[0], max: LIMITS.brightness[1] }))),
      disclosure(SHELL.advanced, [grid(
        gridCell(6, textField(LIGHTS.ip, config.host, (v) => {
          const before = config.host.trim() !== '';
          config.host = v;
          app.changed();
          if (before !== (v.trim() !== '')) {
            // The search results give way to the address line, and back.
            refreshResults(app);
          }
        }, { path: 'lifx.host', placeholder: LIGHTS.ipPlaceholder, help: `${LIGHTS.ipLead} ${LIGHTS.ipHelp}`, inputmode: 'decimal' })),
        gridCell(6, numberField(LIGHTS.refresh, config.refreshSeconds, (v) => {
          config.refreshSeconds = v;
          app.changed();
        }, { path: 'lifx.refreshSeconds', min: LIMITS.refreshSeconds[0], max: LIMITS.refreshSeconds[1], help: LIGHTS.refreshHelp })),
      )], { cls: 'bl-lifx-advanced', open: config.host.trim() !== '' || config.refreshSeconds !== DEFAULTS.lifx.refreshSeconds }),
    ],
    results: lifx.answered === null ? null : lifx.answered ? statusBox('success', LIGHTS.answered) : statusBox('danger', LIGHTS.noAnswer),
    footerLeft: [el('span', { class: 'form-text bl-test-help' }, LIGHTS.testHelp)],
    footerRight: test,
    cls: 'bl-lifx-card',
  });
}

function sensorBox(app: App, key: (typeof SENSOR_KEYS)[number]): HTMLElement {
  const name = app.config.name.trim() || DEFAULTS.name;
  return checkboxField(LIGHTS.sensor(name, SENSOR_NAMES[key]), app.config.sensors.includes(key), (v) => {
    app.config.sensors = SENSOR_KEYS.filter((k) => (k === key ? v : app.config.sensors.includes(k)));
    app.changed();
  }, { path: `sensors.${key}` });
}

export function renderLights(app: App, container: HTMLElement): void {
  const name = app.config.name.trim() || DEFAULTS.name;
  container.appendChild(lifxCard(app));
  container.appendChild(el('div', { class: 'bl-other-lights' },
    el('h3', { class: 'bl-subheading bl-other-heading' }, LIGHTS.otherHeading),
    paragraph(LIGHTS.otherText, 'section-copy'),
    el('div', { class: 'bl-subheading bl-sensors-heading' }, LIGHTS.sensors),
    el('div', { class: 'bl-sensors' }, ...ROLL_UPS.map((k) => sensorBox(app, k))),
    disclosure(LIGHTS.showAll, [el('div', { class: 'bl-sensors' }, ...OTHERS.map((k) => sensorBox(app, k)))], {
      cls: 'bl-all-sensors', open: OTHERS.some((k) => app.config.sensors.includes(k)),
    }),
    el('ol', { class: 'ns-steps' }, ...LIGHTS.steps.map((step, i) => el('li', { class: 'ns-step' },
      el('span', { class: 'ns-step-number', 'aria-hidden': 'true' }, String(i + 1)),
      el('span', { class: 'ns-step-text' }, step(name)),
    ))),
  ));
}
