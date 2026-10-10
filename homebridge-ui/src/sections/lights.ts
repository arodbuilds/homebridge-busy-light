/**
 * Lights (SPEC 11.3 E): the LIFX bulbs card, with the bulbs found by a search when "Use LIFX bulbs" is ticked and saved
 * as their serial numbers in `lifx.bulbs` (from build 3.2, several), Test light, and the IP addresses as the exception
 * under Advanced; then "Other lights in the Home app": the sensors to create and the three steps of a Home automation.
 */

import { callServer } from '../api.js';
import { lightsOf, type App, type LifxBulb } from '../app.js';
import { card, cardName } from '../card.js';
import { LIGHTS, SENSOR_NAMES, SHELL, STATUS_NAMES, type StatusKey } from '../copy.js';
import {
  checkboxField, disclosure, el, footerAction, grid, gridCell, linkButton, numberField, paragraph, statusBox, textField, uniqueId, type Child,
} from '../dom.js';
import { DEFAULTS, LIMITS, SENSOR_KEYS } from '../model.js';
import { isHost } from '../validate.js';
import { canHappen } from './colors.js';

/** The three roll-ups (SPEC section 7), shown first; the other seven sit under Show all statuses. */
const ROLL_UPS = SENSOR_KEYS.slice(0, 3);
const OTHERS = SENSOR_KEYS.slice(3);

/** A serial number written any way, as 12 lower-case hex digits, or null when the text is a name. */
export function serialOf(value: string): string | null {
  const hex = value.replace(/[^0-9a-f]/gi, '').toLowerCase();
  return hex.length === 12 && /^[0-9a-f:\s-]+$/i.test(value.trim()) ? hex : null;
}

/** Whether a bulb is the one an entry of `lifx.bulbs` names: by serial number, or by name without regard to case (SPEC 13.2). */
export function isChosen(wanted: string, bulb: LifxBulb): boolean {
  const serial = serialOf(wanted);
  return wanted.trim() !== '' && ((serial !== null && serial === bulb.serial) || bulb.label.toLowerCase() === wanted.trim().toLowerCase());
}

function bulbName(bulb: LifxBulb): string {
  return bulb.label || bulb.serial;
}

/** The addresses under Advanced, separated by commas. */
function hostsOf(app: App): string[] {
  return app.config.lifx.host.split(',').map((h) => h.trim()).filter((h) => h !== '');
}

async function search(app: App): Promise<void> {
  const lifx = app.ui.lifx;
  if (lifx.searching) {
    return;
  }
  lifx.searching = true;
  lifx.results = null;
  app.rerender('lights');
  const answer = await callServer<{ bulbs: LifxBulb[] }>('/lifx/discover');
  lifx.searching = false;
  const bulbs = answer && Array.isArray(answer.bulbs) ? answer.bulbs : [];
  lifx.bulbs = bulbs;
  for (const b of bulbs) {
    if (b.label) {
      lifx.names[b.serial] = b.label;
    }
  }
  const config = app.config.lifx;
  // A bulb saved by its name (by hand, or by build 1) is written as its serial number from now on.
  const bySerial = config.bulbs.map((w) => bulbs.find((b) => isChosen(w, b))?.serial ?? w);
  if (config.bulbs.length === 0 && bulbs.length === 1) {
    // One bulb and none named: Busy Light uses it, by its serial number.
    config.bulbs = [bulbs[0].serial];
    app.changed();
  } else if (bySerial.some((v, i) => v !== config.bulbs[i])) {
    config.bulbs = bySerial;
    app.changed();
  } else {
    app.revalidate();
  }
  app.rerender('lights');
}

/**
 * The label a saved bulb is shown by when no search in this visit found it: the name a search in this visit found, else
 * from build 3.3 the name of the state file's bulb with that serial number (SPEC 11.3 E, A7), else the saved entry as
 * written. A state file written before 1.0.0 has no serial numbers: there a single bulb's name stands for a single saved
 * serial, as in build 3.2.
 */
