/**
 * The headless layout check of the settings page (SPEC 15 item 15; homebridge-notify-switch SPEC 11.2 item 18): the
 * built page rendered the way the Homebridge UI shows it (in an iframe sized to its content, with the host's body
 * classes, its stylesheet loaded after the page's and its `body { height: unset }` rule, and no `data-bs-theme`), in
 * the host's light and dark themes at 800 and 390 pixels, with every card, the chooser, the disclosures, the Reset
 * dialog and the summary box open, and the Status from other apps section on with its Replace key question, a test
 * result and a sender of each kind listed (SPEC 15 item 19). It checks that secondary text and locked fields keep 4.5:1 contrast, that nothing
 * is wider than the frame, and that the frame itself never scrolls.
 *
 * It needs Playwright with Chromium and the Homebridge UI's own stylesheet, which are not dependencies of the plugin:
 *   HOMEBRIDGE_UI_CSS=/path/to/homebridge-config-ui-x/public/styles-*.css npm run test:layout
 * Playwright is taken from this project, else from the global npm folder. Nothing is fetched from the network: the
 * page talks to a stand-in for the Homebridge UI with synthetic answers.
 */
// Node's globals for the runner, and the browser's for the functions that run in the page:
/* global process, console, URL, window, document, getComputedStyle */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pub = path.join(root, 'homebridge-ui', 'public');

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    const global = execSync('npm root -g').toString().trim();
    return import(pathToFileURL(path.join(global, 'playwright', 'index.mjs')).href);
  }
}

function hostCss() {
  const given = process.env.HOMEBRIDGE_UI_CSS;
  if (given && fs.existsSync(given)) {
    return given;
  }
  for (const base of [path.join(root, 'node_modules'), execSync('npm root -g').toString().trim()]) {
    const dir = path.join(base, 'homebridge-config-ui-x', 'public');
    const css = fs.existsSync(dir) ? fs.readdirSync(dir).find((f) => /^styles.*\.css$/.test(f)) : undefined;
    if (css) {
      return path.join(dir, css);
    }
  }
  throw new Error('Set HOMEBRIDGE_UI_CSS to the Homebridge UI stylesheet (homebridge-config-ui-x/public/styles-*.css).');
}

/** A synthetic configuration: one card of each type, the build 1 name-only iCloud list, LIFX on, the status input on. */
const CONFIG = {
  platform: 'BusyLight',
  name: 'Busy Light',
  calendars: [
    { type: 'icloud', name: 'iCloud', appleId: 'person@example.com', appPassword: 'synthetic-app-password', calendars: ['Alex'] },
    { type: 'google', id: 'cal-google', name: 'Personal', url: 'https://calendar.example.com/ical/synthetic/basic.ics', email: 'person@example.com',
      use: 'all' },
    { type: 'microsoft', id: 'cal-work', name: 'Work', tenantId: '11111111-2222-3333-4444-555555555555',
      clientId: '66666666-7777-8888-9999-000000000000', useTeamsStatus: true, useCalendar: true },
    { type: 'url', id: 'cal-rota', name: 'Team rota', url: 'https://rota.example.net/synthetic.ics', use: 'outOfOffice', calendarSeconds: 600 },
  ],
  statusInput: { enabled: true, key: 'Synthetic-layout-key-0000000000000000000000', allowPlainKey: true },
  callSwitch: { enabled: true, hours: 3 },
  colors: { busy: '#1A2B3C' },
  lifx: { enabled: true },
  sensors: ['available', 'busyAny', 'outOfOffice'],
};

