/**
 * The status API of SPEC section 18 (SPEC 15 item 16), by calling the request handler directly with synthetic
 * request and response objects. No test opens a socket: the server's start and port-in-use paths run with
 * `http.createServer` replaced.
 */
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { parseConfig } from '../src/config.js';
import { BusyLightEngine } from '../src/engine.js';
import { ensureStorageDir } from '../src/files.js';
import { inputsFile } from '../src/inputs.js';
import { LifxClient } from '../src/lifx.js';
import {
  ERROR_MESSAGES, StatusApi, StatusInputServer, checkText, ensureInstanceId, isLocalAddress, isReservedSender, parseAuthorization, readInstanceId,
  sha256Hex, signature, signedAuthorization, stringToSign,
} from '../src/status-api.js';
import type { ApiRequest, ErrorKey, ServerLike } from '../src/status-api.js';
import { FakeClock, FakeNetwork, fakeLog, settle, tmpDir } from './helpers.js';

/** The key of the test vector in docs/status-input.md 2.4: synthetic, and public by design. */
const KEY = 'Synthetic-test-key-0000-do-not-use-anywhere';
const VECTOR_TS = 1791547380000;
const VECTOR_BODY = '{"sender":"CallWatch on Alex’s iMac","status":"inCall","app":"Microsoft Teams"}';
const VECTOR_SIG = '27e0b09262e123c86c9d6ac1b749c7e11e89ac581d18f693c35eb17f6f468291';
const MAC = 'CallWatch on Alex’s iMac';
const HOME = '192.168.4.20';
const ID = 'q3Lr8vT0cXw2mN5a';

let dir: string;
let clock: FakeClock;
let log: ReturnType<typeof fakeLog>;
let engine: BusyLightEngine | null;
let compared: number;
const seenErrors = new Set<string>();
const allResponses: string[] = [];

beforeEach(() => {
  dir = ensureStorageDir(tmpDir('busy-light-api'));
  clock = new FakeClock(VECTOR_TS);
  log = fakeLog();
  engine = null;
  compared = 0;
});
afterEach(() => {
  engine?.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

interface Answer {
  status: number;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

function setup(input: Record<string, unknown> = {}, raw: Record<string, unknown> = {}, fresh = false): StatusApi {
  if (!fresh) {
    // A readable inputs.json, so the startup floor (SPEC 18.7 item 7) is not in play unless a test wants it.
    fs.writeFileSync(inputsFile(dir), JSON.stringify({ version: 1, senders: [], replay: [] }));
  }
  const { config, issues } = parseConfig({ platform: 'BusyLight', statusInput: { enabled: true, key: KEY, ...input }, ...raw });
  assert.deepEqual(issues, []);
  engine = new BusyLightEngine({
    config, storageDir: dir, log: log.log, version: '0.1.0-beta.3', clock,
    lifx: new LifxClient({ socket: new FakeNetwork().factory, timings: { replyMs: 40, collectMs: 100 }, interfaces: () => ({}) }),
  });
  engine.start();
  return new StatusApi({
    config: config.statusInput, engine, log: log.log, version: '0.1.0-beta.3', id: ID, now: clock.now,
    equal: (a, b) => {
      compared++;
      return crypto.timingSafeEqual(a, b);
    },
  });
}

function request(method: string, url: string, body: string | Buffer = '', headers: Record<string, string> = {}, ip = HOME): ApiRequest {
  const chunks = typeof body === 'string' ? (body ? [Buffer.from(body, 'utf8')] : []) : [body];
  return Object.assign(Readable.from(chunks), {
    method, url, headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])), socket: { remoteAddress: ip },
  }) as unknown as ApiRequest;
}

async function send(api: StatusApi, method: string, url: string, body: string | Buffer = '', headers: Record<string, string> = {}, ip = HOME): Promise<Answer> {
  let status = 0;
  let head: Record<string, string> = {};
  let text = '';
  await api.handle(request(method, url, body, headers, ip), {
    writeHead: (s, h) => {
      status = s;
      head = h;
    },
    end: (b) => {
      text = b ?? '';
    },
  });
  allResponses.push(text, JSON.stringify(head));
  const parsed = JSON.parse(text) as Record<string, unknown>;
  if (typeof parsed.error === 'string') {
    seenErrors.add(parsed.error);
  }
  return { status, headers: head, body: parsed };
}

const json = { 'Content-Type': 'application/json' };
const body = (fields: Record<string, unknown>) => JSON.stringify(fields);

/** A signed POST /v1/status with the given ts (default: Busy Light's clock). */
function signedPost(api: StatusApi, fields: Record<string, unknown>, ts = clock.now(), ip = HOME): Promise<Answer> {
  const b = body(fields);
  return send(api, 'POST', '/v1/status', b, { ...json, Authorization: signedAuthorization(KEY, 'POST', '/v1/status', ts, b) }, ip);
}

function signedGet(api: StatusApi, ts = clock.now()): Promise<Answer> {
  return send(api, 'GET', '/v1/status', '', { Authorization: signedAuthorization(KEY, 'GET', '/v1/status', ts, '') });
}

/** The status input's own warning lines (the engine also warns that no calendars are set up). */
const inputWarnings = () => log.lines('warn').filter((l) => l.startsWith('Status input'));