function savedLabel(app: App, wanted: string): string {
  const serial = serialOf(wanted);
  if (serial && app.ui.lifx.names[serial]) {
    return app.ui.lifx.names[serial];
  }
  if (serial && app.status) {
    const lights = lightsOf(app.status).filter((l) => l.label);
    const bySerial = lights.find((l) => l.serial === serial);
    if (bySerial) {
      return bySerial.label!;
    }
    if (lights.length === 1 && lights[0].serial === undefined && app.config.lifx.bulbs.length === 1) {
      return lights[0].label!;
    }
  }
  return wanted.trim();
}

/** The bulbs Test light tests: each address under Advanced, or each ticked bulb (by serial, at the address found). */
function testTargets(app: App): { body: Record<string, unknown>; labels: string[] } {
  const config = app.config.lifx;
  const hosts = hostsOf(app);
  if (hosts.length > 0 && hosts.every(isHost)) {
    return { body: { bulbs: hosts.map((host) => ({ host })) }, labels: hosts };
  }
  const found = app.ui.lifx.bulbs ?? [];
  const bulbs = config.bulbs.map((w) => {
    const bulb = found.find((b) => isChosen(w, b));
    const serial = serialOf(w) ?? bulb?.serial ?? null;
    // A bulb not found is named as the missing line names it (SPEC 11.3 E, from build 3.3), not by its serial number.
    return { target: { ...(serial ? { serial } : {}), ...(bulb ? { host: bulb.ip } : {}) }, label: bulb ? bulbName(bulb) : savedLabel(app, w) };
  });
  return { body: { bulbs: bulbs.map((b) => b.target) }, labels: bulbs.map((b) => b.label) };
}

async function testLight(app: App): Promise<void> {
  const lifx = app.ui.lifx;
  if (lifx.testing) {
    return;
  }
  const { body, labels } = testTargets(app);
  lifx.testing = true;
  lifx.results = null;
  app.rerender('lights');
  const answer = await callServer<{ answered: boolean; results?: { label: string | null; host: string | null; answered: boolean }[] }>(
    '/lifx/test', { ...body, brightness: app.config.lifx.brightness });
  lifx.testing = false;
  const results = Array.isArray(answer?.results) ? answer.results : [];
  lifx.results = results.length > 0
    ? results.map((r, i) => ({ label: r.label || labels[i] || r.host || '', answered: r.answered === true }))
    : [{ label: '', answered: answer?.answered === true }];
  app.rerender('lights');
}

/** Test light's results (SPEC 11.3 E): the one-bulb strings for one bulb, one line per bulb for several. */
function testResults(app: App): HTMLElement | null {
  const results = app.ui.lifx.results;
  if (!results) {
    return null;
  }
  if (results.length === 1) {
    return results[0].answered ? statusBox('success', LIGHTS.answered) : statusBox('danger', LIGHTS.noAnswer);
  }
  return el('div', { class: 'bl-lifx-results-list' }, ...results.map((r) => (r.answered
    ? statusBox('success', LIGHTS.bulbAnswered(r.label)) : statusBox('danger', LIGHTS.bulbNoAnswer(r.label)))));
}

/**
 * Before any search in this visit (SPEC 11.3 E): the bulbs the running plugin uses, one line each from the state
 * file's `lights` (or an older `light`), so the page does not read as if no bulb were set up. Nothing until the first
 * /status answer.
 */
function inUse(app: App): HTMLElement[] {
  if (app.status === undefined) {
    return [];
  }
  const lights = app.status ? lightsOf(app.status).filter((l) => l.enabled && l.host) : [];
  if (lights.length === 0) {
    return [paragraph(LIGHTS.noBulbYet, 'bl-lifx-line bl-lifx-in-use')];
  }
  return lights.map((light) => {
    const host = light.host!;
    const label = light.label || host;
    return paragraph(light.answered === false ? LIGHTS.usingBulbSilent(label, host) : LIGHTS.usingBulb(label, host), 'bl-lifx-line bl-lifx-in-use');
  });
}