const NOW = Date.now();
const ANSWERS = {
  '/version': { version: '0.1.0-beta.3' },
  '/status': {
    version: 1, updatedAt: new Date(NOW - 20_000).toISOString(), status: 'inMeeting',
    reason: { source: 'Work', until: new Date(NOW + 1_800_000).toISOString() }, override: false, signIn: null,
    sources: [
      { id: 'icloud', name: 'iCloud', type: 'icloud', state: 'connected', lastChecked: new Date(NOW - 60_000).toISOString(), events: 4, error: null },
      { id: 'cal-google', name: 'Personal', type: 'google', state: 'notReachable', lastChecked: new Date(NOW - 120_000).toISOString(), events: 0,
        error: 'calendar.example.com answered HTTP 404' },
      { id: 'cal-work', name: 'Work', type: 'microsoft', state: 'signInNeeded', lastChecked: null, events: null, error: 'waiting for sign-in' },
    ],
    light: { enabled: true, label: 'Floor', host: '192.168.4.50', found: 'discovered', lastSent: '#FF0000', lastSentAt: null, answered: true },
    statusInput: { enabled: true, port: 8582, listening: true, error: null, id: 'q3Lr8vT0cXw2mN5a' },
    inputs: [
      { sender: 'CallWatch on Alex’s iMac', status: 'inCall', app: 'Microsoft Teams', via: 'api', auth: 'signed',
        lastHeard: new Date(NOW - 30_000).toISOString(), expiresAt: new Date(NOW + 150_000).toISOString(), active: true },
      { sender: 'Test on my laptop with a rather long name for a sender', status: 'busy', app: null, via: 'api', auth: 'plain',
        lastHeard: new Date(NOW - 300_000).toISOString(), expiresAt: new Date(NOW - 60_000).toISOString(), active: false },
      { sender: 'Home app', status: 'inCall', app: null, via: 'switch', auth: null, lastHeard: new Date(NOW - 600_000).toISOString(),
        expiresAt: null, active: true },
    ],
  },
  '/input/info': { hostname: null, addresses: ['192.168.4.10', 'fd00:1234:5678:9abc::10'], port: 8582, id: 'q3Lr8vT0cXw2mN5a' },
  '/input/test': { error: 'notListening', message: 'Nothing is listening on port 8582.' },
  '/icloud/calendars': { calendars: [
    { id: '/123456789/calendars/home/', name: 'Alex', shared: false, subscribed: false, eventsToday: 3 },
    { id: '/123456789/calendars/family-1/', name: 'Family', shared: true, subscribed: false, eventsToday: 1 },
    { id: '/123456789/calendars/holidays/', name: 'Holidays in a country with a very long name', shared: false, subscribed: true, eventsToday: null },
  ] },
  '/microsoft/start': { verificationUri: 'https://microsoft.com/devicelogin', userCode: 'SYNTH123', expiresAt: new Date(NOW + 900_000).toISOString() },
  '/microsoft/poll': { state: 'waiting' },
  '/microsoft/cancel': { ok: true },
  '/url/test': { error: 'http', host: 'calendar.example.com', code: 404 },
  '/lifx/discover': { bulbs: [
    { label: 'Floor', serial: 'd073d5000001', ip: '192.168.4.50' },
    { label: 'Desk', serial: 'd073d5000002', ip: '192.168.4.51' },
  ] },
  '/lifx/test': { answered: false },
};

/** The stand-in for the Homebridge UI's `window.homebridge` inside the iframe. */
function mockHost({ config, answers }) {
  const pushed = [];
  window.__pushed = pushed;
  window.homebridge = {
    request: async (p) => JSON.parse(JSON.stringify(answers[p] ?? {})),
    getPluginConfig: async () => [JSON.parse(JSON.stringify(config))],
    updatePluginConfig: async (blocks) => {
      pushed.push(blocks);
      return blocks;
    },
    toast: { error: () => undefined, success: () => undefined },
    enableSaveButton: () => {
      window.__save = true;
    },
    disableSaveButton: () => {
      window.__save = false;
    },
    showSpinner: () => undefined,
    hideSpinner: () => undefined,
  };
}