const plain = (key = KEY) => ({ ...json, Authorization: `Bearer ${key}` });

test('the signing test vector of docs/status-input.md 2.4 is normative', () => {
  assert.equal(Buffer.byteLength(VECTOR_BODY), 81);
  assert.equal(sha256Hex(Buffer.from(VECTOR_BODY)), 'd87cbcae7bc01e3f04b5b78ad997ab04615f82b49f198efbdb4ebb68399c78c2');
  assert.equal(stringToSign('POST', '/v1/status', String(VECTOR_TS), VECTOR_BODY),
    'v1\nPOST\n/v1/status\n1791547380000\nd87cbcae7bc01e3f04b5b78ad997ab04615f82b49f198efbdb4ebb68399c78c2');
  assert.equal(signature(KEY, 'POST', '/v1/status', String(VECTOR_TS), VECTOR_BODY), VECTOR_SIG);
  assert.equal(sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'a GET signs the hash of nothing');
});

test('every row of 18.4: ping without a key, a signed report, and the status with its senders', async () => {
  const api = setup();
  const ping = await send(api, 'GET', '/v1/ping?probe=1');
  assert.deepEqual(ping, {
    status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    body: { service: 'busy-light', apiVersion: 1, version: '0.1.0-beta.3', id: ID },
  });
  const report = await send(api, 'POST', '/v1/status', VECTOR_BODY,
    { 'Content-Type': 'application/json; charset=utf-8', Authorization: `BusyLight-HMAC-SHA256 ts=${VECTOR_TS}, sig=${VECTOR_SIG}` });
  assert.deepEqual(report, {
    status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    body: { accepted: true, expiresAt: new Date(VECTOR_TS + 180_000).toISOString(), status: 'inCall' },
  }, 'the exact request of the test vector, accepted');
  const status = await signedGet(api);
  assert.deepEqual(status.body, {
    status: 'inCall', reason: { source: MAC, until: null },
    senders: [{ sender: MAC, status: 'inCall', app: 'Microsoft Teams', expiresAt: new Date(VECTOR_TS + 180_000).toISOString() }],
  });
  assert.equal((await send(api, 'GET', '/v1/status', '', plain())).body.status, 'inCall', 'the plain key reads it too');
});

test('GET /v1/status says nothing about calendars or events (18.10 item 3): a reason names only an active sender', async () => {
  const api = setup();
  await signedPost(api, { sender: MAC, status: 'away' });
  // A calendar meeting outranks the report: the answer gives the status, but neither the calendar's name nor the end time.
  engine!.status = 'inMeeting';
  engine!.reason = { source: 'Work', until: clock.now() + 1_800_000 };
  assert.deepEqual((await signedGet(api, clock.now() + 1)).body.reason, { source: null, until: null });
  engine!.reason = { source: 'Teams', until: null };
  assert.deepEqual((await signedGet(api, clock.now() + 2)).body.reason, { source: null, until: null });
  engine!.status = 'away';
  engine!.reason = { source: MAC, until: null };
  assert.deepEqual((await signedGet(api, clock.now() + 3)).body.reason, { source: MAC, until: null }, 'a sender the answer lists anyway');
  engine!.status = 'unknown';
  engine!.reason = null;
  assert.equal((await signedGet(api, clock.now() + 4)).body.reason, null);
});

test('while the Working switch is off a sender sees notWorking, which it cannot send (18.10 item 3, SPEC 6.6)', async () => {
  const api = setup();
  await engine!.setWorking(false);
  const report = await send(api, 'POST', '/v1/status', body({ sender: MAC, status: 'inCall' }), plain());
  assert.deepEqual([report.status, report.body.status], [200, 'notWorking']);
  const answer = await signedGet(api);
  assert.equal(answer.body.status, 'notWorking');
  assert.equal(answer.body.reason, null);
  assert.equal((answer.body.senders as unknown[]).length, 1, 'the report is kept');
  assert.equal((await send(api, 'POST', '/v1/status', body({ sender: MAC, status: 'notWorking' }), plain())).body.error, 'invalid_status');
  await engine!.setWorking(true);
  assert.equal((await signedGet(api)).body.status, 'inCall');
});

test('a signature over a body that differs by one byte is refused; parameters in either order are accepted', async () => {
  const api = setup();
  const b = body({ sender: 'A', status: 'busy' });
  const sig = signature(KEY, 'POST', '/v1/status', String(VECTOR_TS), b);
  const altered = b.replace('busy', 'busz');
  assert.equal((await send(api, 'POST', '/v1/status', altered, { ...json, Authorization: `BusyLight-HMAC-SHA256 ts=${VECTOR_TS}, sig=${sig}` })).body.error,
    'unauthorized');
  assert.equal((await send(api, 'POST', '/v1/status', b, { ...json, Authorization: `busylight-hmac-sha256 sig=${sig},ts=${VECTOR_TS}` })).status, 200);
});