/** One checkbox per bulb found, ticked for each bulb in `lifx.bulbs`. */
function bulbChoices(app: App, bulbs: LifxBulb[], legend: string | null): HTMLElement {
  const config = app.config.lifx;
  return el('fieldset', { class: 'bl-lifx-choice', 'data-path': 'lifx.bulbs' },
    legend ? el('legend', { class: 'bl-lifx-line' }, legend) : null,
    ...bulbs.map((bulb) => {
      const id = uniqueId('bulb');
      const box = el('input', { id, class: 'form-check-input', type: 'checkbox', value: bulb.serial });
      box.checked = config.bulbs.some((w) => isChosen(w, bulb));
      box.addEventListener('change', () => {
        const others = config.bulbs.filter((w) => !isChosen(w, bulb));
        // Saved in the order found, then any saved bulb not found now.
        const ticked = bulbs.filter((b) => (b === bulb ? box.checked : others.some((w) => isChosen(w, b)))).map((b) => b.serial);
        config.bulbs = [...ticked, ...others.filter((w) => !bulbs.some((b) => isChosen(w, b)))];
        app.touch('lifx.bulbs');
        app.changed();
        app.rerender('lights');
      });
      return el('div', { class: 'form-check' }, box, el('label', { class: 'form-check-label', for: id }, LIGHTS.bulbChoice(bulbName(bulb), bulb.ip)));
    }),
    // None ticked while several were found (SPEC 11.3 H).
    el('div', { class: 'invalid-feedback' }),
  );
}

/** The search results (SPEC 11.3 E): searching, one, several or none, and each saved bulb missing; hidden behind an address. */
function results(app: App): Child[] {
  const config = app.config.lifx;
  const lifx = app.ui.lifx;
  const hosts = hostsOf(app);
  if (hosts.length > 0) {
    return hosts.map((host) => paragraph(LIGHTS.usingIp(host), 'bl-lifx-line bl-lifx-ip'));
  }
  const out: Child[] = [];
  if (lifx.searching) {
    out.push(paragraph(LIGHTS.searching, 'bl-lifx-line bl-lifx-searching'));
  } else if (lifx.bulbs !== null) {
    const bulbs = lifx.bulbs;
    const missing = config.bulbs.filter((w) => !bulbs.some((b) => isChosen(w, b)));
    for (const w of missing) {
      out.push(paragraph(LIGHTS.savedMissing(savedLabel(app, w)), 'bl-lifx-line bl-lifx-missing'));
    }
    if (bulbs.length === 0) {
      if (config.bulbs.length === 0) {
        out.push(paragraph(LIGHTS.none, 'bl-lifx-line bl-lifx-none'));
      }
    } else if (bulbs.length === 1 && config.bulbs.some((w) => isChosen(w, bulbs[0]))) {
      out.push(paragraph(LIGHTS.foundOne(bulbName(bulbs[0]), bulbs[0].ip), 'bl-lifx-line bl-lifx-one'));
    } else if (bulbs.length === 1) {
      // One found that is not among the saved bulbs: it can be ticked beside them, with no heading line (SPEC 17).
      out.push(bulbChoices(app, bulbs, null));
    } else {
      out.push(bulbChoices(app, bulbs, LIGHTS.foundSeveral(bulbs.length)));
    }
  } else {
    out.push(...inUse(app));
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
          config.host = v;
          app.changed();
          // The search results give way to one line per address, and back (SPEC 11.3 E).
          refreshResults(app);
        }, { path: 'lifx.host', placeholder: LIGHTS.ipPlaceholder, help: `${LIGHTS.ipLead} ${LIGHTS.ipHelp}` })),
        gridCell(6, numberField(LIGHTS.refresh, config.refreshSeconds, (v) => {
          config.refreshSeconds = v;
          app.changed();
        }, { path: 'lifx.refreshSeconds', min: LIMITS.refreshSeconds[0], max: LIMITS.refreshSeconds[1], help: LIGHTS.refreshHelp })),
      )], { cls: 'bl-lifx-advanced', open: config.host.trim() !== '' || config.refreshSeconds !== DEFAULTS.lifx.refreshSeconds }),
    ],
    results: testResults(app),
    footerLeft: [el('span', { class: 'form-text bl-test-help' }, LIGHTS.testHelp)],
    footerRight: test,
    cls: 'bl-lifx-card',
  });
}