function serve(css) {
  const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png' };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let file;
    if (url.pathname === '/host.css') {
      file = css;
    } else if (url.pathname === '/') {
      const theme = url.searchParams.get('theme');
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(`<!doctype html><html><head></head><body style="margin:0">
        <iframe id="bl-frame" src="/plugin/index.html?theme=${theme}" style="display:block;width:100%;border:0;height:200px"></iframe></body></html>`);
      return;
    } else {
      file = path.join(pub, url.pathname.replace(/^\/plugin\//, ''));
    }
    if (!file.startsWith(pub) && file !== css) {
      res.writeHead(404);
      res.end();
      return;
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

/** Runs inside the frame: what the host does on `ready` (body classes, its stylesheet after the page's, height unset). */
function themeFrame(theme) {
  for (const cls of theme.split(' ')) {
    document.body.classList.add(cls);
  }
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/host.css';
  document.head.appendChild(link);
  const style = document.createElement('style');
  style.textContent = 'body { height: unset !important; }';
  document.head.appendChild(style);
  return new Promise((resolve) => {
    link.onload = resolve;
    link.onerror = resolve;
  });
}

/** Runs inside the frame: every check, returning the problems found. */
function measure() {
  const problems = [];
  const parse = (c) => {
    const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/.exec(c);
    return m ? [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])] : [0, 0, 0, 0];
  };
  const over = (top, under) => [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3])).concat(1);
  const background = (node) => {
    const layers = [];
    for (let n = node; n; n = n.parentElement) {
      const bg = parse(getComputedStyle(n).backgroundColor);
      if (bg[3] > 0) {
        layers.push(bg);
        if (bg[3] === 1) {
          break;
        }
      }
    }
    let color = [255, 255, 255, 1];
    for (const layer of layers.reverse()) {
      color = over(layer, color);
    }
    return color;
  };
  const lum = (c) => {
    const ch = c.slice(0, 3).map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  };
  const ratio = (a, b) => {
    const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (l1 + 0.05) / (l2 + 0.05);
  };
  const visible = (n) => {
    const r = n.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(n).visibility !== 'hidden';
  };
  const contrast = (n, what) => {
    const bg = background(n);
    const fg = over(parse(getComputedStyle(n).color), bg);
    const r = ratio(fg, bg);
    if (r < 4.5) {
      problems.push(`${what} "${(n.textContent || n.value || '').trim().slice(0, 40)}": contrast ${r.toFixed(2)}`);
    }
    return bg;
  };
  const secondary = '.form-text, summary, .ns-card-meta, .bl-cal-meta, .bl-empty, .ns-secondary, .ns-footer, .bl-affiliation, .bl-now-line, '
    + '.btn:disabled, .bl-badge-muted, .bl-badge-checking, .ns-type-badge, .bl-card-error, .alert, .bl-code-waiting, .ns-issue-link, .form-label, '
    + '.form-check-label, .bl-preset-label, .bl-badge-warning, .bl-readonly-line';
  const seen = [];
  for (const n of document.querySelectorAll(secondary)) {
    if (visible(n) && (n.textContent || '').trim()) {
      contrast(n, n.className.split(' ')[0] || n.tagName.toLowerCase());
      seen.push(n.className);
    }
  }
  const dark = document.body.classList.contains('dark-mode');
  for (const n of document.querySelectorAll('input:disabled, select:disabled, textarea:disabled, input[readonly], .bl-readonly')) {
    if (!visible(n) || n.type === 'checkbox' || n.type === 'radio' || n.type === 'color') {
      continue;
    }
    const bg = contrast(n, 'locked field');
    if (dark && lum(bg) > 0.2) {
      problems.push(`locked field "${(n.value ?? n.textContent).trim().slice(0, 40)}": light background in dark mode`);
    }
  }
  const width = document.documentElement.clientWidth;
  for (const n of document.body.querySelectorAll('*')) {
    const r = n.getBoundingClientRect();
    if (r.width > 0 && (r.right > width + 0.5 || r.left < -0.5) && !n.closest('.ns-clipboard')) {
      problems.push(`wider than the frame: ${n.tagName.toLowerCase()}.${n.className} (${Math.round(r.left)} to ${Math.round(r.right)} of ${width})`);
    }
  }
  if (document.documentElement.scrollWidth > width) {
    problems.push(`horizontal scroll: ${document.documentElement.scrollWidth} > ${width}`);
  }
  for (const n of [document.documentElement, document.body]) {
    if (getComputedStyle(n).overflowY !== 'hidden') {
      problems.push(`${n.tagName.toLowerCase()} can scroll (overflow-y ${getComputedStyle(n).overflowY})`);
    }
  }
  window.scrollTo(0, 500);
  if (document.scrollingElement.scrollTop !== 0) {
    problems.push('the frame scrolled');
  }
  return { problems, checked: seen.length };
}