test('a malformed signed header is unauthorized', () => {
  const sig = 'a'.repeat(64);
  const scheme = 'BusyLight-HMAC-SHA256';
  for (const header of [`${scheme} ts=1`, `${scheme} sig=${sig}`, `${scheme} ts=1, ts=2, sig=${sig}`, `${scheme} ts=1x, sig=${sig}`,
    `${scheme} ts=1, sig=${sig.toUpperCase()}`, `${scheme} ts=1, sig=${sig}0`, `${scheme} ts=1, sig=${sig}, extra=1`, scheme, 'Basic abc', 'Bearer',
    'Bearer a b']) {
    assert.equal(parseAuthorization(header).kind, 'malformed', header);
  }
  assert.equal(parseAuthorization(undefined).kind, 'missing');
  assert.deepEqual(parseAuthorization(`BusyLight-HMAC-SHA256 sig=${sig} , ts=12`), { kind: 'signed', ts: '12', sig });
});

test('clock_skew at 301 seconds both ways, acceptance at 300, the message giving the difference', async () => {
  const api = setup();
  const now = clock.now();
  for (const [offset, sender] of [[301_000, 'Ahead'], [-301_000, 'Behind']] as const) {
    const answer = await signedPost(api, { sender, status: 'busy' }, now + offset);
    assert.equal(answer.status, 401);
    assert.deepEqual(answer.body, { error: 'clock_skew', message: 'The signed ts is 301 seconds from Busy Light\'s clock.' });
  }
  assert.equal((await signedPost(api, { sender: 'Ahead', status: 'busy' }, now + 300_000)).status, 200);
  assert.equal((await signedPost(api, { sender: 'Behind', status: 'busy' }, now - 300_000)).status, 200);
  assert.deepEqual(inputWarnings(), [`Status input: refused a request from ${HOME} whose clock is 301 seconds off.`], 'once per address per hour');
});

test('replayed for an equal and a smaller ts, with lastTs; a captured report refused after clear and after expiry', async () => {
  const api = setup();
  const ts = clock.now();
  const captured = { sender: MAC, status: 'inCall', ttlSeconds: 30 };
  assert.equal((await signedPost(api, captured, ts)).status, 200);
  for (const again of [ts, ts - 1]) {
    const answer = await signedPost(api, captured, again);
    assert.equal(answer.status, 401);
    assert.deepEqual(answer.body, { error: 'replayed', message: ERROR_MESSAGES.replayed, lastTs: String(ts) });
  }
  assert.equal((await signedPost(api, { sender: MAC, status: 'clear' }, ts + 1)).status, 200);
  assert.equal((await signedPost(api, captured, ts)).body.error, 'replayed', 'sent again after clear');
  await signedPost(api, { sender: MAC, status: 'inCall', ttlSeconds: 30 }, ts + 2);
  await clock.advance(31_000);
  assert.equal(engine!.status, 'available', 'expired');
  const late = await signedPost(api, captured, ts + 2);
  assert.deepEqual(late.body.error, 'replayed', 'sent again after expiry');
  assert.equal(late.body.lastTs, String(ts + 2));
});

/** A second handler over the same engine with the plain key turned off. */
function setupOff(): StatusApi {
  return new StatusApi({ config: { enabled: true, port: 8582, key: KEY, allowPlainKey: false }, engine: engine!, log: log.log, version: '0.1.0-beta.3',
    id: ID, now: clock.now, equal: (a, b) => {
      compared++;
      return crypto.timingSafeEqual(a, b);
    } });
}

test('lastTs is never given away: every failed authentication for a sender with an entry gets its own 401, before the body is parsed', async () => {
  const api = setup();
  const ts = clock.now();
  await signedPost(api, { sender: MAC, status: 'inCall' }, ts);
  const fields = body({ sender: MAC, status: 'inCall' });
  const bad = '{ not json at all';
  const cases: [string, (b: string) => string, string, number][] = [
    ['a wrong signature', () => `BusyLight-HMAC-SHA256 ts=${ts}, sig=${'0'.repeat(64)}`, 'unauthorized', 401],
    ['a malformed header', () => `BusyLight-HMAC-SHA256 ts=${ts}`, 'unauthorized', 401],
    ['a ts outside the window', (b) => signedAuthorization(KEY, 'POST', '/v1/status', ts - 301_000, b), 'clock_skew', 401],
    ['the wrong plain key', () => `Bearer ${'x'.repeat(43)}`, 'unauthorized', 401],
  ];
  for (const [what, authorization, error, code] of cases) {
    for (const b of [fields, bad]) {
      const answer = await send(api, 'POST', '/v1/status', b, { ...json, Authorization: authorization(b) });
      assert.equal(answer.status, code, what);
      assert.equal(answer.body.error, error, `${what}: its own 401, not invalid_json`);
      assert.deepEqual(Object.keys(answer.body), ['error', 'message'], `${what}: no lastTs`);
      assert.ok(!JSON.stringify(answer).includes(String(ts)), `${what}: no sign of the entry`);
    }
  }
  const off = setupOff();
  for (const b of [fields, bad]) {
    const answer = await send(off, 'POST', '/v1/status', b, plain());
    assert.deepEqual(answer.body, { error: 'plain_key_off', message: ERROR_MESSAGES.plain_key_off }, 'the plain key while it is off');
  }
});