/**
 * Whether a per-status sensor's status can happen with the configuration on the page (SPEC 11.3 D); the roll-ups
 * always can, and Meeting Soon once the meeting warning is on (11.3 E, from build 3.2).
 */
function sensorCanHappen(app: App, key: (typeof SENSOR_KEYS)[number]): boolean {
  if (key === 'meetingSoon') {
    return app.config.meetingWarningSeconds > 0;
  }
  return key in STATUS_NAMES ? canHappen(app, key as StatusKey) : true;
}

/**
 * A sensor's help: each roll-up says when it is on (from build 3.3, so Busy is told apart from Busy in Teams), Meeting
 * Soon always says what it detects, and one that cannot happen says so.
 */
function sensorHelp(app: App, key: (typeof SENSOR_KEYS)[number]): string | undefined {
  const own = key === 'meetingSoon' ? LIGHTS.meetingSoonHelp : key in LIGHTS.sensorHelp ? LIGHTS.sensorHelp[key as keyof typeof LIGHTS.sensorHelp] : null;
  const lines = [own, sensorCanHappen(app, key) ? null : LIGHTS.nothingReports].filter((l): l is string => l !== null);
  return lines.length ? lines.join(' ') : undefined;
}

function sensorBox(app: App, key: (typeof SENSOR_KEYS)[number]): HTMLElement {
  const name = app.config.name.trim() || DEFAULTS.name;
  return checkboxField(LIGHTS.sensor(name, SENSOR_NAMES[key]), app.config.sensors.includes(key), (v) => {
    app.config.sensors = SENSOR_KEYS.filter((k) => (k === key ? v : app.config.sensors.includes(k)));
    app.changed();
  }, { path: `sensors.${key}`, help: sensorHelp(app, key) });
}

export function renderLights(app: App, container: HTMLElement): void {
  const name = app.config.name.trim() || DEFAULTS.name;
  container.appendChild(lifxCard(app));
  container.appendChild(el('div', { class: 'bl-other-lights' },
    el('h3', { class: 'bl-subheading bl-other-heading' }, LIGHTS.otherHeading),
    paragraph(LIGHTS.otherText, 'section-copy'),
    el('div', { class: 'bl-subheading bl-sensors-heading' }, LIGHTS.sensors),
    el('div', { class: 'bl-sensors' }, ...ROLL_UPS.map((k) => sensorBox(app, k))),
    // The statuses the setup cannot produce come after the others, and can still be ticked (SPEC 11.3 E).
    disclosure(LIGHTS.showAll, [el('div', { class: 'bl-sensors' },
      ...[...OTHERS.filter((k) => sensorCanHappen(app, k)), ...OTHERS.filter((k) => !sensorCanHappen(app, k))].map((k) => sensorBox(app, k)))], {
      cls: 'bl-all-sensors', open: OTHERS.some((k) => app.config.sensors.includes(k)),
    }),
    el('ol', { class: 'ns-steps' }, ...LIGHTS.steps.map((step, i) => el('li', { class: 'ns-step' },
      el('span', { class: 'ns-step-number', 'aria-hidden': 'true' }, String(i + 1)),
      el('span', { class: 'ns-step-text' }, step(name)),
    ))),
    // The Working switch (SPEC 6.6, 11.3 E), below the steps, which belong to the sensors.
    el('div', { class: 'bl-working-switch' }, checkboxField(LIGHTS.workingSwitch, app.config.workingSwitch.enabled, (v) => {
      app.config.workingSwitch.enabled = v;
      app.changed();
    }, { path: 'workingSwitch.enabled', help: LIGHTS.workingSwitchHelp }),
    // The three switches side by side, and where each one is (SPEC 11.3 E, from build 3.3).
    paragraph(LIGHTS.switches, 'form-text bl-switches')),
  ));
}