async function run() {
  const { chromium } = await loadPlaywright();
  const css = hostCss();
  const server = await serve(css);
  const port = server.address().port;
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  let failed = 0;
  try {
    for (const [themeName, theme] of [['light', 'config-ui-x-orange modal-content'], ['dark', 'config-ui-x-dark-mode-orange modal-content dark-mode']]) {
      for (const width of [800, 390]) {
        const context = await browser.newContext({ viewport: { width, height: 900 } });
        await context.addInitScript(mockHost, { config: CONFIG, answers: ANSWERS });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        await page.goto(`http://127.0.0.1:${port}/?theme=${encodeURIComponent(theme)}`);
        const frame = page.frame({ url: /plugin\/index.html/ });
        await frame.waitForSelector('#section-calendars .ns-card');
        await frame.evaluate(themeFrame, theme);
        const fit = async () => {
          const h = await frame.evaluate(() => document.body.scrollHeight);
          await page.evaluate((v) => {
            document.getElementById('bl-frame').style.height = `${v + 10}px`;
          }, h);
        };
        await fit();
        const click = async (selector) => {
          const target = frame.locator(selector).first();
          await target.scrollIntoViewIfNeeded();
          await target.click();
          await fit();
        };
        // Open every card, list the iCloud calendars, test the Google address, show the Microsoft code, search for bulbs.
        for (const id of ['icloud', 'cal-google', 'cal-work', 'cal-rota']) {
          await click(`[data-card-id="${id}"] .ns-card-toggle`);
        }
        await click('[data-card-id="icloud"] .ns-footer-right button');
        await frame.waitForSelector('[data-card-id="icloud"] .bl-cal-row:nth-child(3)');
        await click('[data-card-id="cal-google"] .ns-footer-right button');
        await click('#section-lights .bl-search-again');
        await frame.waitForSelector('#section-lights input[type="radio"]');
        await click('#section-lights .bl-lifx-card details summary');
        await click('#section-lights details.bl-all-sensors summary');
        // The status input: the port under Advanced, Replace key's question, a test result; a calendar card's own interval.
        await frame.waitForSelector('#section-statusInput .bl-input-addresses .bl-readonly-line');
        await click('#section-statusInput .bl-input-advanced summary');
        await click('#section-statusInput .bl-replace-key');
        await click('#section-statusInput .bl-input-test');
        await frame.waitForSelector('#section-statusInput .bl-input-result');
        await click('[data-card-id="cal-google"] .bl-source-advanced summary');
        // Colors: Off on one row and Custom on another, with Busy already a custom color.
        await click('#section-colors [data-path="colors.inMeeting"] button.bl-preset-off');
        await click('#section-colors [data-path="colors.outOfOffice"] button.bl-preset-custom');
        await click('#section-calendars .ns-section-add');
        await click('#section-settings details summary');
        const poll = frame.locator('[data-path="pollSeconds"] input');
        await poll.click();
        await poll.fill('5');
        await click('[data-path="name"] input');
        await click('#section-settings .ns-danger-link');
        await click('[data-card-id="cal-work"] .ns-footer-right button');
        await frame.waitForSelector('.bl-code-view');
        await fit();
        const { problems, checked } = await frame.evaluate(measure);
        problems.push(...errors.map((e) => `page error: ${e}`));
        const label = `${themeName} ${width}px`;
        if (problems.length) {
          failed += problems.length;
          console.log(`not ok ${label}: ${checked} elements checked`);
          for (const p of problems) {
            console.log(`  ${p}`);
          }
        } else {
          console.log(`ok ${label}: ${checked} elements checked, nothing wider than the frame, the frame does not scroll`);
        }
        if (process.env.LAYOUT_SCREENSHOTS) {
          await page.screenshot({ path: path.join(process.env.LAYOUT_SCREENSHOTS, `${themeName}-${width}.png`), fullPage: true });
        }
        await context.close();
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
  process.exitCode = failed ? 1 : 0;
}

run().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