test('the replay table outlives the 20-sender display list and survives a reload of inputs.json', async () => {
  let api = setup();
  const ts = clock.now();
  await signedPost(api, { sender: MAC, status: 'inCall', ttlSeconds: 30 }, ts);
  await clock.advance(31_000);
  for (let i = 0; i < 25; i++) {
    await signedPost(api, { sender: `Other ${i}`, status: 'away', ttlSeconds: 30 }, clock.now());
    await clock.advance(1000);
  }
  assert.ok(!engine!.inputs.list(clock.now()).some((e) => e.sender === MAC), 'gone from the display list');
  assert.equal((await signedPost(api, { sender: MAC, status: 'inCall' }, ts)).body.error, 'replayed');
  engine!.stop();
  engine = null;
  // A restart: the same inputs.json, read again.
  const { config } = parseConfig({ statusInput: { enabled: true, key: KEY } });
  engine = new BusyLightEngine({ config, storageDir: dir, log: log.log, version: '0.1.0-beta.3', clock });
  engine.start();
  api = new StatusApi({ config: config.statusInput, engine, log: log.log, version: '0.1.0-beta.3', id: ID, now: clock.now });
  const answer = await signedPost(api, { sender: MAC, status: 'inCall' }, ts);
  assert.deepEqual(answer.body.lastTs, String(ts), 'still refused after a restart');
});

test('the startup floor when inputs.json is missing: refused before startup time, accepted after', async () => {
  const api = setup({}, {}, true);
  const start = clock.now();
  const before = await signedPost(api, { sender: 'Fresh', status: 'busy' }, start - 1000);
  assert.deepEqual(before.body, { error: 'replayed', message: ERROR_MESSAGES.replayed, lastTs: String(start) });
  assert.equal((await signedPost(api, { sender: 'Fresh', status: 'busy' }, start + 1)).status, 200);
  assert.equal(engine!.inputs.replayFloor('Someone else', start + 300_001), null, 'gone after 300 seconds');
});

test('a captured signed GET /v1/status is answered twice: the stated exception', async () => {
  const api = setup();
  const ts = clock.now();
  assert.equal((await signedGet(api, ts)).status, 200);
  assert.equal((await signedGet(api, ts)).status, 200);
});

test('the plain key: accepted while allowed, recorded as plain; with it off, plain_key_off before the key is compared', async () => {
  const api = setup();
  assert.equal((await send(api, 'POST', '/v1/status', body({ sender: 'Shortcut', status: 'busy' }), plain())).status, 200);
  await clock.advance(1000);
  await signedPost(api, { sender: 'App', status: 'away' });
  assert.deepEqual(engine!.inputs.list(clock.now()).map((e) => [e.sender, e.auth]), [['App', 'signed'], ['Shortcut', 'plain']]);
  const off = setupOff();
  compared = 0;
  const answer = await send(off, 'POST', '/v1/status', body({ sender: 'Shortcut', status: 'busy' }), plain());
  assert.equal(answer.status, 401);
  assert.equal(answer.body.error, 'plain_key_off');
  assert.equal(compared, 0, 'the key is not compared');
  assert.equal((await send(off, 'POST', '/v1/status', body({ sender: 'Shortcut', status: 'busy' }), plain('wrong'))).body.error, 'plain_key_off');
  assert.ok(inputWarnings().includes(`Status input: refused a request from ${HOME} that sent the key itself. `
    + 'Turn on Allow the plain key, or have that app sign its requests.'));
  assert.ok(!inputWarnings().some((l) => l.includes('wrong key')), 'not the wrong key line');
});

test('constant-time comparison is used for both forms', async () => {
  const api = setup();
  compared = 0;
  await send(api, 'POST', '/v1/status', body({ sender: 'A', status: 'busy' }), plain());
  assert.equal(compared, 1, 'the plain key');
  await signedPost(api, { sender: 'B', status: 'busy' });
  assert.equal(compared, 2, 'the signature');
});

test('the text rule of 18.4 item 3', async () => {
  const api = setup();
  assert.equal(checkText('Alex’s iMac'), 'Alex’s iMac', 'a curly apostrophe is fine');
  const nfc = 'Ren\u00e9’s Mac';
  const nfd = 'Rene\u0301’s Mac';
  assert.equal(checkText(nfd), nfc);
  await send(api, 'POST', '/v1/status', body({ sender: nfc, status: 'busy' }), plain());
  await send(api, 'POST', '/v1/status', body({ sender: nfd, status: 'away' }), plain());
  assert.deepEqual(engine!.inputs.list(clock.now()).map((e) => [e.sender, e.status]), [[nfc, 'away']], 'one sender');
  const phone = '\u{1F4DE}';
  assert.equal((await send(api, 'POST', '/v1/status', body({ sender: phone.repeat(64), status: 'busy' }), plain())).status, 200, '64 emoji');
  assert.equal((await send(api, 'POST', '/v1/status', body({ sender: phone.repeat(65), status: 'busy' }), plain())).body.error, 'invalid_sender');
  const refused = ['', ' Leading', 'Trailing ', 'Tab\tin', 'New\nline', 'Bell\u0007', 'Delete\u007f', 'Next\u0085line', 'Line\u2028sep',
    'Para\u2029sep', ...['\u202a', '\u202b', '\u202c', '\u202d', '\u202e', '\u2066', '\u2067', '\u2068', '\u2069'].map((c) => `Bidi${c}x`),
    'No-break\u00a0', 42, null, ['A']];
  for (const value of refused) {
    assert.equal(checkText(value), null, JSON.stringify(value));
    assert.equal((await send(api, 'POST', '/v1/status', body({ sender: value, status: 'busy' }), plain())).body.error, 'invalid_sender', JSON.stringify(value));
    assert.equal((await send(api, 'POST', '/v1/status', body({ sender: 'S', status: 'busy', app: value }), plain())).body.error,
      value === null ? undefined : 'invalid_app', JSON.stringify(value));
  }
});

