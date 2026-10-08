/**
 * The settings page rendered under node:test on the fake DOM (test/fake-dom.ts), as in homebridge-generac: what the
 * page draws from the platform block and from /status, and every path of SPEC 15 item 14.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { FakeEvent, flush, installFakeDom, text, type, type FakeElement } from './fake-dom.js';

process.env.TZ = 'UTC';
const dom = installFakeDom();

/** The host: the UI server answers from a script the test sets; every request is recorded. */
const requests: Array<{ path: string; payload: unknown }> = [];
const answers = new Map<string, unknown | ((payload: unknown) => unknown)>();
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
    // A copy, as postMessage would hand the page. A function may answer later, with a promise.
    return structuredClone(typeof answer === 'function' ? await (answer as (p: unknown) => unknown)(payload) : answer);
  },
  getPluginConfig: async () => [],
  updatePluginConfig: async (blocks: unknown[]) => {
    pushed.push(structuredClone(blocks));
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
const { readConfig, exportConfig, DEFAULTS } = await import('../homebridge-ui/src/model.js');
const copy = await import('../homebridge-ui/src/copy.js');
const { INTRO, SHELL, VALIDATION } = copy;

type PageT = InstanceType<typeof Page>;

function mount(raw: Record<string, unknown> = { platform: 'BusyLight' }): { root: FakeElement; page: PageT } {
  const root = dom.document.createElement('div');
  root.setAttribute('id', 'app');
  dom.document.body.appendChild(root);
  const saved = readConfig(raw);
  const page = new Page(readConfig(JSON.parse(JSON.stringify(exportConfig(saved)))), saved, root as unknown as HTMLElement);
  page.setOtherBlocks([]);
  page.renderAll();
  page.offerDraft();
  return { root, page };
}

function lastBlock(): Record<string, unknown> {
  return pushed[pushed.length - 1][0] as Record<string, unknown>;
}

afterEach(() => {
  dom.clock.clearAll();
  for (const node of dom.document.body.children) {
    node.remove();
  }
  dom.storage.clear();
  requests.length = 0;
  answers.clear();
  pushed.length = 0;
  toasts.length = 0;
});

describe('settings page: anatomy (SPEC 11.1)', () => {
  it('draws the banner, the intro, the affiliation line, the six sections, the closing line and the footer, in order', () => {
    const { root } = mount();
    const kids = root.children.map((c) => `${c.tagName.toLowerCase()}${c.id ? `#${c.id}` : ''}.${c.className.split(' ').join('.')}`);
    assert.deepEqual(kids, [
      'img.ns-banner', 'div.ns-draft-holder', 'p.lead-copy', 'p.lead-copy', 'p.form-text.bl-affiliation',
      'section#section-rightNow.ns-section', 'section#section-calendars.ns-section', 'section#section-statusInput.ns-section',
      'section#section-colors.ns-section',
      'section#section-lights.ns-section', 'section#section-settings.ns-section', 'div.alert.alert-warning.ns-issues', 'p.lead-copy.mt-3',
      'footer.ns-footer.form-text',
    ]);
    assert.equal(root.children[0].getAttribute('alt'), copy.BANNER.alt);
    assert.equal(root.children[0].getAttribute('src'), 'busy-light-banner.png');
    assert.equal(text(root.children[4]), INTRO.affiliation);
    assert.equal(text(root.children[12]), INTRO.closing);
    assert.deepEqual(root.querySelectorAll('h2').map((h) => text(h)), ['Right now', 'Calendars', 'Status from other apps', 'Colors', 'Lights', 'Settings']);
    const footer = root.querySelector('footer')!;
    assert.equal(text(footer), 'Busy Light · Made by Alex Rodriguez · alex-rodriguez.com · Report an issue');
    assert.deepEqual(footer.querySelectorAll('a').map((a) => [a.getAttribute('href'), a.getAttribute('target'), a.getAttribute('rel')]), [
      ['https://alex-rodriguez.com/?ref=busy-light#building', '_blank', 'noopener noreferrer'],
      ['https://github.com/arodbuilds/homebridge-busy-light/issues', '_blank', 'noopener noreferrer'],
    ]);
    assert.ok(footer.querySelector('svg'), 'the mark is drawn inline');
  });

  it('opening the page calls only /version and /status, and the footer shows the version', async () => {
    answers.set('/version', { version: '0.1.0-beta.2' });
    answers.set('/status', { status: null });
    const { root, page } = mount();
    page.startPolling();
    await flush();
    assert.deepEqual(requests.map((r) => r.path), ['/version', '/status']);
    assert.ok(text(root.querySelector('footer')).startsWith('Busy Light v0.1.0-beta.2 ·'));
    await dom.clock.advance(15_000);
    assert.deepEqual(requests.map((r) => r.path), ['/version', '/status', '/status'], '/status again every 15 seconds');
  });
});

const T = Date.parse('2026-10-08T15:00:00Z');
const ICLOUD_SOURCE = { type: 'icloud', id: 'icloud', name: 'iCloud', appleId: 'person@example.com', appPassword: 'abcd-efgh-ijkl-mnop', calendars: ['Alex'] };

/** A state file as the plugin writes it (SPEC 10.1). */
function state(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1, updatedAt: new Date(T - 20_000).toISOString(), status: 'inMeeting', reason: { source: 'Work', until: '2026-10-08T15:30:00.000Z' },
    override: false, signIn: null,
    sources: [{ id: 'icloud', name: 'iCloud', type: 'icloud', state: 'connected', lastChecked: new Date(T - 60_000).toISOString(), events: 4, error: null }],
    light: { enabled: true, label: 'Floor', host: '192.168.4.50', found: 'discovered', lastSent: '#FF0000', lastSentAt: null, answered: true },
    ...extra,
  };
}

async function rightNow(status: unknown, raw: Record<string, unknown> = { platform: 'BusyLight', calendars: [ICLOUD_SOURCE] }): Promise<FakeElement> {
  answers.set('/version', { version: '0.1.0-beta.2' });
  answers.set('/status', status);
  const { root, page } = mount(raw);
  page.startPolling();
  await flush();
  return root.querySelector('#section-rightNow .section-body')!;
}

describe('settings page: Right now (SPEC 11.3 B)', () => {
  it('shows the swatch in the saved color, the status name and where it comes from', async () => {
    const row = await rightNow(state(), { platform: 'BusyLight', calendars: [ICLOUD_SOURCE], colors: { inMeeting: '#aa0000' } });
    assert.equal(text(row.querySelector('.bl-now-name')), 'In a meeting');
    assert.equal(text(row.querySelector('.bl-now-line')), 'Until 3:30 PM, from Work.');
    assert.equal(row.querySelector('.bl-swatch')!.getAttribute('style'), 'background-color: #AA0000');
    assert.equal(row.querySelector('.bl-now-stale'), null);
  });

  it('every reason line', async () => {
    const line = async (extra: Record<string, unknown>) => text((await rightNow(state(extra))).querySelector('.bl-now-line'));
    assert.equal(await line({ reason: { source: 'Work', until: null } }), 'From Work.');
    assert.equal(await line({ status: 'inCall', reason: { source: 'Teams', until: null } }), 'From Teams.');
    assert.equal(await line({ status: 'inCall', reason: { source: 'Teams', until: '2026-10-08T16:00:00.000Z' } }), 'Until 4:00 PM, from Teams.');
    assert.equal(await line({ status: 'available', reason: { source: null, until: '2026-10-08T17:00:00.000Z' } }), 'Nothing on your calendars until 5:00 PM.');
    assert.equal(await line({ status: 'available', reason: { source: null, until: null } }), 'Nothing on your calendars right now.');
    assert.equal(await line({ status: 'doNotDisturb', override: true, reason: null }), 'The override switch is on.');
  });

  it('no calendars saved, no state file yet, and Unknown in the warning tone (no swatch)', async () => {
    let row = await rightNow(state(), { platform: 'BusyLight' });
    assert.equal(text(row), copy.RIGHT_NOW.noCalendars);
    assert.equal(row.querySelector('.bl-swatch'), null);
    row = await rightNow({ status: null });
    assert.equal(text(row), copy.RIGHT_NOW.notStarted);
    row = await rightNow(state({ status: 'unknown', reason: null }));
    assert.equal(text(row.querySelector('.alert-warning')), copy.RIGHT_NOW.unknown);
    assert.equal(row.querySelector('.bl-swatch'), null);
  });

  it('adds the stale line when the state file is older than 5 minutes, and follows /status every 15 seconds', async () => {
    const row = await rightNow(state({ updatedAt: new Date(T - 7 * 60_000).toISOString() }));
    assert.equal(text(row.querySelector('.bl-now-stale')), 'Last updated 7 minutes ago. Is Homebridge running?');
    answers.set('/status', state({ status: 'available', reason: { source: null, until: null }, updatedAt: new Date(T + 10_000).toISOString() }));
    await dom.clock.advance(15_000);
    const now = dom.document.querySelector('#section-rightNow .section-body')!;
    assert.equal(text(now.querySelector('.bl-now-name')), 'Available');
    assert.equal(now.querySelector('.bl-now-stale'), null);
  });
});

function buttons(node: FakeElement | null): string[] {
  return (node?.querySelectorAll('button') ?? []).map((b) => text(b));
}

function buttonNamed(node: FakeElement, label: string): FakeElement {
  const found = node.querySelectorAll('button').find((b) => text(b) === label);
  assert.ok(found, `no button ${label} in ${buttons(node).join(', ')}`);
  return found;
}

function field(root: FakeElement, path: string): FakeElement {
  const input = root.querySelector(`[data-path="${path}"] input`) ?? root.querySelector(`[data-path="${path}"] select`);
  assert.ok(input, `no field ${path}`);
  return input;
}

function feedback(root: FakeElement, path: string): string {
  return text(root.querySelector(`[data-path="${path}"] > .invalid-feedback`));
}

function cardOf(root: FakeElement, id: string): FakeElement {
  const node = root.querySelector(`[data-card-id="${id}"]`);
  assert.ok(node, `no card ${id}`);
  return node;
}

function openCard(root: FakeElement, id: string): FakeElement {
  const toggle = cardOf(root, id).querySelector('.ns-card-toggle')!;
  if (toggle.getAttribute('aria-expanded') === 'false') {
    toggle.click();
  }
  return cardOf(root, id);
}

/** Leaves a field the way a person does: focus, type, then move on. */
function fill(root: FakeElement, path: string, value: string): void {
  const input = field(root, path);
  input.focus();
  type(input, value);
  input.blur();
}

function tick(box: FakeElement, checked: boolean): void {
  box.checked = checked;
  box.dispatchEvent(new FakeEvent('change', true));
}

function choose(select: FakeElement, value: string): void {
  select.value = value;
  select.dispatchEvent(new FakeEvent('change', true));
}

function rowNamed(node: FakeElement, name: string): FakeElement {
  const row = node.querySelectorAll('.bl-cal-row').find((r) => text(r.querySelector('label')) === name);
  assert.ok(row, `no row ${name}`);
  return row;
}

function calendarsOf(id: string): unknown {
  return ((lastBlock().calendars as Array<Record<string, unknown>>).find((c) => c.id === id) ?? {}).calendars;
}

/** Lets the page's requests answer, then its 150 ms push to the host run. */
async function settle(): Promise<void> {
  await flush();
  await dom.clock.advance(200);
}

const LISTED = {
  calendars: [
    { id: '/123456789/calendars/home/', name: 'Alex', shared: false, subscribed: false, eventsToday: 3 },
    { id: '/123456789/calendars/family-1/', name: 'Family', shared: true, subscribed: false, eventsToday: 1 },
    { id: '/123456789/calendars/work/', name: 'Work', shared: false, subscribed: false, eventsToday: 0 },
    { id: '/123456789/calendars/holidays/', name: 'Holidays', shared: false, subscribed: true, eventsToday: null },
  ],
};

describe('settings page: the chooser and a new card (SPEC 11.1 item 4, 11.3 C)', () => {
  it('opens four tiles in Add calendar\'s place; a tile adds an open card whose Name takes focus; Cancel closes it', async () => {
    const { root, page } = mount();
    const section = root.querySelector('#section-calendars')!;
    assert.equal(text(section.querySelector('.bl-empty')), copy.CALENDARS.empty);
    buttonNamed(section, copy.CALENDARS.add).click();
    const tiles = section.querySelectorAll('.ns-chooser-tile');
    assert.deepEqual(tiles.map((t) => [text(t.querySelector('.ns-tile-title')), text(t.querySelector('.ns-tile-help'))]), [
      ['iCloud', 'Calendars in your Apple account.'],
      ['Google Calendar', 'One Google calendar, by its secret address.'],
      ['Microsoft 365', 'Outlook calendars and Teams status. Needs an app registration from your administrator.'],
      ['Calendar URL', 'Any calendar link that starts with https:// or webcal://.'],
    ]);
    assert.equal(buttons(section).includes(copy.CALENDARS.add), false);
    buttonNamed(section, copy.CALENDARS.cancel).click();
    assert.equal(section.querySelector('.ns-chooser'), null);
    buttonNamed(section, copy.CALENDARS.add).click();
    section.querySelectorAll('.ns-chooser-tile')[3].click();
    await settle();
    const s = page.config.calendars[0];
    assert.match(s.id, /^cal-[0-9a-z]{8,}$/);
    const node = cardOf(root, s.id);
    assert.equal(node.querySelector('.ns-card-toggle')!.getAttribute('aria-expanded'), 'true', 'a new card opens expanded');
    assert.equal(text(node.querySelector('.ns-card-name')), copy.CALENDARS.newCalendar);
    assert.deepEqual(node.querySelectorAll('.badge').map((b) => text(b)), ['Calendar URL', 'Not saved yet']);
    assert.equal(dom.document.activeElement, field(root, `calendars.${s.id}.name`), 'its Name field has focus');
    type(field(root, `calendars.${s.id}.name`), 'Team rota');
    assert.equal(text(node.querySelector('.ns-card-name')), 'Team rota', 'the header follows the name as typed');
    await settle();
    assert.deepEqual((lastBlock().calendars as unknown[])[0], { type: 'url', id: s.id, name: 'Team rota', url: '', use: 'all' });
  });

  it('closes and opens a card from its header, and Remove asks first', async () => {
    const { root, page } = mount({ platform: 'BusyLight', calendars: [{ type: 'url', id: 'rota', name: 'Rota', url: 'https://example.com/a.ics' }] });
    let node = cardOf(root, 'rota');
    assert.equal(node.querySelector('.card-body'), null, 'a saved card starts closed');
    node = openCard(root, 'rota');
    assert.ok(node.querySelector('.card-body'));
    buttonNamed(node, copy.CALENDARS.remove).click();
    node = cardOf(root, 'rota');
    assert.ok(text(node).includes('Remove Rota?'));
    buttonNamed(node, copy.CALENDARS.cancel).click();
    assert.equal(page.config.calendars.length, 1);
    buttonNamed(cardOf(root, 'rota'), copy.CALENDARS.remove).click();
    cardOf(root, 'rota').querySelectorAll('button').find((b) => text(b) === copy.CALENDARS.remove && b.className.includes('btn-danger'))!.click();
    await settle();
    assert.equal(page.config.calendars.length, 0);
    assert.deepEqual(lastBlock().calendars, []);
    assert.equal(root.querySelector('[data-card-id="rota"]'), null);
  });
});

describe('settings page: the iCloud card (SPEC 11.3 C)', () => {
  const PI = { platform: 'BusyLight', calendars: [ICLOUD_SOURCE], lifx: { enabled: true }, sensors: ['available', 'busyAny', 'outOfOffice'] };

  it('opens the build 1 configuration from the Pi: the name-only list shows its names, ticked, with the Connect line', async () => {
    answers.set('/version', { version: '0.1.0-beta.2' });
    answers.set('/status', state());
    const { root } = mount(PI);
    const node = openCard(root, 'icloud');
    assert.equal(text(node.querySelector('.ns-card-name')), 'iCloud');
    assert.equal(field(root, 'calendars.icloud.appPassword').getAttribute('type'), 'password');
    assert.equal(field(root, 'calendars.icloud.appPassword').value, 'abcd-efgh-ijkl-mnop');
    const rows = node.querySelectorAll('.bl-cal-row');
    assert.deepEqual(rows.map((r) => [text(r.querySelector('label')), r.querySelector('input')!.checked]), [['Alex', true]]);
    assert.equal(text(node.querySelector('.bl-connect-line')), copy.CALENDARS.connectToSee);
    assert.deepEqual(buttons(node.querySelector('.ns-footer-right')), [copy.ICLOUD.connect]);
    assert.equal(exportConfig(readConfig(PI)).calendars instanceof Array, true);
    assert.deepEqual((exportConfig(readConfig(PI)).calendars as unknown[])[0], { ...ICLOUD_SOURCE, calendars: ['Alex'] }, 'unchanged when written back');
  });

  it('shows the state pill and Last checked from /status, and the error line in the pill\'s tone', async () => {
    answers.set('/version', { version: '0.1.0-beta.2' });
    answers.set('/status', state({ sources: [{ id: 'icloud', name: 'iCloud', type: 'icloud', state: 'signInNeeded',
      lastChecked: new Date(T - 120_000).toISOString(), events: null, error: 'iCloud did not accept the Apple ID and app-specific password' }] }));
    const { root, page } = mount(PI);
    page.startPolling();
    await flush();
    const node = cardOf(root, 'icloud');
    assert.deepEqual(node.querySelectorAll('.badge').map((b) => text(b)), ['iCloud', 'Sign-in needed']);
    assert.ok(node.querySelector('.bl-badge-warning'));
    assert.match(text(node.querySelector('.ns-card-meta')), /^Last checked \d+ minutes ago$/);
    assert.equal(text(node.querySelector('.bl-card-error.bl-tone-warning')), 'iCloud did not accept the Apple ID and app-specific password');
  });

  it('Connect lists the calendars with counts and badges, ticks the saved one by its new id, and writes ids and Counts for', async () => {
    const { root, page } = mount(PI);
    answers.set('/icloud/calendars', LISTED);
    let node = openCard(root, 'icloud');
    buttonNamed(node, copy.ICLOUD.connect).click();
    assert.deepEqual(buttons(cardOf(root, 'icloud').querySelector('.ns-footer-right')), [copy.ICLOUD.connecting]);
    await settle();
    assert.deepEqual(requests.find((r) => r.path === '/icloud/calendars')!.payload, { appleId: 'person@example.com', appPassword: 'abcd-efgh-ijkl-mnop' },
      'only the two fields it needs');
    node = cardOf(root, 'icloud');
    const rows = node.querySelectorAll('.bl-cal-row').map((r) => [
      text(r.querySelector('label')), r.querySelector('input')!.checked, r.querySelector('input')!.disabled, text(r.querySelector('.bl-cal-meta')),
      r.querySelectorAll('.badge').map((b) => text(b)).join('+'),
    ]);
    assert.deepEqual(rows, [
      ['Alex', true, false, '3 events today', ''],
      ['Family', false, false, '1 event today', 'Shared with you+New'],
      ['Work', false, false, 'No events today', 'New'],
      ['Holidays', false, true, '', ''],
    ]);
    assert.equal(text(rowNamed(node, 'Holidays').querySelector('.bl-cal-line')), copy.ICLOUD.subscribed);
    assert.equal(node.querySelector('.bl-connect-line'), null);
    assert.deepEqual(buttons(node.querySelector('.ns-footer-right')), [copy.ICLOUD.refresh]);
    assert.deepEqual(calendarsOf('icloud'), [{ id: '/123456789/calendars/home/', name: 'Alex', use: 'all' }], 'the build 1 name took its id');

    tick(rowNamed(node, 'Family').querySelector('input')!, true);
    node = cardOf(root, 'icloud');
    assert.equal(rowNamed(node, 'Family').querySelectorAll('.badge').map((b) => text(b)).join('+'), 'Shared with you', 'New leaves once ticked');
    choose(rowNamed(node, 'Family').querySelector('select')!, 'outOfOffice');
    await settle();
    assert.deepEqual(calendarsOf('icloud'), [
      { id: '/123456789/calendars/home/', name: 'Alex', use: 'all' },
      { id: '/123456789/calendars/family-1/', name: 'Family', use: 'outOfOffice' },
    ]);
    tick(rowNamed(node, 'Family').querySelector('input')!, false);
    tick(rowNamed(cardOf(root, 'icloud'), 'Alex').querySelector('input')!, false);
    await settle();
    assert.deepEqual(page.issues().map((i) => i.message), [VALIDATION.chooseCalendar]);
    assert.equal(feedback(root, 'calendars.icloud.calendars'), '', 'not while the checkbox has focus');
    assert.equal(text(root.querySelector('.ns-issues-heading')), SHELL.issuesHeading, 'the summary box says it at once');
    assert.deepEqual(root.querySelectorAll('.ns-issue-link').map((b) => text(b)), [`iCloud: ${VALIDATION.chooseCalendar}`]);
    (dom.document.activeElement as unknown as FakeElement).blur();
    assert.equal(feedback(root, 'calendars.icloud.calendars'), VALIDATION.chooseCalendar, 'and the list once the checkbox is left');
    assert.equal(save.enabled, false);
  });

  it('a build 1 name that two calendars share keeps both ticked after Connect, as the plugin reads both', async () => {
    const { root } = mount({ ...PI, calendars: [{ ...ICLOUD_SOURCE, calendars: ['Calendar'] }] });
    answers.set('/icloud/calendars', { calendars: [
      { id: '/123456789/calendars/home/', name: 'Calendar', shared: false, subscribed: false, eventsToday: 0 },
      { id: '/123456789/calendars/other/', name: 'Calendar', shared: true, subscribed: false, eventsToday: 0 },
    ] });
    buttonNamed(openCard(root, 'icloud'), copy.ICLOUD.connect).click();
    await settle();
    const node = cardOf(root, 'icloud');
    assert.deepEqual(node.querySelectorAll('.bl-cal-row').map((r) => r.querySelector('input')!.checked), [true, true]);
    assert.deepEqual(calendarsOf('icloud'), [
      { id: '/123456789/calendars/home/', name: 'Calendar', use: 'all' },
      { id: '/123456789/calendars/other/', name: 'Calendar', use: 'all' },
    ]);
  });

  it('Connect errors: rejected, network and unexpected, under the body', async () => {
    const { root } = mount(PI);
    openCard(root, 'icloud');
    for (const [error, message] of [['rejected', copy.ICLOUD.rejected], ['network', copy.ICLOUD.network], ['unexpected', copy.ICLOUD.unexpected]]) {
      answers.set('/icloud/calendars', { error });
      buttonNamed(cardOf(root, 'icloud'), copy.ICLOUD.connect).click();
      await settle();
      assert.equal(text(cardOf(root, 'icloud').querySelector('.ns-card-results .alert-danger')), message);
    }
  });

  it('Connect on a new card first asks for the Apple ID and password', async () => {
    const { root, page } = mount();
    buttonNamed(root, copy.CALENDARS.add).click();
    root.querySelectorAll('.ns-chooser-tile')[0].click();
    const id = page.config.calendars[0].id;
    buttonNamed(cardOf(root, id), copy.ICLOUD.connect).click();
    assert.equal(requests.length, 0);
    assert.equal(feedback(root, `calendars.${id}.appleId`), 'Apple ID email is required.');
    assert.equal(feedback(root, `calendars.${id}.appPassword`), 'App-specific password is required.');
    fill(root, `calendars.${id}.appleId`, 'not-an-email');
    assert.equal(feedback(root, `calendars.${id}.appleId`), VALIDATION.email);
    assert.equal(text(cardOf(root, id).querySelector('.bl-connect-line')), copy.CALENDARS.connectToSee);
    const help = cardOf(root, id).querySelector(`[data-path="calendars.${id}.appPassword"] .form-text`)!;
    assert.equal(text(help), `${copy.ICLOUD.appPasswordHelp} ${copy.ICLOUD.howTo}`);
    assert.deepEqual(help.querySelectorAll('a').map((a) => [text(a), a.getAttribute('href'), a.getAttribute('target')]), [
      ['account.apple.com', 'https://account.apple.com', '_blank'], ['How to create one', 'https://support.apple.com/en-us/102654', '_blank'],
    ]);
  });
});

describe('settings page: Google Calendar and Calendar URL Test (SPEC 11.3 C)', () => {
  const RAW = { platform: 'BusyLight', calendars: [
    { type: 'google', id: 'personal', name: 'Personal', url: 'https://calendar.example.com/ical/private-synthetic/basic.ics', email: 'person@example.com' },
    { type: 'url', id: 'rota', name: 'Rota', url: 'webcal://rota.example.net/team.ics', use: 'outOfOffice' },
  ] };

  it('tests the address and shows each result and error, with the Google-only sentence', async () => {
    const { root } = mount(RAW);
    openCard(root, 'personal');
    openCard(root, 'rota');
    assert.equal(field(root, 'calendars.personal.url').getAttribute('type'), 'password', 'the secret address is a password field');
    assert.equal(field(root, 'calendars.rota.use').value, 'outOfOffice');
    const cases: Array<[unknown, string, string]> = [
      [{ eventsToday: 0 }, 'Read the calendar: no events today.', 'Read the calendar: no events today.'],
      [{ eventsToday: 1 }, 'Read the calendar: 1 event today.', 'Read the calendar: 1 event today.'],
      [{ eventsToday: 4 }, 'Read the calendar: 4 events today.', 'Read the calendar: 4 events today.'],
      [{ error: 'insecure', host: 'h' }, copy.TEST.insecure, copy.TEST.insecure],
      [{ error: 'notCalendar', host: 'h' }, `${copy.TEST.notCalendar} ${copy.TEST.notCalendarGoogle}`, copy.TEST.notCalendar],
      [{ error: 'http', host: 'calendar.example.com', code: 404 }, 'calendar.example.com answered with an error (404).',
        'calendar.example.com answered with an error (404).'],
      [{ error: 'network', host: 'calendar.example.com' }, 'Could not reach calendar.example.com.', 'Could not reach calendar.example.com.'],
      [{ error: 'tooLarge', host: 'h' }, copy.TEST.tooLarge, copy.TEST.tooLarge],
    ];
    for (const [answer, google, url] of cases) {
      answers.set('/url/test', answer);
      buttonNamed(cardOf(root, 'personal'), copy.TEST.test).click();
      assert.deepEqual(buttons(cardOf(root, 'personal').querySelector('.ns-footer-right')), [copy.TEST.testing]);
      await settle();
      assert.equal(text(cardOf(root, 'personal').querySelector('.ns-card-results')), google);
      buttonNamed(cardOf(root, 'rota'), copy.TEST.test).click();
      await settle();
      assert.equal(text(cardOf(root, 'rota').querySelector('.ns-card-results')), url);
    }
    assert.deepEqual(requests.filter((r) => r.path === '/url/test').slice(0, 2).map((r) => r.payload), [
      { url: 'https://calendar.example.com/ical/private-synthetic/basic.ics', email: 'person@example.com' },
      { url: 'webcal://rota.example.net/team.ics' },
    ]);
  });

  it('validates the address and the email on blur', async () => {
    const { root } = mount(RAW);
    openCard(root, 'personal');
    fill(root, 'calendars.personal.url', 'http://calendar.example.com/a.ics');
    assert.equal(feedback(root, 'calendars.personal.url'), VALIDATION.address);
    fill(root, 'calendars.personal.url', '');
    assert.equal(feedback(root, 'calendars.personal.url'), 'Secret address in iCal format is required.');
    fill(root, 'calendars.personal.email', 'nope');
    assert.equal(feedback(root, 'calendars.personal.email'), VALIDATION.email);
    fill(root, 'calendars.personal.name', '');
    assert.equal(feedback(root, 'calendars.personal.name'), 'Name is required.');
    fill(root, 'calendars.personal.name', 'Personal');
    openCard(root, 'rota');
    fill(root, 'calendars.rota.name', 'personal');
    assert.equal(feedback(root, 'calendars.rota.name'), VALIDATION.duplicateName);
    type(field(root, 'calendars.rota.url'), 'http://rota.example.net/team.ics');
    buttonNamed(cardOf(root, 'rota'), copy.TEST.test).click();
    assert.equal(requests.length, 0, 'Test waits for a valid address');
    assert.equal(feedback(root, 'calendars.rota.url'), VALIDATION.address, 'and says why');
  });
});

describe('settings page: the Microsoft 365 card (SPEC 11.3 C)', () => {
  const TENANT = '11111111-2222-3333-4444-555555555555';
  const CLIENT = '66666666-7777-8888-9999-000000000000';
  const WORK = { type: 'microsoft', id: 'cal-work', name: 'Work', tenantId: TENANT, clientId: CLIENT, useTeamsStatus: true, useCalendar: true };
  const CODE = { verificationUri: 'https://microsoft.com/devicelogin', userCode: 'SYNTH123', expiresAt: '2026-10-08T15:15:00.000Z' };
  const OUTLOOK = { calendars: [
    { id: 'AAMkDefault=', name: 'Calendar', isDefault: true, shared: false, eventsToday: 2 },
    { id: 'AAMkTeam=', name: 'Team', isDefault: false, shared: true, eventsToday: null },
  ] };

  function work(raw: Record<string, unknown> = {}): { root: FakeElement; page: PageT } {
    const mounted = mount({ platform: 'BusyLight', calendars: [{ ...WORK, ...raw }] });
    openCard(mounted.root, 'cal-work');
    return mounted;
  }

  it('shows the note with its link, the two IDs, the two checkboxes and, for a saved source with no list, the default calendar line', () => {
    const { root } = work();
    const node = cardOf(root, 'cal-work');
    const note = node.querySelector('.bl-ms-note')!;
    assert.equal(text(note), `${copy.MICROSOFT.note} ${copy.MICROSOFT.whatToAsk}`);
    assert.equal(note.querySelector('a')!.getAttribute('href'), copy.MICROSOFT.adminUrl);
    assert.equal(field(root, 'calendars.cal-work.tenantId').getAttribute('placeholder'), 'e.g. 00000000-0000-0000-0000-000000000000');
    assert.ok(field(root, 'calendars.cal-work.clientId').className.includes('font-monospace'));
    assert.equal(text(node.querySelector('.bl-default-line')), copy.MICROSOFT.defaultCalendar);
    assert.equal(text(node.querySelector('.bl-connect-line')), copy.CALENDARS.connectToSee);
    assert.deepEqual(buttons(node.querySelector('.ns-footer-right')), [copy.MICROSOFT.connect]);
    assert.equal(buttons(node).includes(copy.MICROSOFT.disconnect), false, 'no Disconnect before it is known to be signed in');
  });

  it('Connect shows the code view, polls every 3 seconds, and on done returns the card Connected with the calendar list', async () => {
    const { root, page } = work();
    answers.set('/microsoft/start', CODE);
    answers.set('/microsoft/poll', { state: 'waiting' });
    buttonNamed(cardOf(root, 'cal-work'), copy.MICROSOFT.connect).click();
    assert.deepEqual(buttons(cardOf(root, 'cal-work').querySelector('.ns-footer-right')), [copy.MICROSOFT.gettingCode]);
    await settle();
    assert.deepEqual(requests.find((r) => r.path === '/microsoft/start')!.payload,
      { id: 'cal-work', tenantId: TENANT, clientId: CLIENT, useTeamsStatus: true, useCalendar: true });
    let node = cardOf(root, 'cal-work');
    const view = node.querySelector('.bl-code-view')!;
    assert.equal(text(view.querySelector('.bl-code-title')), copy.MICROSOFT.codeTitle);
    assert.equal(text(view.querySelector('.bl-code-body')), copy.MICROSOFT.codeBody);
    assert.equal(text(view.querySelector('.bl-code')), 'SYNTH123');
    assert.equal(text(view.querySelector('.bl-code-waiting')), copy.MICROSOFT.waiting);
    assert.deepEqual(buttons(view), [copy.MICROSOFT.copyCode, copy.CALENDARS.cancel]);
    const open = view.querySelector('a')!;
    assert.deepEqual([text(open), open.getAttribute('href'), open.getAttribute('target')], [copy.MICROSOFT.openSignIn, CODE.verificationUri, '_blank']);
    assert.equal(node.querySelector('[data-path="calendars.cal-work.tenantId"]'), null, 'the code view replaces the card body');
    await dom.clock.advance(3000);
    await dom.clock.advance(3000);
    assert.equal(requests.filter((r) => r.path === '/microsoft/poll').length, 2);
    assert.deepEqual(requests.find((r) => r.path === '/microsoft/poll')!.payload, { id: 'cal-work' });
    answers.set('/microsoft/poll', { state: 'done' });
    answers.set('/microsoft/calendars', OUTLOOK);
    await dom.clock.advance(3000);
    await settle();
    node = cardOf(root, 'cal-work');
    assert.equal(node.querySelector('.bl-code-view'), null);
    assert.deepEqual(requests.find((r) => r.path === '/microsoft/calendars')!.payload, { id: 'cal-work', tenantId: TENANT, clientId: CLIENT });
    const rows = node.querySelectorAll('.bl-cal-row').map((r) => [text(r.querySelector('label')), r.querySelector('input')!.checked,
      text(r.querySelector('.bl-cal-meta')), r.querySelectorAll('.badge').map((b) => text(b)).join('+')]);
    assert.deepEqual(rows, [['Calendar', false, '2 events today', 'Default+New'], ['Team', false, '', 'Shared with you+New']]);
    assert.equal(text(node.querySelector('.bl-subheading-help')), copy.MICROSOFT.calendarsHelp);
    assert.ok(buttons(node).includes(copy.MICROSOFT.disconnect), 'signed in: Disconnect');
    const polls = requests.filter((r) => r.path === '/microsoft/poll').length;
    await dom.clock.advance(9000);
    assert.equal(requests.filter((r) => r.path === '/microsoft/poll').length, polls, 'polling stopped when the view closed');
    tick(rowNamed(node, 'Team').querySelector('input')!, true);
    await settle();
    assert.deepEqual(calendarsOf('cal-work'), [{ id: 'AAMkTeam=', name: 'Team', use: 'all' }]);
    void page;
  });

  it('the other three endings: expired, refused with the instructions link, and Microsoft not reachable', async () => {
    const { root } = work();
    answers.set('/microsoft/start', CODE);
    answers.set('/microsoft/poll', { state: 'expired' });
    buttonNamed(cardOf(root, 'cal-work'), copy.MICROSOFT.connect).click();
    await settle();
    await dom.clock.advance(3000);
    assert.equal(text(cardOf(root, 'cal-work').querySelector('.ns-card-results')), copy.MICROSOFT.expired);
    assert.ok(cardOf(root, 'cal-work').querySelector('[data-path="calendars.cal-work.tenantId"]'), 'the card body is back');

    answers.set('/microsoft/poll', { state: 'refused', reason: 'your organization has not approved the permissions', help: copy.MICROSOFT.adminUrl });
    buttonNamed(cardOf(root, 'cal-work'), copy.MICROSOFT.connect).click();
    await settle();
    await dom.clock.advance(3000);
    const refused = cardOf(root, 'cal-work').querySelector('.ns-card-results')!;
    assert.equal(text(refused), `${copy.MICROSOFT.refused('your organization has not approved the permissions')} ${copy.MICROSOFT.instructions}`);
    assert.equal(refused.querySelector('a')!.getAttribute('href'), copy.MICROSOFT.adminUrl);

    answers.set('/microsoft/start', { error: 'network' });
    buttonNamed(cardOf(root, 'cal-work'), copy.MICROSOFT.connect).click();
    await settle();
    assert.equal(text(cardOf(root, 'cal-work').querySelector('.ns-card-results')), copy.MICROSOFT.network);
    answers.set('/microsoft/start', { error: 'refused', reason: 'the app registration does not allow public client flows', help: copy.MICROSOFT.adminUrl });
    buttonNamed(cardOf(root, 'cal-work'), copy.MICROSOFT.connect).click();
    await settle();
    assert.ok(text(cardOf(root, 'cal-work').querySelector('.ns-card-results')).startsWith(
      copy.MICROSOFT.refused('the app registration does not allow public client flows')));
  });

  it('Cancel closes the code view and tells the server; Copy code reads Copied', async () => {
    const { root } = work();
    answers.set('/microsoft/start', CODE);
    answers.set('/microsoft/poll', { state: 'waiting' });
    answers.set('/microsoft/cancel', { ok: true });
    buttonNamed(cardOf(root, 'cal-work'), copy.MICROSOFT.connect).click();
    await settle();
    buttonNamed(cardOf(root, 'cal-work'), copy.MICROSOFT.copyCode).click();
    await flush();
    assert.ok(buttons(cardOf(root, 'cal-work')).includes(copy.MICROSOFT.copied));
    assert.ok(dom.document.copies > 0, 'copied with the fallback, since the host runs over plain http');
    buttonNamed(cardOf(root, 'cal-work'), copy.CALENDARS.cancel).click();
    await flush();
    assert.deepEqual(requests.filter((r) => r.path === '/microsoft/cancel').map((r) => r.payload), [{ id: 'cal-work' }]);
    assert.equal(cardOf(root, 'cal-work').querySelector('.bl-code-view'), null);
    const polls = requests.filter((r) => r.path === '/microsoft/poll').length;
    await dom.clock.advance(9000);
    assert.equal(requests.filter((r) => r.path === '/microsoft/poll').length, polls);
  });

  it('a source the state file shows signed in lists its calendars at Connect, asks to sign in again when the token is gone, and disconnects', async () => {
    answers.set('/version', { version: '0.1.0-beta.2' });
    answers.set('/status', state({
      sources: [{ id: 'cal-work', name: 'Work', type: 'microsoft', state: 'connected', lastChecked: null, events: 3, error: null }],
    }));
    const { root, page } = mount({ platform: 'BusyLight', calendars: [{ ...WORK, calendars: [{ id: 'AAMkTeam=', name: 'Team', use: 'outOfOffice' }] }] });
    page.startPolling();
    await flush();
    let node = openCard(root, 'cal-work');
    const before = node.querySelectorAll('.bl-cal-row').map((r) => [text(r.querySelector('label')), r.querySelector('input')!.checked]);
    assert.deepEqual(before, [['Team', true]], 'the saved list, ticked, before Connect');
    assert.equal(rowNamed(node, 'Team').querySelector('select')!.value, 'outOfOffice');
    answers.set('/microsoft/calendars', OUTLOOK);
    buttonNamed(node, copy.MICROSOFT.connect).click();
    await settle();
    assert.equal(requests.filter((r) => r.path === '/microsoft/start').length, 0, 'no new code for a source already signed in');
    node = cardOf(root, 'cal-work');
    const after = node.querySelectorAll('.bl-cal-row').map((r) => [text(r.querySelector('label')), r.querySelectorAll('.badge').map((b) => text(b)).join('+')]);
    assert.deepEqual(after, [['Calendar', 'Default+New'], ['Team', 'Shared with you']]);

    answers.set('/microsoft/calendars', { error: 'notSignedIn' });
    buttonNamed(node, copy.MICROSOFT.connect).click();
    await settle();
    node = cardOf(root, 'cal-work');
    assert.equal(text(node.querySelector('.bl-sign-in-again')), copy.MICROSOFT.signInAgain);

    page.ui.microsoft.get('cal-work')!.connected = true;
    page.rerender('calendars');
    answers.set('/microsoft/disconnect', { ok: true });
    buttonNamed(cardOf(root, 'cal-work'), copy.MICROSOFT.disconnect).click();
    node = cardOf(root, 'cal-work');
    assert.ok(text(node).includes(copy.MICROSOFT.disconnectQuestion));
    assert.ok(buttons(node).includes(copy.MICROSOFT.keep));
    node.querySelectorAll('button').find((b) => text(b) === copy.MICROSOFT.disconnect && b.className.includes('btn-danger'))!.click();
    await flush();
    assert.deepEqual(requests.filter((r) => r.path === '/microsoft/disconnect').map((r) => r.payload), [{ id: 'cal-work' }]);
    assert.equal(buttons(cardOf(root, 'cal-work')).includes(copy.MICROSOFT.disconnect), false);
  });

  it('a source signed in for Teams status only asks for a new code when listing its calendars is refused', async () => {
    answers.set('/version', { version: '0.1.0-beta.2' });
    answers.set('/status', state({
      sources: [{ id: 'cal-work', name: 'Work', type: 'microsoft', state: 'connected', lastChecked: null, events: null, error: null }],
    }));
    const { root, page } = mount({ platform: 'BusyLight', calendars: [WORK] });
    page.startPolling();
    await flush();
    openCard(root, 'cal-work');
    answers.set('/microsoft/calendars', { error: 'refused', reason: 'your organization has not approved the permissions', help: copy.MICROSOFT.adminUrl });
    answers.set('/microsoft/start', CODE);
    answers.set('/microsoft/poll', { state: 'waiting' });
    buttonNamed(cardOf(root, 'cal-work'), copy.MICROSOFT.connect).click();
    await settle();
    assert.deepEqual(requests.filter((r) => r.path.startsWith('/microsoft/')).map((r) => r.path), ['/microsoft/calendars', '/microsoft/start']);
    assert.equal((requests.find((r) => r.path === '/microsoft/start')!.payload as { useCalendar: boolean }).useCalendar, true);
    const node = cardOf(root, 'cal-work');
    assert.ok(node.querySelector('.bl-code-view'), 'the code view, for a sign-in that includes the calendars');
    assert.equal(text(node).includes(copy.MICROSOFT.refused('your organization has not approved the permissions')), false);
  });

  it('a poll answered after Cancel and a new Connect leaves the new code view open', async () => {
    const { root } = work();
    answers.set('/microsoft/start', CODE);
    answers.set('/microsoft/cancel', { ok: true });
    let release: (answer: unknown) => void = () => undefined;
    answers.set('/microsoft/poll', () => new Promise((resolve) => {
      release = resolve;
    }));
    buttonNamed(cardOf(root, 'cal-work'), copy.MICROSOFT.connect).click();
    await settle();
    await dom.clock.advance(3000);
    assert.equal(requests.filter((r) => r.path === '/microsoft/poll').length, 1, 'a poll is out');
    buttonNamed(cardOf(root, 'cal-work'), copy.CALENDARS.cancel).click();
    await flush();
    buttonNamed(cardOf(root, 'cal-work'), copy.MICROSOFT.connect).click();
    await settle();
    release({ state: 'expired' });
    await flush();
    const node = cardOf(root, 'cal-work');
    assert.ok(node.querySelector('.bl-code-view'), 'the new code view stays');
    assert.equal(text(node).includes(copy.MICROSOFT.expired), false);
    answers.set('/microsoft/poll', { state: 'waiting' });
    await dom.clock.advance(3000);
    assert.equal(requests.filter((r) => r.path === '/microsoft/poll').length, 2, 'and keeps polling');
  });

  it('validates the IDs, both checkboxes off, and a second Microsoft 365 card using Teams status', () => {
    const { root } = mount({ platform: 'BusyLight', calendars: [WORK, { ...WORK, id: 'cal-two', name: 'Two' }] });
    openCard(root, 'cal-work');
    openCard(root, 'cal-two');
    fill(root, 'calendars.cal-work.tenantId', 'contoso');
    assert.equal(feedback(root, 'calendars.cal-work.tenantId'), VALIDATION.guid);
    fill(root, 'calendars.cal-work.clientId', '');
    assert.equal(feedback(root, 'calendars.cal-work.clientId'), 'Application (client) ID is required.');
    const teams = field(root, 'calendars.cal-two.useTeamsStatus');
    tick(teams, true);
    assert.equal(feedback(root, 'calendars.cal-two.useTeamsStatus'), VALIDATION.microsoftTeamsTwice);
    tick(field(root, 'calendars.cal-two.useTeamsStatus'), false);
    tick(field(root, 'calendars.cal-two.useCalendar'), false);
    (dom.document.activeElement as unknown as FakeElement).blur?.();
    assert.equal(feedback(root, 'calendars.cal-two.useCalendar'), VALIDATION.microsoftNeither);
  });
});

describe('settings page: Colors (SPEC 11.3 D)', () => {
  function rowOf(root: FakeElement, key: string): FakeElement {
    return root.querySelector(`[data-path="colors.${key}"]`)!;
  }
  /** The name of the swatch a row has chosen, and which swatch takes Tab. */
  const chosen = (row: FakeElement): string => row.querySelector('[role="radio"][aria-checked="true"]')!.getAttribute('aria-label')!;
  const tabStop = (row: FakeElement): string[] => row.querySelectorAll('[role="radio"]').filter((b) => b.getAttribute('tabindex') === '0')
    .map((b) => b.getAttribute('aria-label')!);
  const swatchNamed = (row: FakeElement, name: string): FakeElement => row.querySelector(`[role="radio"][aria-label="${name}"]`)!;
  /** Shows the rows of the statuses the setup cannot produce (SPEC 11.3 D, from build 3.1). */
  const showAll = (root: FakeElement): void => root.querySelector('#section-colors .bl-show-statuses')!.click();

  it('one row per status in precedence order, each a radio group of the presets, Off and Custom, the saved color chosen', () => {
    const { root } = mount({ platform: 'BusyLight', colors: { inMeeting: '#aa00ff', busy: '#ff6a00', available: '#00ff00' } });
    showAll(root);
    const rows = root.querySelectorAll('#section-colors .bl-color-row');
    assert.deepEqual(rows.map((r) => text(r.querySelector('.bl-color-name'))),
      ['Out of office', 'Do not disturb', 'In a call', 'In a meeting', 'Busy', 'Tentative', 'Away', 'Available', 'Offline']);
    for (const row of rows) {
      const group = row.querySelector('[role="radiogroup"]')!;
      assert.ok(group.getAttribute('aria-labelledby'));
      assert.deepEqual(group.querySelectorAll('[role="radio"]').map((b) => [b.getAttribute('aria-label'), b.getAttribute('title')]),
        ['Red', 'Orange', 'Yellow', 'Green', 'Blue', 'Purple', 'White', 'Off', 'Custom'].map((n) => [n, n]), 'the name as label and tooltip');
      assert.deepEqual(group.querySelectorAll('.bl-preset-label').map((l) => text(l)),
        ['Red', 'Orange', 'Yellow', 'Green', 'Blue', 'Purple', 'White', 'Off', 'Custom'], 'the names under each swatch below 600 px');
      assert.equal(tabStop(row).length, 1, 'one tab stop per group');
    }
    assert.deepEqual(rows.map(chosen), ['Purple', 'Red', 'Red', 'Custom', 'Orange', 'Yellow', 'Yellow', 'Green', 'Off'],
      'the defaults are presets, case does not matter, and any other color is Custom');
    const meeting = rowOf(root, 'inMeeting');
    assert.equal(meeting.querySelector('.bl-color-custom')!.hidden, false);
    assert.equal(meeting.querySelector('.bl-color-hex')!.value, '#AA00FF');
    assert.equal(meeting.querySelector('input[type="color"]')!.value, '#aa00ff');
    assert.match(swatchNamed(meeting, 'Custom').querySelector('.bl-preset-swatch')!.getAttribute('style')!, /#AA00FF/);
    assert.equal(rowOf(root, 'busy').querySelector('.bl-color-custom')!.hidden, true, 'hidden unless Custom is chosen');
    assert.ok(swatchNamed(rowOf(root, 'offline'), 'Off').querySelector('.bl-preset-off'), 'Off is an outlined circle with a line');
    assert.equal(text(root.querySelector('.bl-precedence')), copy.COLORS.precedence);
  });

  it('a preset, Off and Custom write the color; arrow keys move and choose; a bad hex shows the 11.3 H message; Reset colors', async () => {
    const { root, page } = mount();
    showAll(root);
    const row = rowOf(root, 'busy');
    swatchNamed(row, 'Blue').click();
    await settle();
    assert.equal((lastBlock().colors as Record<string, string>).busy, '#0050FF');
    assert.equal(chosen(row), 'Blue');
    assert.deepEqual(tabStop(row), ['Blue']);
    swatchNamed(row, 'Off').click();
    assert.equal(page.config.colors.busy, 'off');
    const white = swatchNamed(row, 'White');
    white.focus();
    white.dispatchEvent(new FakeEvent('keydown', true, { key: 'ArrowLeft' }));
    assert.equal(page.config.colors.busy, '#B400FF', 'ArrowLeft from White chooses Purple');
    assert.equal(dom.document.activeElement, swatchNamed(row, 'Purple') as unknown, 'and moves focus with it');
    swatchNamed(row, 'Purple').dispatchEvent(new FakeEvent('keydown', true, { key: 'End' }));
    assert.equal(chosen(row), 'Custom');
    assert.equal(row.querySelector('.bl-color-custom')!.hidden, false);
    assert.equal(page.config.colors.busy, '#B400FF', 'Custom starts from the color it had');
    assert.equal(chosen(row), 'Custom', 'and stays Custom while the color equals a preset');
    swatchNamed(row, 'Custom').dispatchEvent(new FakeEvent('keydown', true, { key: 'ArrowRight' }));
    assert.equal(chosen(row), 'Red', 'the arrows wrap around');
    swatchNamed(row, 'Custom').click();
    const picker = row.querySelector('input[type="color"]')!;
    picker.value = '#123abc';
    picker.dispatchEvent(new FakeEvent('input', true));
    assert.equal(row.querySelector('.bl-color-hex')!.value, '#123ABC');
    await settle();
    assert.equal((lastBlock().colors as Record<string, string>).busy, '#123ABC');
    const hex = row.querySelector('.bl-color-hex')!;
    hex.focus();
    type(hex, '#12');
    hex.blur();
    assert.equal(feedback(root, 'colors.busy'), VALIDATION.color);
    assert.ok(hex.classList.contains('is-invalid'));
    assert.equal(save.enabled, false);
    hex.focus();
    type(hex, '#00ff00');
    hex.blur();
    assert.equal(feedback(root, 'colors.busy'), '');
    swatchNamed(row, 'Off').click();
    swatchNamed(row, 'Custom').click();
    assert.equal(page.config.colors.busy, '#00FF00', 'Custom brings the last custom color back');
    buttonNamed(root.querySelector('#section-colors')!, copy.COLORS.reset).click();
    await settle();
    assert.deepEqual(lastBlock().colors, {
      outOfOffice: '#B400FF', doNotDisturb: '#FF0000', inCall: '#FF0000', inMeeting: '#FF0000', busy: '#FF6A00', tentative: '#FFD000',
      away: '#FFD000', available: '#00FF00', offline: 'off',
    });
    assert.equal(chosen(rowOf(root, 'busy')), 'Orange');
  });

  it('calendars only: the four statuses calendars give, and 5 more statuses behind Show all statuses (SPEC 11.3 D)', () => {
    const { root } = mount({ platform: 'BusyLight', calendars: [ICLOUD_SOURCE, { type: 'url', id: 'office', name: 'Office',
      url: 'https://outlook.office365.com/owa/calendar/synthetic/calendar.ics' }] });
    const names = (): string[] => root.querySelectorAll('#section-colors .bl-color-row').map((r) => text(r.querySelector('.bl-color-name')));
    assert.deepEqual(names(), ['Out of office', 'In a meeting', 'Tentative', 'Available']);
    const more = root.querySelector('#section-colors .bl-more-statuses')!;
    assert.equal(text(more.querySelector('span')), copy.COLORS.moreStatuses(5));
    assert.equal(text(more.querySelector('span')), '5 more statuses come from Teams or from other apps.');
    assert.equal(text(more.querySelector('button')), copy.COLORS.showAll);
    more.querySelector('button')!.click();
    assert.deepEqual(names(), ['Out of office', 'Do not disturb', 'In a call', 'In a meeting', 'Busy', 'Tentative', 'Away', 'Available', 'Offline'],
      'all nine in the precedence order');
    assert.equal(text(root.querySelector('#section-colors .bl-show-statuses')), copy.COLORS.showFewer);
    root.querySelector('#section-colors .bl-show-statuses')!.click();
    assert.deepEqual(names(), ['Out of office', 'In a meeting', 'Tentative', 'Available']);
    assert.equal(text(root.querySelector('#section-colors .bl-precedence')), copy.COLORS.precedence, 'the precedence line stays');
    assert.ok(!text(root).includes('Teams only'), 'no Teams only text anywhere');
  });

  it('the rows follow the On a Call switch, the status input and Teams status on the page, live', () => {
    const { root } = mount({ platform: 'BusyLight', calendars: [ICLOUD_SOURCE] });
    const names = (): string[] => root.querySelectorAll('#section-colors .bl-color-row').map((r) => text(r.querySelector('.bl-color-name')));
    const ALL = ['Out of office', 'Do not disturb', 'In a call', 'In a meeting', 'Busy', 'Tentative', 'Away', 'Available', 'Offline'];
    tick(field(root, 'callSwitch.enabled'), true);
    assert.deepEqual(names(), ['Out of office', 'In a call', 'In a meeting', 'Tentative', 'Available'], 'the switch adds In a call');
    assert.equal(text(root.querySelector('#section-colors .bl-more-statuses span')), copy.COLORS.moreStatuses(4));
    tick(field(root, 'statusInput.enabled'), true);
    assert.deepEqual(names(), ALL, 'the status input: all nine');
    assert.equal(root.querySelector('#section-colors .bl-more-statuses'), null, 'nothing hidden, no line');
    tick(field(root, 'statusInput.enabled'), false);
    tick(field(root, 'callSwitch.enabled'), false);
    assert.deepEqual(names(), ['Out of office', 'In a meeting', 'Tentative', 'Available'], 'turned off, the rows hide again');
    buttonNamed(root.querySelector('#section-calendars')!, copy.CALENDARS.add).click();
    root.querySelector('#section-calendars .ns-chooser-tile[data-type="microsoft"]')!.click();
    const optionSignIn = root.querySelector('#section-calendars .bl-outlook-signin');
    if (optionSignIn) {
      optionSignIn.click();
    }
    const card = root.querySelectorAll('#section-calendars .bl-source-microsoft').at(-1)!;
    const teams = field(root, `calendars.${card.getAttribute('data-card-id')}.useTeamsStatus`);
    assert.equal(teams.checked, true, 'a new Microsoft 365 card reads Teams status');
    assert.deepEqual(names(), ALL, 'a Microsoft 365 source with Teams status: all nine');
    tick(teams, false);
    assert.deepEqual(names(), ['Out of office', 'In a meeting', 'Tentative', 'Available'], 'Teams status off: hidden again');
  });

  it('hidden rows keep their saved colors on Save, and Reset colors resets all nine', async () => {
    const colors = { doNotDisturb: '#123456', busy: 'off', offline: '#ABCDEF', tentative: '#FFD000' };
    const { root } = mount({ platform: 'BusyLight', calendars: [ICLOUD_SOURCE], colors });
    assert.equal(root.querySelector('[data-path="colors.busy"]'), null, 'hidden');
    fill(root, 'name', 'Door');
    await settle();
    const saved = lastBlock().colors as Record<string, string>;
    assert.deepEqual([saved.doNotDisturb, saved.busy, saved.offline], ['#123456', 'off', '#ABCDEF'], 'saved unchanged');
    buttonNamed(root.querySelector('#section-colors')!, copy.COLORS.reset).click();
    await settle();
    assert.deepEqual(lastBlock().colors, { ...DEFAULTS.colors }, 'all nine reset');
  });
});

describe('settings page: Lights (SPEC 11.3 E)', () => {
  const FLOOR = { label: 'Floor', serial: 'd073d5000001', ip: '192.168.4.50' };
  const DESK = { label: 'Desk', serial: 'd073d5000002', ip: '192.168.4.51' };
  const lifxCard = (root: FakeElement): FakeElement => root.querySelector('#section-lights .bl-lifx-card')!;
  const lines = (root: FakeElement): string[] => lifxCard(root).querySelectorAll('.bl-lifx-results .bl-lifx-line').map((l) => text(l));

  it('ticking Use a LIFX bulb searches at once; one bulb is used and written as its serial number', async () => {
    const { root, page } = mount();
    assert.deepEqual(lifxCard(root).querySelectorAll('input').length, 1, 'only the checkbox while it is off');
    answers.set('/lifx/discover', { bulbs: [FLOOR] });
    tick(field(root, 'lifx.enabled'), true);
    assert.deepEqual(lines(root), [copy.LIGHTS.searching]);
    await settle();
    assert.deepEqual(requests.map((r) => r.path), ['/lifx/discover']);
    assert.deepEqual(lines(root), ['Found Floor (192.168.4.50). Busy Light will use it.']);
    assert.equal(page.config.lifx.bulb, 'd073d5000001');
    assert.deepEqual(lastBlock().lifx, { enabled: true, bulb: 'd073d5000001', host: '', brightness: 100, refreshSeconds: 300 });
    assert.deepEqual(buttons(lifxCard(root).querySelector('.bl-lifx-actions')), [copy.LIGHTS.searchAgain]);
  });

  it('the Pi: a saved block with the bulb found by discovery opens without searching; Search again finds Floor', async () => {
    answers.set('/version', { version: '0.1.0-beta.2' });
    answers.set('/status', state());
    const { root, page } = mount({ platform: 'BusyLight', calendars: [ICLOUD_SOURCE], lifx: { enabled: true } });
    page.startPolling();
    await flush();
    assert.equal(requests.some((r) => r.path === '/lifx/discover'), false, 'opening the page calls only /version and /status');
    assert.deepEqual(lines(root), ['Busy Light is using Floor (192.168.4.50).'], 'the bulb in use, from the state file (SPEC 11.3 E)');
    answers.set('/lifx/discover', { bulbs: [FLOOR] });
    buttonNamed(lifxCard(root), copy.LIGHTS.searchAgain).click();
    await settle();
    assert.deepEqual(lines(root), ['Found Floor (192.168.4.50). Busy Light will use it.']);
  });

  it('several bulbs: one radio each, and the choice is written as its serial number', async () => {
    const { root, page } = mount({ platform: 'BusyLight', lifx: { enabled: true } });
    answers.set('/lifx/discover', { bulbs: [DESK, FLOOR] });
    buttonNamed(lifxCard(root), copy.LIGHTS.searchAgain).click();
    await settle();
    assert.deepEqual(lines(root), ['Found 2 bulbs. Choose one:']);
    const radios = lifxCard(root).querySelectorAll('input[type="radio"]');
    assert.deepEqual(radios.map((r) => text(r.parentNode!)), ['Desk (192.168.4.51)', 'Floor (192.168.4.50)']);
    assert.equal(page.config.lifx.bulb, '', 'nothing is chosen for the user');
    radios[1].checked = true;
    radios[1].dispatchEvent(new FakeEvent('change', true));
    await settle();
    assert.equal(page.config.lifx.bulb, 'd073d5000001');
    assert.equal(lifxCard(root).querySelectorAll('input[type="radio"]')[1].checked, true);
  });

  it('none found, the saved bulb missing, and a build 1 name written as its serial when found', async () => {
    const { root, page } = mount({ platform: 'BusyLight', lifx: { enabled: true } });
    answers.set('/lifx/discover', { bulbs: [] });
    buttonNamed(lifxCard(root), copy.LIGHTS.searchAgain).click();
    await settle();
    assert.deepEqual(lines(root), [copy.LIGHTS.none]);
    const named = mount({ platform: 'BusyLight', lifx: { enabled: true, bulb: 'floor' } });
    buttonNamed(lifxCard(named.root), copy.LIGHTS.searchAgain).click();
    await settle();
    assert.deepEqual(lines(named.root), ['floor was not found just now. It may be switched off.']);
    answers.set('/lifx/discover', { bulbs: [DESK, FLOOR] });
    buttonNamed(lifxCard(named.root), copy.LIGHTS.searchAgain).click();
    await settle();
    assert.equal(named.page.config.lifx.bulb, 'd073d5000001', 'the name matched without regard to case');
    assert.equal(lifxCard(named.root).querySelectorAll('input[type="radio"]').find((r) => r.checked)!.value, 'd073d5000001');
    void page;
  });

  it('an IP address under Advanced hides the search and says which bulb is used; it is validated', async () => {
    const { root } = mount({ platform: 'BusyLight', lifx: { enabled: true, bulb: 'd073d5000001' } });
    const advanced = lifxCard(root).querySelector('details')!;
    assert.equal(advanced.open, false);
    assert.equal(text(advanced.querySelector('summary')), copy.SHELL.advanced);
    assert.equal(text(advanced.querySelector('[data-path="lifx.host"] .form-text')), `${copy.LIGHTS.ipLead} ${copy.LIGHTS.ipHelp}`);
    fill(root, 'lifx.host', '192.168.4.99');
    assert.deepEqual(lines(root), ['Busy Light will use the bulb at 192.168.4.99.']);
    assert.equal(lifxCard(root).querySelector('.bl-search-again'), null);
    fill(root, 'lifx.host', '999.1.1.1');
    assert.equal(feedback(root, 'lifx.host'), VALIDATION.host);
    fill(root, 'lifx.host', '');
    assert.deepEqual(buttons(lifxCard(root).querySelector('.bl-lifx-actions')), [copy.LIGHTS.searchAgain]);
    fill(root, 'lifx.brightness', '0');
    assert.equal(feedback(root, 'lifx.brightness'), 'Enter a whole number from 1 to 100.');
    fill(root, 'lifx.refreshSeconds', '');
    assert.equal(feedback(root, 'lifx.refreshSeconds'), 'Send the color again every (seconds) is required.');
  });

  it('Test light sends the serial and address, or the IP address alone, and shows whether the bulb answered', async () => {
    const { root } = mount({ platform: 'BusyLight', lifx: { enabled: true, brightness: 60 } });
    answers.set('/lifx/discover', { bulbs: [FLOOR] });
    buttonNamed(lifxCard(root), copy.LIGHTS.searchAgain).click();
    await settle();
    answers.set('/lifx/test', { answered: true });
    assert.equal(text(lifxCard(root).querySelector('.bl-test-help')), copy.LIGHTS.testHelp);
    buttonNamed(lifxCard(root), copy.LIGHTS.testLight).click();
    assert.deepEqual(buttons(lifxCard(root).querySelector('.ns-footer-right')), [copy.LIGHTS.testing]);
    await settle();
    assert.equal(text(lifxCard(root).querySelector('.ns-card-results')), copy.LIGHTS.answered);
    assert.deepEqual(requests.find((r) => r.path === '/lifx/test')!.payload, { brightness: 60, serial: 'd073d5000001', host: '192.168.4.50' });
    fill(root, 'lifx.host', '192.168.4.99');
    answers.set('/lifx/test', { answered: false });
    buttonNamed(lifxCard(root), copy.LIGHTS.testLight).click();
    await settle();
    assert.equal(text(lifxCard(root).querySelector('.ns-card-results')), copy.LIGHTS.noAnswer);
    assert.deepEqual(requests.filter((r) => r.path === '/lifx/test')[1].payload, { brightness: 60, host: '192.168.4.99' });
  });

  it('the sensors to create, named from the platform name, the other seven under Show all statuses, and the three steps', async () => {
    const { root, page } = mount({ platform: 'BusyLight', name: 'Door' });
    const section = root.querySelector('#section-lights')!;
    const labels = (node: FakeElement) => node.querySelectorAll('.form-check-label').map((l) => text(l));
    assert.equal(text(section.querySelector('.bl-other-heading')), copy.LIGHTS.otherHeading);
    assert.deepEqual(labels(section.querySelector('.bl-sensors')!), ['Door Available', 'Door Busy', 'Door Out of Office']);
    const all = section.querySelector('details.bl-all-sensors')!;
    assert.equal(text(all.querySelector('summary')), copy.LIGHTS.showAll);
    assert.equal(all.open, false);
    // From build 3.1, the statuses a calendar-only setup cannot produce come last, with their help (SPEC 11.3 E).
    assert.deepEqual(labels(all), ['Door In a Meeting', 'Door Tentative', 'Door In a Call', 'Door Do Not Disturb', 'Door Busy in Teams', 'Door Away',
      'Door Offline']);
    assert.deepEqual(all.querySelectorAll('.form-check').map((c) => text(c.querySelector('.form-text'))),
      ['', '', ...Array(5).fill(copy.LIGHTS.nothingReports)]);
    assert.deepEqual(section.querySelectorAll('.bl-sensors input').slice(0, 3).map((i) => i.checked), [true, true, true]);
    tick(all.querySelectorAll('input')[0], true);
    tick(section.querySelectorAll('.bl-sensors input')[0], false);
    await settle();
    assert.deepEqual(lastBlock().sensors, ['busyAny', 'outOfOffice', 'inMeeting']);
    assert.deepEqual(section.querySelectorAll('.ns-step-text').map((s) => text(s)), [
      'In the Home app, add an automation: A sensor detects something.', 'Choose Door Busy, then Detects occupancy.', 'Set your light to red.',
    ]);
    assert.equal(mount({ platform: 'BusyLight', sensors: ['away'] }).root.querySelector('details.bl-all-sensors')!.open, true,
      'open when one of the seven is ticked');
    void page;
  });
});

describe('settings page: Settings (SPEC 11.3 F)', () => {
  function resetLink(root: FakeElement): FakeElement {
    const link = root.querySelectorAll('#section-settings button').find((b) => text(b) === copy.SHELL.reset);
    assert.ok(link, 'no Reset link');
    return link;
  }

  it('one collapsed Advanced holding the settings in the order of the SPEC, with their help', () => {
    const { root } = mount();
    const details = root.querySelector('#section-settings details')!;
    assert.equal(details.open, false);
    assert.equal(text(details.querySelector('summary')), copy.SHELL.advanced);
    const labels = details.querySelectorAll('label').map((l) => text(l).replace(/\*$/, ''));
    assert.deepEqual(labels, [copy.SETTINGS.name, copy.SETTINGS.pollSeconds, copy.SETTINGS.calendarSeconds, copy.SETTINGS.ignoreAllDayBusy,
      copy.SETTINGS.outOfOfficeWords, copy.SETTINGS.overrideSwitch, copy.SETTINGS.debug]);
    assert.equal(field(root, 'name').value, 'Busy Light');
    assert.equal(field(root, 'outOfOfficeWords').value, 'Out of office, OOO, Vacation, PTO');
    assert.equal(text(root.querySelector('[data-path="debug"] .form-text')), copy.SETTINGS.debugHelp);
    assert.deepEqual(buttons(details), [copy.SHELL.reset]);
  });

  it('validates on blur, opens Advanced for an issue, and writes the words as a list', async () => {
    const { root, page } = mount();
    fill(root, 'name', ' ');
    assert.equal(feedback(root, 'name'), 'Name is required.');
    assert.deepEqual(root.querySelectorAll('.ns-issue-link').map((b) => text(b)), ['Settings: Name is required.']);
    assert.equal(save.enabled, false);
    fill(root, 'name', 'Door');
    choose(field(root, 'pollSeconds'), '60');
    choose(field(root, 'calendarSeconds'), '300');
    fill(root, 'outOfOfficeWords', 'Holiday, , Leave ');
    await settle();
    assert.equal(save.enabled, true);
    assert.equal(root.querySelector('.ns-issues')!.hidden, true);
    const block = lastBlock();
    assert.deepEqual([block.name, block.pollSeconds, block.calendarSeconds, block.outOfOfficeWords], ['Door', 60, 300, ['Holiday', 'Leave']]);
    assert.ok(text(root.querySelector('#section-lights .bl-sensors')).includes('Door Available'), 'the sensors follow the name');
    const reopened = mount();
    fill(reopened.root, 'name', ' ');
    reopened.root.querySelector('#section-settings details')!.open = false;
    assert.equal(reopened.page.issues().length, 1);
    reopened.root.querySelector('.ns-issue-link')!.click();
    assert.equal(reopened.root.querySelector('#section-settings details')!.open, true, 'the summary entry opens Advanced');
    assert.equal(dom.document.activeElement, field(reopened.root, 'name'), 'and moves focus to the field');
    assert.equal(feedback(reopened.root, 'name'), 'Name is required.');
    void page;
  });

  it('the Reset dialog sits below the link, needs RESET in any case, and Confirm resets the page in place', async () => {
    const { root, page } = mount({
      platform: 'BusyLight', name: 'Door', debug: true, calendars: [ICLOUD_SOURCE], colors: { busy: '#123456' }, lifx: { enabled: true },
    });
    root.querySelector('#section-settings details')!.open = true;
    resetLink(root).click();
    let dialog = root.querySelector('.ns-inline-dialog')!;
    assert.equal(resetLink(root).nextElementSibling, dialog, 'directly below the link');
    assert.ok(dialog.classList.contains('card'), 'a card, so the host paints it in both themes');
    assert.equal(text(dialog.querySelector('.ns-inline-dialog-title')), copy.SHELL.resetTitle);
    assert.deepEqual(dialog.querySelectorAll('li').map((li) => text(li)), copy.SETTINGS.resetLines);
    assert.equal(text(dialog.querySelector('label')), copy.SHELL.resetPrompt);
    assert.deepEqual(buttons(dialog), [copy.SHELL.resetConfirm, copy.SHELL.resetCancel]);
    await dom.clock.advance(0);
    assert.equal(dom.document.activeElement, dialog.querySelector('input'));
    assert.deepEqual(dialog.scrolledInto, [{ block: 'center' }]);
    const confirm = buttonNamed(dialog, copy.SHELL.resetConfirm);
    assert.equal(confirm.disabled, true);
    type(dialog.querySelector('input')!, 'reset');
    assert.equal(confirm.disabled, false);
    buttonNamed(dialog, copy.SHELL.resetCancel).click();
    assert.equal(root.querySelector('.ns-inline-dialog'), null);
    resetLink(root).click();
    dom.document.dispatchEvent(new FakeEvent('keydown', true, { key: 'Escape' }));
    assert.equal(root.querySelector('.ns-inline-dialog'), null, 'Escape closes');

    resetLink(root).click();
    dialog = root.querySelector('.ns-inline-dialog')!;
    type(dialog.querySelector('input')!, 'RESET');
    answers.set('/reset', { ok: true });
    answers.set('/status', { status: null });
    buttonNamed(dialog, copy.SHELL.resetConfirm).click();
    await settle();
    assert.equal(requests.filter((r) => r.path === '/reset').length, 1);
    const done = root.querySelector('.bl-reset-done')!;
    assert.equal(text(done.querySelector('.ns-inline-dialog-title')), copy.SETTINGS.resetDoneTitle);
    assert.equal(text(done.querySelector('.ns-inline-dialog-body')), copy.SETTINGS.resetDoneBody);
    assert.equal(root.querySelectorAll('#section-settings button').find((b) => text(b) === copy.SHELL.reset), undefined, 'no Reset link until a reload');
    assert.deepEqual(done.scrolledInto, [{ block: 'center' }]);
    assert.equal(page.config.name, 'Busy Light');
    assert.deepEqual(lastBlock(), exportConfig(readConfig({ platform: 'BusyLight' })), 'the defaults, for Save to write');
    assert.equal(text(root.querySelector('#section-calendars .bl-empty')), copy.CALENDARS.empty);
    assert.equal(dom.storage.getItem('homebridge-busy-light:draft'), null, 'no draft after a Reset');
  });
});

describe('settings page: the draft (shell rule M1)', () => {
  const GOOGLE_URL = 'https://calendar.example.com/ical/private-synthetic/basic.ics';
  const ROTA_URL = 'https://rota.example.net/private-synthetic.ics';
  const RAW = { platform: 'BusyLight', calendars: [
    ICLOUD_SOURCE,
    { type: 'google', id: 'personal', name: 'Personal', url: GOOGLE_URL },
    { type: 'url', id: 'rota', name: 'Rota', url: ROTA_URL },
  ] };

  it('is written only after a change and never holds a secret', async () => {
    const { root } = mount(RAW);
    await settle();
    assert.equal(dom.storage.getItem('homebridge-busy-light:draft'), null, 'opening the page writes none');
    fill(root, 'name', 'Door');
    const stored = dom.storage.getItem('homebridge-busy-light:draft')!;
    assert.ok(stored.includes('"name":"Door"'));
    for (const secret of ['abcd-efgh-ijkl-mnop', 'private-synthetic', 'calendar.example.com/ical']) {
      assert.equal(stored.includes(secret), false, secret);
    }
  });

  it('is offered back under the banner when it differs from the saved block; Restore puts the secrets back, Discard deletes it', async () => {
    const first = mount(RAW);
    fill(first.root, 'name', 'Door');
    first.root.remove();
    const { root, page } = mount(RAW);
    const banner = root.querySelector('.ns-draft-banner')!;
    assert.equal(root.children[1].firstElementChild, banner, 'directly under the banner');
    assert.equal(text(banner.querySelector('.ns-draft-text')), copy.SHELL.draft);
    assert.deepEqual(buttons(banner), [copy.SHELL.restore, copy.SHELL.discard]);
    buttonNamed(banner, copy.SHELL.restore).click();
    await settle();
    assert.equal(root.querySelector('.ns-draft-banner'), null);
    assert.equal(page.config.name, 'Door');
    const icloud = page.config.calendars.find((s) => s.id === 'icloud')!;
    assert.equal(icloud.appPassword, 'abcd-efgh-ijkl-mnop', 'the password comes back from the saved configuration');
    assert.equal(page.config.calendars.find((s) => s.id === 'personal')!.url, GOOGLE_URL);
    assert.equal(page.config.calendars.find((s) => s.id === 'rota')!.url, ROTA_URL);
    assert.equal(lastBlock().name, 'Door');

    const again = mount(RAW);
    buttonNamed(again.root.querySelector('.ns-draft-banner')!, copy.SHELL.discard).click();
    assert.equal(again.root.querySelector('.ns-draft-banner'), null);
    assert.equal(dom.storage.getItem('homebridge-busy-light:draft'), null);
    assert.equal(mount(RAW).root.querySelector('.ns-draft-banner'), null);
  });

  it('a draft equal to the saved block (it was saved) is deleted without a banner', () => {
    const first = mount(RAW);
    fill(first.root, 'name', 'Door');
    fill(first.root, 'name', 'Busy Light');
    assert.ok(dom.storage.getItem('homebridge-busy-light:draft'));
    assert.equal(mount(RAW).root.querySelector('.ns-draft-banner'), null);
    assert.equal(dom.storage.getItem('homebridge-busy-light:draft'), null);
  });
});

// SPEC 15 item 19: the Status from other apps section (11.3 I).

describe('settings page: Status from other apps (SPEC 11.3 I)', () => {
  const ID = 'q3Lr8vT0cXw2mN5a';
  const INFO = { hostname: 'homebridge.local', addresses: ['192.168.4.10'], port: 8582, id: ID };
  const section = (root: FakeElement): FakeElement => root.querySelector('#section-statusInput')!;
  const addressLines = (root: FakeElement): string[] =>
    section(root).querySelectorAll('.bl-input-addresses .bl-readonly-line').map((l) => text(l));
  const codeLine = (root: FakeElement): string => text(section(root).querySelector('.bl-setup-code .bl-readonly-line'));
  const KEY = /^[A-Za-z0-9_-]{43}$/;

  it('off by default, as the Pi\'s block opens it: the help with its link, the checkbox, the On a Call switch, and no /input/info', async () => {
    answers.set('/version', { version: '0.1.0-beta.3' });
    answers.set('/status', state());
    const { root, page } = mount({ platform: 'BusyLight', calendars: [ICLOUD_SOURCE], lifx: { enabled: true } });
    page.startPolling();
    await flush();
    const node = section(root);
    assert.equal(text(node.querySelector('h2')), copy.STATUS_INPUT.heading);
    assert.equal(text(node.querySelector('.section-copy')), `${copy.STATUS_INPUT.help} ${copy.STATUS_INPUT.howAppsConnect}`);
    const link = node.querySelector('.section-copy a')!;
    assert.deepEqual([link.getAttribute('href'), link.getAttribute('target'), link.getAttribute('rel')],
      [copy.STATUS_INPUT.docsUrl, '_blank', 'noopener noreferrer']);
    assert.equal(field(root, 'statusInput.enabled').checked, false);
    assert.equal(node.querySelector('.bl-input-body'), null, 'nothing more while it is off');
    assert.equal(text(node.querySelector('.bl-senders-heading')), copy.STATUS_INPUT.reporting);
    assert.equal(text(node.querySelector('.bl-senders')), copy.STATUS_INPUT.noneReporting);
    assert.equal(field(root, 'callSwitch.enabled').checked, false);
    assert.equal(node.querySelector('[data-path="callSwitch.hours"]'), null);
    assert.deepEqual(requests.map((r) => r.path), ['/version', '/status'], 'opening the page with the input off calls nothing more');
    assert.deepEqual(page.issues(), []);
  });

  it('ticking the box makes a key of 43 base64url characters, asks /input/info, and shows the addresses, the key and the setup code', async () => {
    answers.set('/input/info', INFO);
    const { root, page } = mount();
    tick(field(root, 'statusInput.enabled'), true);
    await settle();
    const key = page.config.statusInput.key;
    assert.match(key, KEY);
    assert.deepEqual(lastBlock().statusInput, { enabled: true, port: 8582, key, allowPlainKey: true });
    assert.deepEqual(requests.filter((r) => r.path === '/input/info').map((r) => r.payload), [{}], 'asked once, with nothing');
    assert.deepEqual(addressLines(root), ['http://homebridge.local:8582', 'http://192.168.4.10:8582']);
    assert.equal(section(root).querySelector('.bl-reserve-help'), null, 'no reserve help with a host name');
    const keyInput = section(root).querySelector('.bl-input-key input')!;
    assert.equal(keyInput.getAttribute('type'), 'password');
    assert.equal(keyInput.value, key);
    assert.ok(keyInput.hasAttribute('readonly'));
    buttonNamed(section(root).querySelector('.bl-input-key')!, copy.SHELL.show).click();
    assert.equal(keyInput.getAttribute('type'), 'text');
    assert.equal(codeLine(root), `busylight://homebridge.local:8582/?key=${key}&id=${ID}`);
    const copiesBefore = dom.document.copies;
    buttonNamed(section(root), copy.STATUS_INPUT.copyKey).click();
    await flush();
    buttonNamed(section(root), copy.STATUS_INPUT.copySetupCode).click();
    await flush();
    assert.equal(dom.document.copies, copiesBefore + 2);
    assert.equal(buttons(section(root)).filter((b) => b === copy.STATUS_INPUT.copied).length, 2);
    const another = mount();
    tick(field(another.root, 'statusInput.enabled'), true);
    assert.notEqual(another.page.config.statusInput.key, key, 'a new key each time');
    tick(field(root, 'statusInput.enabled'), false);
    tick(field(root, 'statusInput.enabled'), true);
    assert.equal(page.config.statusInput.key, key, 'ticking again keeps the key it has');
  });

  it('without a host name: the IP addresses, the reserve help, and the setup code with the first address; a new port shows at once', async () => {
    answers.set('/input/info', { hostname: null, addresses: ['192.168.4.10', '10.0.0.7'], port: 8582, id: ID });
    const key = 'k'.repeat(43);
    const { root } = mount({ platform: 'BusyLight', statusInput: { enabled: true, key } });
    await settle();
    assert.deepEqual(requests.map((r) => r.path), ['/input/info'], 'opening the page with the input on asks for the addresses');
    assert.deepEqual(addressLines(root), ['http://192.168.4.10:8582', 'http://10.0.0.7:8582']);
    assert.equal(text(section(root).querySelector('.bl-reserve-help')), copy.STATUS_INPUT.reserveHelp);
    buttonNamed(section(root).querySelector('.bl-input-key')!, copy.SHELL.show).click();
    assert.equal(codeLine(root), `busylight://192.168.4.10:8582/?key=${key}&id=${ID}`);
    fill(root, 'statusInput.port', '9000');
    await settle();
    assert.equal((lastBlock().statusInput as Record<string, unknown>).port, 9000);
  });

  it('Replace key asks first; Replace makes a new key and Cancel keeps the old one', async () => {
    answers.set('/input/info', INFO);
    const key = 'r'.repeat(43);
    const { root, page } = mount({ platform: 'BusyLight', statusInput: { enabled: true, key } });
    await settle();
    buttonNamed(section(root).querySelector('.bl-input-key')!, copy.SHELL.show).click();
    buttonNamed(section(root), copy.STATUS_INPUT.replaceKey).click();
    assert.equal(text(section(root).querySelector('.ns-confirm-question')), copy.STATUS_INPUT.replaceQuestion);
    buttonNamed(section(root), copy.STATUS_INPUT.cancel).click();
    assert.equal(page.config.statusInput.key, key);
    buttonNamed(section(root), copy.STATUS_INPUT.replaceKey).click();
    const replace = buttonNamed(section(root), copy.STATUS_INPUT.replace);
    assert.ok(replace.className.includes('btn-danger'));
    replace.click();
    await settle();
    assert.match(page.config.statusInput.key, KEY);
    assert.notEqual(page.config.statusInput.key, key);
    assert.equal(codeLine(root), `busylight://homebridge.local:8582/?key=${page.config.statusInput.key}&id=${ID}`, 'the setup code follows');
  });

  it('Test sends the port and key on the page and shows each result', async () => {
    answers.set('/input/info', INFO);
    const key = 't'.repeat(43);
    const { root } = mount({ platform: 'BusyLight', statusInput: { enabled: true, key, port: 9000 } });
    await settle();
    const result = (): string => text(section(root).querySelector('.bl-input-result'));
    assert.equal(text(section(root).querySelector('.bl-test-help')), copy.STATUS_INPUT.testHelp);
    for (const [answer, shown] of [
      [{ ok: true }, copy.STATUS_INPUT.received],
      [{ error: 'notListening', message: 'Nothing is listening on port 9000.' }, copy.STATUS_INPUT.notListening],
      [{ error: 'unauthorized', message: 'Missing or wrong key.' }, copy.STATUS_INPUT.unauthorized],
      [{ error: 'other', message: 'More than 60 requests in a minute from this address.' }, 'More than 60 requests in a minute from this address.'],
    ] as const) {
      answers.set('/input/test', answer);
      buttonNamed(section(root), copy.STATUS_INPUT.test).click();
      assert.ok(buttons(section(root)).includes(copy.STATUS_INPUT.testing), 'busy while it runs');
      await settle();
      assert.equal(result(), shown);
    }
    assert.deepEqual(requests.filter((r) => r.path === '/input/test').map((r) => r.payload).at(-1), { port: 9000, key });
  });

  it('the port, the hours and Allow the plain key; the state file\'s port error', async () => {
    answers.set('/version', { version: '0.1.0-beta.3' });
    answers.set('/status', state({ statusInput: { enabled: true, port: 8582, listening: false, error: 'port 8582 is already in use', id: ID } }));
    answers.set('/input/info', INFO);
    const { root, page } = mount({ platform: 'BusyLight', calendars: [ICLOUD_SOURCE], statusInput: { enabled: true, key: 'p'.repeat(43) } });
    page.startPolling();
    await settle();
    assert.equal(text(section(root).querySelector('.bl-input-error')), copy.STATUS_INPUT.portError(8582));
    const plain = field(root, 'statusInput.allowPlainKey');
    assert.equal(plain.checked, true, 'ticked by default');
    assert.equal(text(section(root).querySelector('[data-path="statusInput.allowPlainKey"] .ns-help')), copy.STATUS_INPUT.allowPlainKeyHelp);
    tick(plain, false);
    await settle();
    assert.equal((lastBlock().statusInput as Record<string, unknown>).allowPlainKey, false);
    const advanced = section(root).querySelector('.bl-input-advanced')!;
    assert.equal(text(advanced.querySelector('summary')), copy.SHELL.advanced);
    assert.equal(text(advanced.querySelector('.ns-help')), copy.STATUS_INPUT.portHelp(8582));
    fill(root, 'statusInput.port', '80');
    assert.equal(feedback(root, 'statusInput.port'), 'Enter a whole number from 1024 to 65535.');
    assert.deepEqual(root.querySelectorAll('.ns-issue-link').map((b) => text(b)), ['Status from other apps: Enter a whole number from 1024 to 65535.']);
    fill(root, 'statusInput.port', '8583');
    tick(field(root, 'callSwitch.enabled'), true);
    fill(root, 'callSwitch.hours', '13');
    assert.equal(feedback(root, 'callSwitch.hours'), 'Enter a whole number from 1 to 12.');
    assert.equal(text(root.querySelector('[data-path="callSwitch.hours"] label')), copy.STATUS_INPUT.callSwitchHours);
    fill(root, 'callSwitch.hours', '2');
    await settle();
    assert.deepEqual(lastBlock().callSwitch, { enabled: true, hours: 2 });
    assert.equal(text(root.querySelector('[data-path="callSwitch.enabled"] .ns-help')), copy.STATUS_INPUT.callSwitchHelp);
  });

  it('Apps reporting now: each sender\'s status, app, last heard, Active or Expired, and Signed or Plain key; the Home app has no auth badge', async () => {
    answers.set('/version', { version: '0.1.0-beta.3' });
    const now = dom.clock.now;
    const inputs = [
      { sender: 'CallWatch on Alex’s iMac', status: 'inCall', app: 'Microsoft Teams', via: 'api', auth: 'signed',
        lastHeard: new Date(now - 30_000).toISOString(), expiresAt: new Date(now + 150_000).toISOString(), active: true },
      { sender: 'Test on my laptop', status: 'busy', app: null, via: 'api', auth: 'plain', lastHeard: new Date(now - 5 * 60_000).toISOString(),
        expiresAt: new Date(now - 60_000).toISOString(), active: false },
      { sender: 'Home app', status: 'inCall', app: null, via: 'switch', auth: null, lastHeard: new Date(now - 2 * 3_600_000).toISOString(),
        expiresAt: null, active: true },
    ];
    answers.set('/status', state({ inputs }));
    const { root, page } = mount({ platform: 'BusyLight', calendars: [ICLOUD_SOURCE] });
    page.startPolling();
    await flush();
    const rows = section(root).querySelectorAll('.bl-sender-row').map((r) => [
      text(r.querySelector('.bl-sender-name')), text(r.querySelector('.bl-sender-status')), text(r.querySelector('.bl-sender-meta')),
      r.querySelectorAll('.badge').map((b) => `${text(b)} ${b.className.replace(/.*bl-badge-/, '')}`),
    ]);
    assert.deepEqual(rows, [
      ['CallWatch on Alex’s iMac', 'In a call from Microsoft Teams', 'Last heard just now', ['Active connected', 'Signed checking']],
      ['Test on my laptop', 'Busy', 'Last heard 5 minutes ago', ['Expired checking', 'Plain key warning']],
      ['Home app', 'In a call', 'Last heard 2 hours ago', ['Active connected']],
    ]);
    answers.set('/status', state({ inputs: [] }));
    const port = field(root, 'callSwitch.enabled');
    port.focus();
    await dom.clock.advance(15_000);
    await flush();
    assert.equal(text(section(root).querySelector('.bl-senders')), copy.STATUS_INPUT.noneReporting, 'redrawn in place at the next /status');
    assert.equal(dom.document.activeElement, port as unknown, 'without taking focus from the page');
  });

  it('the draft never holds the key; Restore puts the saved key back', async () => {
    answers.set('/input/info', INFO);
    const key = 's'.repeat(43);
    const saved = { platform: 'BusyLight', statusInput: { enabled: true, key } };
    const first = mount(saved);
    await settle();
    tick(field(first.root, 'statusInput.allowPlainKey'), false);
    const draft = JSON.parse(dom.storage.getItem('homebridge-busy-light:draft')!) as { config: Record<string, Record<string, unknown>> };
    assert.equal(draft.config.statusInput.key, '', 'no key in the draft');
    assert.ok(!JSON.stringify(draft).includes(key));
    for (const node of dom.document.body.children) {
      node.remove();
    }
    const second = mount(saved);
    buttonNamed(second.root, copy.SHELL.restore).click();
    assert.equal(second.page.config.statusInput.key, key, 'the saved key is put back');
    assert.equal(second.page.config.statusInput.allowPlainKey, false);
  });

  it('Right now names the sender and its app, and shows the status with no calendars when the input is on', async () => {
    const node = await rightNow(state({ status: 'inCall', reason: { source: 'CallWatch on Alex’s iMac', until: null, app: 'Microsoft Teams' } }),
      { platform: 'BusyLight', statusInput: { enabled: true, key: 'n'.repeat(43) } });
    assert.equal(text(node.querySelector('.bl-now-name')), 'In a call');
    assert.equal(text(node.querySelector('.bl-now-line')), copy.RIGHT_NOW.fromApp('CallWatch on Alex’s iMac', 'Microsoft Teams'));
  });
});

describe('settings page: the intervals as durations (SPEC 11.3 C, F and G; 15 item 24)', () => {
  const options = (select: FakeElement): string[] => select.querySelectorAll('option').map((o) => text(o));
  const SOURCES = [
    ICLOUD_SOURCE,
    { type: 'google', id: 'g', name: 'G', url: 'https://calendar.example.com/x.ics' },
    { type: 'url', id: 'u', name: 'U', url: 'https://rota.example.net/a.ics', calendarSeconds: 600 },
    { type: 'microsoft', id: 'm', name: 'M', tenantId: '11111111-2222-3333-4444-555555555555', clientId: '66666666-7777-8888-9999-000000000000' },
  ];

  it('every card type has Check for changes every under Advanced: Same as Settings first, then the five durations', () => {
    const { root, page } = mount({ platform: 'BusyLight', calendars: SOURCES });
    for (const id of ['icloud', 'g', 'u', 'm']) {
      const card = openCard(root, id);
      const advanced = card.querySelector('.bl-source-advanced')!;
      assert.equal(text(advanced.querySelector('summary')), copy.SHELL.advanced, id);
      const select = field(root, `calendars.${id}.calendarSeconds`);
      assert.equal(select.tagName, 'SELECT');
      assert.ok(select.className.includes('form-select'), 'styled as Counts for');
      assert.equal(text(card.querySelector(`[data-path="calendars.${id}.calendarSeconds"] label`)), copy.CALENDARS.checkEvery);
      assert.equal(text(card.querySelector(`[data-path="calendars.${id}.calendarSeconds"] .ns-help`)), copy.CALENDARS.checkEveryHelp);
      assert.equal(card.querySelector(`[data-path="calendars.${id}.calendarSeconds"] input`), null, 'no number field');
      assert.deepEqual(options(select), ['Same as Settings (3 minutes)', '1 minute', '2 minutes', '3 minutes', '5 minutes', '10 minutes']);
      assert.equal(select.value, id === 'u' ? '600' : '');
      assert.equal(advanced.open, id === 'u', 'open when it holds a value');
    }
    assert.deepEqual(page.issues(), []);
  });

  it('each option saves its seconds, and Same as Settings saves none', async () => {
    const { root } = mount({ platform: 'BusyLight', calendars: SOURCES });
    openCard(root, 'g');
    for (const [value, seconds] of [['60', 60], ['120', 120], ['180', 180], ['300', 300], ['600', 600], ['', undefined]] as const) {
      choose(field(root, 'calendars.g.calendarSeconds'), value);
      await settle();
      assert.equal((lastBlock().calendars as Array<Record<string, unknown>>)[1].calendarSeconds, seconds, value || 'Same as Settings');
      assert.ok(!('calendarSeconds' in (lastBlock().calendars as Array<Record<string, unknown>>)[1]) || seconds !== undefined);
    }
  });

  it('Same as Settings follows Reload calendars every as it is edited, in place', () => {
    const { root } = mount({ platform: 'BusyLight', calendars: SOURCES });
    openCard(root, 'g');
    const card = (): FakeElement => field(root, 'calendars.g.calendarSeconds');
    choose(field(root, 'calendarSeconds'), '600');
    assert.equal(options(card())[0], 'Same as Settings (10 minutes)');
    choose(field(root, 'calendarSeconds'), '60');
    assert.equal(options(card())[0], 'Same as Settings (1 minute)');
    assert.equal(card().value, '', 'the card keeps its choice');
  });

  it('Settings: Check status every and Reload calendars every, with the SPEC 8 defaults marked, each option saving its seconds', async () => {
    const { root } = mount();
    const poll = field(root, 'pollSeconds');
    const reload = field(root, 'calendarSeconds');
    assert.equal(poll.tagName, 'SELECT');
    assert.deepEqual(options(poll), ['15 seconds', '30 seconds (default)', '1 minute', '2 minutes', '4 minutes']);
    assert.deepEqual(options(reload), ['1 minute', '2 minutes', '3 minutes (default)', '5 minutes', '10 minutes']);
    assert.deepEqual([poll.value, reload.value], ['30', '180']);
    for (const [value, seconds] of [['15', 15], ['30', 30], ['60', 60], ['120', 120], ['240', 240]] as const) {
      choose(field(root, 'pollSeconds'), value);
      await settle();
      assert.equal(lastBlock().pollSeconds, seconds);
    }
    for (const [value, seconds] of [['60', 60], ['120', 120], ['180', 180], ['300', 300], ['600', 600]] as const) {
      choose(field(root, 'calendarSeconds'), value);
      await settle();
      assert.equal(lastBlock().calendarSeconds, seconds);
    }
  });

  it('a saved 90 shows as 1 minute 30 seconds, selected, is kept on Save, and stays listed until another value is saved', async () => {
    const { root, page } = mount({ platform: 'BusyLight', pollSeconds: 90, calendarSeconds: 90, calendars: [
      { type: 'url', id: 'u', name: 'U', url: 'https://rota.example.net/a.ics', calendarSeconds: 90 },
    ] });
    openCard(root, 'u');
    const card = field(root, 'calendars.u.calendarSeconds');
    assert.deepEqual(options(card), [
      'Same as Settings (1 minute 30 seconds)', '1 minute', '1 minute 30 seconds', '2 minutes', '3 minutes', '5 minutes', '10 minutes',
    ]);
    assert.equal(card.value, '90');
    assert.deepEqual(options(field(root, 'pollSeconds')), ['15 seconds', '30 seconds (default)', '1 minute', '1 minute 30 seconds', '2 minutes', '4 minutes']);
    assert.equal(field(root, 'pollSeconds').value, '90');
    assert.equal(field(root, 'calendarSeconds').value, '90');
    fill(root, 'name', 'Busy Light');
    await settle();
    const block = lastBlock();
    assert.deepEqual([block.pollSeconds, block.calendarSeconds, (block.calendars as Array<Record<string, unknown>>)[0].calendarSeconds], [90, 90, 90], 'kept');
    choose(field(root, 'pollSeconds'), '60');
    page.rerender('settings');
    assert.ok(options(field(root, 'pollSeconds')).includes('1 minute 30 seconds'), 'still listed until saved');
    const saved = mount({ platform: 'BusyLight', pollSeconds: 60 });
    assert.ok(!options(field(saved.root, 'pollSeconds')).includes('1 minute 30 seconds'), 'gone once another value is saved');
  });
});

describe('settings page: the bulb in use when the page opens (SPEC 11.3 E)', () => {
  const linesOf = (root: FakeElement): string[] => root.querySelectorAll('#section-lights .bl-lifx-results .bl-lifx-line').map((l) => text(l));

  async function open(light: unknown): Promise<FakeElement> {
    answers.set('/version', { version: '0.1.0-beta.3' });
    answers.set('/status', light === undefined ? { status: null } : state({ light }));
    const { root, page } = mount({ platform: 'BusyLight', calendars: [ICLOUD_SOURCE], lifx: { enabled: true } });
    assert.deepEqual(linesOf(root), [], 'nothing until /status answers');
    page.startPolling();
    await flush();
    assert.equal(requests.some((r) => r.path === '/lifx/discover'), false, 'no search on open');
    return root;
  }

  it('answered: the bulb by name and address', async () => {
    const root = await open({ enabled: true, label: 'Floor', host: '192.168.4.50', found: 'discovered', answered: true });
    assert.deepEqual(linesOf(root), [copy.LIGHTS.usingBulb('Floor', '192.168.4.50')]);
    assert.ok(buttons(root.querySelector('#section-lights')).includes(copy.LIGHTS.searchAgain), 'Search again stays below');
  });

  it('not answered last time', async () => {
    const root = await open({ enabled: true, label: 'Floor', host: '192.168.4.50', found: 'remembered', answered: false });
    assert.deepEqual(linesOf(root), [copy.LIGHTS.usingBulbSilent('Floor', '192.168.4.50')]);
  });

  it('no bulb in the state file, or no state file', async () => {
    let root = await open({ enabled: true, label: null, host: null, found: null, answered: null });
    assert.deepEqual(linesOf(root), [copy.LIGHTS.noBulbYet]);
    for (const node of dom.document.body.children) {
      node.remove();
    }
    requests.length = 0;
    root = await open(undefined);
    assert.deepEqual(linesOf(root), [copy.LIGHTS.noBulbYet]);
  });
});

// SPEC 18.11 item 6, 15 item 23: the address change notice on the page.

describe('settings page: the address change notice (SPEC 18.11 item 6)', () => {
  const ID = 'q3Lr8vT0cXw2mN5a';
  const section = (root: FakeElement): FakeElement => root.querySelector('#section-statusInput')!;

  it('shows above the Address line while /input/info reports a change, in the warning tone', async () => {
    const addressChange = { from: '192.168.4.10', to: '192.168.4.23' };
    answers.set('/input/info', { hostname: null, addresses: ['192.168.4.23'], port: 8582, id: ID, addressChange });
    const { root } = mount({ platform: 'BusyLight', statusInput: { enabled: true, key: 'a'.repeat(43) } });
    await settle();
    const notice = section(root).querySelector('.bl-address-change')!;
    assert.equal(text(notice), copy.STATUS_INPUT.addressChanged('192.168.4.10', '192.168.4.23'));
    assert.equal(text(notice), 'Homebridge\'s address changed from 192.168.4.10 to 192.168.4.23. Apps that use the old address need the new setup code.');
    assert.ok(notice.querySelector('.alert-warning'), 'the warning tone');
    const order = section(root).querySelectorAll('.bl-address-change, .bl-input-addresses').map((n) => n.className.split(' ').find((c) => c.startsWith('bl-')));
    assert.deepEqual(order, ['bl-address-change', 'bl-input-addresses'], 'above the Address line');
  });

  it('is absent with no change, or once the page has been saved since (/input/info reports none)', async () => {
    answers.set('/input/info', { hostname: 'homebridge.local', addresses: ['192.168.4.10'], port: 8582, id: ID, addressChange: null });
    const { root } = mount({ platform: 'BusyLight', statusInput: { enabled: true, key: 'b'.repeat(43) } });
    await settle();
    assert.equal(section(root).querySelector('.bl-address-change'), null);
  });
});

// SPEC 11.3 I (build 3.1), 15 item 24: the setup code is masked like the key and shares its Show and Hide.

describe('settings page: the masked setup code (SPEC 11.3 I)', () => {
  const ID = 'q3Lr8vT0cXw2mN5a';
  const KEY = 'm'.repeat(43);
  const CODE = `busylight://homebridge.local:8582/?key=${KEY}&id=${ID}`;
  const section = (root: FakeElement): FakeElement => root.querySelector('#section-statusInput')!;
  const codeLine = (root: FakeElement): string => text(section(root).querySelector('.bl-setup-code .bl-readonly-line'));
  const keyInput = (root: FakeElement): FakeElement => section(root).querySelector('.bl-input-key input')!;
  const toggle = (root: FakeElement): FakeElement => section(root).querySelector('.bl-input-key .input-group button')!;

  async function open(): Promise<FakeElement> {
    answers.set('/input/info', { hostname: 'homebridge.local', addresses: ['192.168.4.10'], port: 8582, id: ID, addressChange: null });
    const { root } = mount({ platform: 'BusyLight', statusInput: { enabled: true, key: KEY } });
    await settle();
    return root;
  }

  it('is masked when the section opens, one dot per character, with no part of the key', async () => {
    const root = await open();
    assert.equal(keyInput(root).getAttribute('type'), 'password');
    assert.equal(codeLine(root), '\u2022'.repeat(CODE.length));
    assert.ok(!text(section(root)).includes(KEY), 'the key is nowhere in the text of the section');
    assert.equal(text(toggle(root)), copy.SHELL.show);
  });

  it('one Show reveals both, one Hide masks both', async () => {
    const root = await open();
    toggle(root).click();
    assert.equal(keyInput(root).getAttribute('type'), 'text');
    assert.equal(codeLine(root), CODE);
    assert.equal(text(toggle(root)), copy.SHELL.hide);
    assert.equal(section(root).querySelectorAll('button').filter((b) => text(b) === copy.SHELL.show || text(b) === copy.SHELL.hide).length, 1,
      'one toggle for both');
    toggle(root).click();
    assert.equal(keyInput(root).getAttribute('type'), 'password');
    assert.equal(codeLine(root), '\u2022'.repeat(CODE.length));
    assert.equal(text(toggle(root)), copy.SHELL.show);
  });

  it('Copy setup code copies the full code, masked or not', async () => {
    const root = await open();
    buttonNamed(section(root), copy.STATUS_INPUT.copySetupCode).click();
    await flush();
    assert.equal(dom.document.copied.at(-1), CODE, 'masked');
    toggle(root).click();
    buttonNamed(section(root), copy.STATUS_INPUT.copied).click();
    await flush();
    assert.equal(dom.document.copied.at(-1), CODE, 'shown');
  });

  it('a redraw of the section keeps them shown or masked together', async () => {
    const root = await open();
    toggle(root).click();
    answers.set('/input/test', { ok: true });
    buttonNamed(section(root), copy.STATUS_INPUT.test).click();
    await settle();
    assert.equal(text(section(root).querySelector('.bl-input-result')), copy.STATUS_INPUT.received, 'redrawn with the result');
    assert.equal(keyInput(root).getAttribute('type'), 'text');
    assert.equal(codeLine(root), CODE);
  });
});

// SPEC 11.3 E (build 3.1), 15 item 24: the sensors the setup cannot produce come last, can still be ticked, and follow live.

describe('settings page: the per-status sensors and the statuses the setup can produce (SPEC 11.3 E)', () => {
  const sensors = (root: FakeElement): Array<[string, string]> => root.querySelectorAll('#section-lights details.bl-all-sensors .form-check')
    .map((c) => [text(c.querySelector('.form-check-label')), text(c.querySelector('.form-text'))]);

  it('with the status input on, every status can happen: section 7 order, no help', () => {
    const { root } = mount({ platform: 'BusyLight', statusInput: { enabled: true, key: 'c'.repeat(43) } });
    assert.deepEqual(sensors(root), [['Busy Light In a Meeting', ''], ['Busy Light In a Call', ''], ['Busy Light Do Not Disturb', ''],
      ['Busy Light Busy in Teams', ''], ['Busy Light Tentative', ''], ['Busy Light Away', ''], ['Busy Light Offline', '']]);
  });

  it('the On a Call switch moves In a Call up, live; a status that cannot happen can still be ticked', async () => {
    const { root } = mount();
    tick(field(root, 'callSwitch.enabled'), true);
    assert.deepEqual(sensors(root).slice(0, 3).map(([name, help]) => [name, help]),
      [['Busy Light In a Meeting', ''], ['Busy Light In a Call', ''], ['Busy Light Tentative', '']]);
    assert.equal(sensors(root)[3][1], copy.LIGHTS.nothingReports);
    const offline = root.querySelectorAll('#section-lights details.bl-all-sensors .form-check')
      .find((c) => text(c.querySelector('.form-check-label')) === 'Busy Light Offline')!;
    tick(offline.querySelector('input')!, true);
    await settle();
    assert.ok((lastBlock().sensors as string[]).includes('offline'));
  });
});