test('the sender name Home app is reserved for the On a Call switch, in any form that normalizes to it (18.4 item 3)', async () => {
  const api = setup();
  const post = (fields: Record<string, unknown>) => send(api, 'POST', '/v1/status', body(fields), plain());
  const fullwidth = '\uff28\uff4f\uff4d\uff45 \uff41\uff50\uff50';
  for (const sender of ['Home app', 'Home\u00a0app', fullwidth, 'Home\u2002app']) {
    assert.ok(isReservedSender(sender), JSON.stringify(sender));
    assert.deepEqual((await post({ sender, status: 'inCall' })).body, { error: 'invalid_sender', message: ERROR_MESSAGES.invalid_sender },
      JSON.stringify(sender));
    assert.equal((await post({ sender, status: 'clear' })).body.error, 'invalid_sender', 'clear too');
    assert.equal((await signedPost(api, { sender, status: 'inCall' })).body.error, 'invalid_sender', 'signed too');
  }
  for (const sender of ['home app', 'Home app 2', 'Home App', 'Home apps']) {
    assert.equal(isReservedSender(sender), false, sender);
    assert.equal((await post({ sender, status: 'busy' })).status, 200, sender);
  }
  assert.ok(!engine!.inputs.list(clock.now()).some((e) => e.sender.normalize('NFKC') === 'Home app'));
});

test('format characters are refused, a joiner between emoji is not, and look-alike letters are accepted (18.4 item 3, build 3.3)', async () => {
  const api = setup();
  const post = (fields: Record<string, unknown>) => send(api, 'POST', '/v1/status', body(fields), plain());
  const zeroWidthSpace = '\u200b';
  const wordJoiner = '\u2060';
  for (const value of [`Home${zeroWidthSpace} app`, `Home app${zeroWidthSpace}`, `Ho${wordJoiner}me app`, `My${zeroWidthSpace}Mac`, `My${wordJoiner}Mac`,
    'Soft\u00adhyphen', 'Joined\u200dletters', 'Tag\u{e0067}']) {
    assert.equal(checkText(value), null, JSON.stringify(value));
    assert.deepEqual((await post({ sender: value, status: 'inCall' })).body, { error: 'invalid_sender', message: ERROR_MESSAGES.invalid_sender },
      JSON.stringify(value));
    assert.equal((await post({ sender: 'S', status: 'inCall', app: value })).body.error, 'invalid_app', JSON.stringify(value));
  }
  // The reserved name is compared with every format character removed, so a joiner could never hide it.
  assert.ok(isReservedSender(`Home${zeroWidthSpace} app`) && isReservedSender(`Ho${wordJoiner}me\u00a0app`));
  // Nor can another character a renderer shows as nothing (the review, build 3.3): the combining grapheme joiner, variation
  // selectors, a Mongolian free variation selector, a Khmer inherent vowel. They pass the text rule, and are refused as the
  // reserved name.
  for (const value of ['Home app\u034f', 'Ho\u034fme app', 'Home app\ufe0f', 'Home\ufe00 app', 'Home app\u180b', 'Home app\u17b4']) {
    assert.ok(isReservedSender(checkText(value) ?? ''), JSON.stringify(value));
    assert.equal((await post({ sender: value, status: 'inCall' })).body.error, 'invalid_sender', JSON.stringify(value));
  }
  // Nor can a character drawn as a blank gap in place of the space (the second review): the Hangul fillers and the Braille
  // blank, or two spaces, which a page shows as one.
  for (const value of ['Home\u3164app', 'Home\uffa0app', 'Home\u2800app', 'Home\u1160app', 'Home\u115f app', 'Home  app', 'Home \u2800 app']) {
    assert.ok(isReservedSender(checkText(value) ?? ''), JSON.stringify(value));
    assert.equal((await post({ sender: value, status: 'inCall' })).body.error, 'invalid_sender', JSON.stringify(value));
  }
  // Emoji built with a zero-width joiner stay whole: a person at a laptop (with a skin tone), a rainbow flag.
  for (const emoji of ['\u{1F469}\u200d\u{1F4BB}', '\u{1F469}\u{1F3FD}\u200d\u{1F4BB}', '\u{1F3F3}\ufe0f\u200d\u{1F308}']) {
    const sender = `Mac ${emoji}`;
    assert.equal(checkText(sender), sender);
    assert.equal((await post({ sender, status: 'busy', app: emoji })).status, 200, JSON.stringify(sender));
  }
  // Look-alike letters from other scripts cannot be refused in general: Home app with a Cyrillic En and o is accepted (SPEC 17).
  const cyrillic = '\u041d\u043eme app';
  assert.equal(isReservedSender(cyrillic), false);
  assert.equal((await post({ sender: cyrillic, status: 'busy' })).status, 200);
  assert.deepEqual(engine!.inputs.list(clock.now()).filter((e) => e.sender === cyrillic).map((e) => e.auth), ['plain'],
    'listed with its own authentication badge, which the switch never has');
});

test('fields: unknown_field, invalid_status (tentative and unknown too), invalid_ttl, invalid_json', async () => {
  const api = setup();
  const post = (fields: unknown) => send(api, 'POST', '/v1/status', typeof fields === 'string' ? fields : JSON.stringify(fields), plain());
  assert.equal((await post({ sender: 'S', status: 'busy', title: 'x' })).body.error, 'unknown_field');
  for (const status of ['tentative', 'unknown', 'Busy', '', 3, undefined]) {
    assert.equal((await post({ sender: 'S', status })).body.error, 'invalid_status', String(status));
  }
  for (const ttlSeconds of [29, 43201, 60.5, '60']) {
    assert.equal((await post({ sender: 'S', status: 'busy', ttlSeconds })).body.error, 'invalid_ttl', String(ttlSeconds));
  }
  for (const ttlSeconds of [30, 43200]) {
    assert.equal((await post({ sender: 'S', status: 'busy', ttlSeconds })).status, 200);
  }
  for (const text of ['', '{', '[]', '"busy"', 'null']) {
    assert.equal((await post(text)).body.error, 'invalid_json', text);
  }
});

test('clear: with and without an active report, with ttlSeconds, never 409', async () => {
  const api = setup();
  const post = (fields: Record<string, unknown>) => send(api, 'POST', '/v1/status', body(fields), plain());
  await post({ sender: MAC, status: 'inCall' });
  assert.deepEqual((await post({ sender: MAC, status: 'clear', app: 'Zoom', ttlSeconds: 60 })).body, { accepted: true, expiresAt: null, status: 'available' });
  assert.deepEqual((await post({ sender: MAC, status: 'clear' })).body, { accepted: true, expiresAt: null, status: 'available' }, 'idempotent');
  assert.equal((await post({ sender: MAC, status: 'clear', ttlSeconds: 5 })).body.error, 'invalid_ttl', 'checked against its rule');
  for (let i = 0; i < 20; i++) {
    await post({ sender: `S${i}`, status: 'busy' });
  }
  assert.deepEqual((await post({ sender: 'Twenty-first', status: 'busy' })).body, { error: 'too_many_senders', message: ERROR_MESSAGES.too_many_senders });
  assert.equal((await post({ sender: 'Twenty-first', status: 'clear' })).status, 200, 'clear is never refused with 409');
  await post({ sender: 'S0', status: 'clear' });
  assert.equal((await post({ sender: 'Twenty-first', status: 'busy' })).status, 200);
});

test('403 for an address outside the local network, before anything else is read', async () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.5', '169.254.1.1', '::1', 'fd00::1', 'fc00::5',
    'fe80::1%eth0', '::ffff:192.168.1.5']) {
    assert.ok(isLocalAddress(ip), ip);
  }
  for (const ip of ['8.8.8.8', '172.32.0.1', '11.0.0.1', '::ffff:8.8.8.8', '2001:db8::1', 'fec0::1', '', 'nonsense']) {
    assert.ok(!isLocalAddress(ip), ip);
  }
  const api = setup();
  const answer = await send(api, 'POST', '/nowhere', 'x'.repeat(5000), plain(), '::ffff:203.0.113.9');
  assert.equal(answer.status, 403);
  assert.equal(answer.body.error, 'not_local');
  await send(api, 'GET', '/v1/ping', '', {}, '203.0.113.9');
  assert.deepEqual(inputWarnings(), ['Status input: refused a request from 203.0.113.9, which is not on the local network.'], 'once per hour');
  const forwarded = await send(api, 'GET', '/v1/ping', '', { 'X-Forwarded-For': HOME }, '203.0.113.9');
  assert.equal(forwarded.status, 403, 'X-Forwarded-For is ignored');
});

test('rate limit: 60 a minute per address, refused ones counted, then 429 with Retry-After', async () => {
  const api = setup();
  for (let i = 0; i < 30; i++) {
    await send(api, 'GET', '/v1/ping');
    await send(api, 'GET', '/nowhere');
  }
  const limited = await send(api, 'GET', '/v1/ping');
  assert.equal(limited.status, 429);
  assert.equal(limited.body.error, 'rate_limited');
  assert.equal(limited.headers['Retry-After'], '60');
  assert.equal((await send(api, 'GET', '/v1/ping', '', {}, '192.168.4.21')).status, 200, 'per address');
  await clock.advance(60_000);
  assert.equal((await send(api, 'GET', '/v1/ping')).status, 200, 'a rolling minute');
});

test('Retry-After is exact: waiting that long is enough, and one second less is not', async () => {
  const api = setup();
  await send(api, 'GET', '/v1/ping');
  await clock.advance(59_500);
  for (let i = 0; i < 59; i++) {
    assert.equal((await send(api, 'GET', '/v1/ping')).status, 200);
  }
  const limited = await send(api, 'GET', '/v1/ping');
  assert.equal(limited.status, 429);
  const wait = Number(limited.headers['Retry-After']);
  assert.equal(wait, 60, 'the 60th most recent request leaves the window in 60 seconds, not the oldest in half a second');
  await clock.advance((wait - 1) * 1000);
  assert.equal((await send(api, 'GET', '/v1/ping')).status, 429, 'one second early');
  await clock.advance(61_000);
  assert.equal((await send(api, 'GET', '/v1/ping')).status, 200, 'after Retry-After');
});

test('the rate and log maps forget addresses that no longer matter, and keep at most 61 times per address', async () => {
  const api = setup();
  const maps = api as unknown as { hits: Map<string, number[]>; logged: Map<string, number> };
  for (let i = 0; i < 300; i++) {
    await send(api, 'GET', '/v1/ping', '', {}, `10.0.${Math.floor(i / 250)}.${(i % 250) + 1}`);
    await send(api, 'GET', '/v1/ping', '', {}, `198.51.${Math.floor(i / 250)}.${(i % 250) + 1}`);
  }
  assert.equal(maps.hits.size, 300);
  for (let i = 0; i < 100; i++) {
    await send(api, 'GET', '/v1/ping');
  }
  assert.ok(maps.hits.get(HOME)!.length <= 61, 'a busy address keeps only the last 61 times');
  await clock.advance(3_600_000);
  await send(api, 'GET', '/v1/ping', '', {}, '10.9.9.9');
  assert.equal(maps.hits.size, 1, 'only the address just heard from');
  await send(api, 'GET', '/v1/ping', '', {}, '198.51.100.250');
  assert.equal(maps.logged.size, 1, 'only the refusal just logged');
});

test('path, method, size and media type; no CORS headers; OPTIONS 405', async () => {
  const api = setup();
  assert.equal((await send(api, 'GET', '/v2/status')).body.error, 'not_found');
  const options = await send(api, 'OPTIONS', '/v1/status');
  assert.equal(options.status, 405);
  assert.equal(options.headers.Allow, 'GET, POST');
  assert.equal((await send(api, 'POST', '/v1/ping')).headers.Allow, 'GET');
  assert.equal((await send(api, 'PUT', '/v1/status')).body.error, 'method_not_allowed');
  const exact = JSON.stringify({ sender: 'S', status: 'busy', app: 'a'.repeat(10) });
  const padded = exact.slice(0, -1) + ' '.repeat(2049 - Buffer.byteLength(exact)) + '}';
  assert.equal(Buffer.byteLength(padded), 2049);
  assert.equal((await send(api, 'POST', '/v1/status', padded, plain())).body.error, 'too_large');
  assert.equal((await send(api, 'POST', '/v1/status', padded.slice(1), plain())).status, 400, '2048 bytes is read (and is not JSON here)');
  assert.equal((await send(api, 'POST', '/v1/status', '{}', { ...plain(), 'Content-Length': '5000' })).body.error, 'too_large', 'by Content-Length');
  const textPlain = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'text/plain' };
  assert.equal((await send(api, 'POST', '/v1/status', body({ sender: 'S', status: 'busy' }), textPlain)).body.error,
    'unsupported_media_type');
  assert.equal((await send(api, 'POST', '/v1/status', body({ sender: 'S', status: 'busy' }), { Authorization: `Bearer ${KEY}` })).body.error,
    'unsupported_media_type', 'no Content-Type');
  for (const response of allResponses) {
    assert.ok(!/access-control/i.test(response), 'no CORS header');
  }
});

test('the check order of 18.4 item 8', async () => {
  const api = setup();
  const big = 'x'.repeat(3000);
  assert.equal((await send(api, 'POST', '/nowhere', big, {}, '8.8.8.8')).body.error, 'not_local', 'local address first');
  assert.equal((await send(api, 'PUT', '/nowhere', big)).body.error, 'not_found', 'path before size');
  assert.equal((await send(api, 'PUT', '/v1/status', big)).body.error, 'method_not_allowed', 'method before size');
  assert.equal((await send(api, 'POST', '/v1/status', big, { 'Content-Type': 'text/plain' })).body.error, 'too_large', 'size before media type');
  assert.equal((await send(api, 'POST', '/v1/status', '{', { 'Content-Type': 'text/plain' })).body.error, 'unsupported_media_type',
    'media type before authentication');
  assert.equal((await send(api, 'POST', '/v1/status', '{', json)).body.error, 'unauthorized', 'authentication before JSON');
  assert.equal((await send(api, 'POST', '/v1/status', body({ sender: '', status: 'nope' }), plain())).body.error, 'invalid_sender', 'JSON, then fields');
  const ts = clock.now();
  await signedPost(api, { sender: 'Order', status: 'busy' }, ts);
  assert.equal((await signedPost(api, { sender: 'Order', status: 'nope' }, ts)).body.error, 'invalid_status', 'fields before the replay rule');
  for (let i = 0; i < 19; i++) {
    await send(api, 'POST', '/v1/status', body({ sender: `F${i}`, status: 'busy' }), plain());
  }
  assert.equal((await signedPost(api, { sender: 'New', status: 'busy' }, ts)).status, 409);
  await clock.advance(1);
  assert.equal((await signedPost(api, { sender: 'Order', status: 'busy' }, ts)).body.error, 'replayed', 'the replay rule before the sender count');
  for (let i = 0; i < 60; i++) {
    await send(api, 'GET', '/v1/ping');
  }
  assert.equal((await send(api, 'GET', '/nowhere')).body.error, 'rate_limited', 'rate limit before path');
});

test('every error key of 18.4 item 6 was answered, and no response or log line carries the key', () => {
  const all: ErrorKey[] = ['invalid_json', 'unknown_field', 'invalid_sender', 'invalid_status', 'invalid_app', 'invalid_ttl', 'unauthorized',
    'clock_skew', 'replayed', 'plain_key_off', 'not_local', 'not_found', 'method_not_allowed', 'too_many_senders', 'too_large',
    'unsupported_media_type', 'rate_limited'];
  assert.deepEqual([...seenErrors].sort(), [...all].sort());
  for (const text of allResponses) {
    assert.ok(!text.includes(KEY), text);
  }
});

test('a wrong key is logged once per address per hour; no log line carries the key', async () => {
  const api = setup();
  await send(api, 'GET', '/v1/status', '', plain('nope'));
  await send(api, 'GET', '/v1/status');
  await send(api, 'GET', '/v1/status', '', plain('nope'), '192.168.4.21');
  assert.deepEqual(inputWarnings(), [
    `Status input: refused a request with a wrong key from ${HOME}.`,
    'Status input: refused a request with a wrong key from 192.168.4.21.',
  ]);
  await clock.advance(3_600_000);
  await send(api, 'GET', '/v1/status', '', plain('nope'));
  assert.equal(inputWarnings().length, 3, 'again after an hour');
  for (const line of log.all()) {
    assert.ok(!line.includes(KEY), line);
  }
});

// ---------------------------------------------------------------------------
// The server, with http.createServer replaced (no socket is opened)
// ---------------------------------------------------------------------------

class FakeServer implements ServerLike {
  listens: { port: number; host?: string }[] = [];
  closed = false;
  requestTimeout?: number;
  private errorListener: ((err: NodeJS.ErrnoException) => void) | null = null;

  constructor(private readonly fail: (host: string | undefined) => string | null) {}

  listen(options: { port: number; host?: string }, listener: () => void): this {
    this.listens.push(options);
    const code = this.fail(options.host);
    setImmediate(() => {
      if (code) {
        this.errorListener?.(Object.assign(new Error(code), { code }));
      } else {
        listener();
      }
    });
    return this;
  }

  once(_event: 'error', listener: (err: NodeJS.ErrnoException) => void): this {
    this.errorListener = listener;
    return this;
  }

  removeAllListeners(): this {
    this.errorListener = null;
    return this;
  }

  on(): this {
    return this;
  }

  close(): this {
    this.closed = true;
    return this;
  }
}

function server(fail: (host: string | undefined) => string | null): { input: StatusInputServer; fake: FakeServer } {
  const fake = new FakeServer(fail);
  const { config } = parseConfig({ statusInput: { enabled: true, key: KEY } });
  const input = new StatusInputServer({
    config: config.statusInput, engine: engine ?? new BusyLightEngine({ config, storageDir: dir, log: log.log, version: '0.1.0-beta.3', clock }),
    log: log.log, version: '0.1.0-beta.3', storageDir: dir, createServer: () => fake,
  });
  return { input, fake };
}

test('the server starts on every address, creates the instance id once, and stops', async () => {
  const { input, fake } = server(() => null);
  await input.start();
  assert.deepEqual(fake.listens, [{ port: 8582, host: '::', ipv6Only: false }]);
  assert.equal(fake.requestTimeout, 10_000);
  assert.deepEqual(input.state, { listening: true, error: null });
  assert.deepEqual(log.lines('info'), ['Status input is listening on port 8582.']);
  const id = readInstanceId(dir)!;
  assert.match(id, /^[A-Za-z0-9_-]{16}$/);
  assert.equal(fs.statSync(path.join(dir, 'instance.json')).mode & 0o777, 0o600);
  assert.equal(ensureInstanceId(dir), id, 'kept');
  input.stop();
  assert.equal(fake.closed, true);
  assert.equal(input.state.listening, false);
});

test('a port in use is logged once and leaves the input off; a host without IPv6 listens on IPv4', async () => {
  const busy = server(() => 'EADDRINUSE');
  await busy.input.start();
  assert.deepEqual(busy.input.state, { listening: false, error: 'port 8582 is already in use' });
  assert.deepEqual(log.lines('error'), ['Status input could not start: port 8582 is already in use.']);
  const denied = server(() => 'EACCES');
  await denied.input.start();
  assert.equal(log.lines('error')[1], 'Status input could not start: EACCES.');
  const v4 = server((host) => (host === '::' ? 'EAFNOSUPPORT' : null));
  await v4.input.start();
  assert.deepEqual(v4.fake.listens.map((l) => l.host), ['::', '0.0.0.0']);
  assert.equal(v4.input.state.listening, true);
  await settle();
});
