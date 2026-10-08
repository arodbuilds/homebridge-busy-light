import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConfig } from '../src/config.js';
import type { GoogleSourceConfig, UrlSourceConfig } from '../src/config.js';
import { SourceError } from '../src/errors.js';
import { describeNetworkError, retryAfterMs } from '../src/http.js';
import { MAX_BODY_BYTES, UrlSource } from '../src/url-source.js';
import { FakeFetch, fixture, fixtureTitles, networkError, redirect, text } from './helpers.js';

const now = Date.UTC(2026, 9, 8, 15);
const ics = { outOfOfficeWords: ['Vacation'], ownerAddresses: ['person@example.com'] };
const SECRET_PATH = '/calendar/ical/synthetic%40group.example.com/private-0123456789abcdef/basic.ics';
const FEED = `https://calendar.example.com${SECRET_PATH}?token=synthetic-query`;

let fake: FakeFetch;
beforeEach(() => {
  fake = new FakeFetch();
});
afterEach(() => {
  fake.restore();
});

function source(url: string, type: 'url' | 'google' = 'url'): UrlSource {
  const { config, issues } = parseConfig({ calendars: [{ type, name: 'Rota', url, email: 'person@example.com' }] });
  assert.deepEqual(issues, []);
  return new UrlSource(config.calendars[0] as UrlSourceConfig | GoogleSourceConfig, ics);
}

async function failure(p: Promise<unknown>): Promise<SourceError> {
  try {
    await p;
  } catch (err) {
    assert.ok(err instanceof SourceError);
    return err;
  }
  assert.fail('expected a failure');
}

function assertRedacted(message: string): void {
  assert.ok(!message.includes('private-0123456789abcdef'), message);
  assert.ok(!message.includes('synthetic-query'), message);
  assert.ok(!message.includes('/calendar/'), message);
  for (const title of fixtureTitles()) {
    assert.ok(!message.includes(title), message);
  }
}

test('webcal:// is rewritten to https://', async () => {
  fake.on('https://calendar.example.com/', () => text(fixture('calendar.ics')));
  const events = await source('webcal://calendar.example.com/feed.ics').fetchEvents(now);
  assert.equal(events.length, 9);
  assert.equal(fake.calls[0].url, 'https://calendar.example.com/feed.ics');
  assert.equal(fake.calls[0].method, 'GET');
});

test('http:// is refused by validation and never fetched', () => {
  const { config, issues } = parseConfig({ calendars: [{ type: 'google', name: 'Personal', url: 'http://calendar.example.com/a.ics' }] });
  assert.deepEqual(issues.map((i) => `${i.path}: ${i.message}`), ['calendars[0].url: must start with https:// or webcal://']);
  assert.equal(config.calendars.length, 0);
  assert.equal(fake.calls.length, 0);
});

test('a Google source reads its secret address the same way', async () => {
  fake.on('https://calendar.example.com/', () => text(fixture('calendar.ics')));
  const events = await source(FEED, 'google').fetchEvents(now);
  assert.equal(events.filter((e) => e.showAs === 'oof').length, 1);
  assert.ok(events.every((e) => e.source === 'Rota'));
});

test('ETag and 304: the last parsed events are kept and the check succeeds', async () => {
  fake.on('https://calendar.example.com/', (call, index) => {
    if (index === 0) {
      assert.equal(call.headers['if-none-match'], undefined);
      return text(fixture('calendar.ics'), 200, { etag: '"v1"' });
    }
    assert.equal(call.headers['if-none-match'], '"v1"');
    return new Response(null, { status: 304 });
  });
  const src = source(FEED);
  const first = await src.fetchEvents(now);
  const second = await src.fetchEvents(now + 180_000);
  assert.deepEqual(second, first);
  assert.equal(fake.calls.length, 2);
});

test('no If-None-Match without an ETag, and a full download at least every 6 hours', async () => {
  fake.on('https://calendar.example.com/', (_call, index) => text(fixture('calendar.ics'), 200, index === 0 ? {} : { etag: '"v2"' }));
  const src = source(FEED);
  await src.fetchEvents(now);
  await src.fetchEvents(now + 60_000);
  assert.equal(fake.calls[1].headers['if-none-match'], undefined);
  await src.fetchEvents(now + 6 * 3_600_000 + 60_000);
  assert.equal(fake.calls[2].headers['if-none-match'], undefined, 'parsed events older than 6 hours are not reused');
});

test('a body over 10 MB is refused, with or without Content-Length', async () => {
  fake.on('https://calendar.example.com/declared', () => text('x', 200, { 'content-length': String(MAX_BODY_BYTES + 1) }));
  fake.on('https://calendar.example.com/streamed', () => new Response(new ReadableStream({
    start(controller) {
      const chunk = new Uint8Array(1024 * 1024).fill(65);
      for (let i = 0; i < 11; i++) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  })));
  for (const path of ['declared', 'streamed']) {
    const err = await failure(source(`https://calendar.example.com/${path}?k=synthetic-query`).fetchEvents(now));
    assert.equal(err.message, 'the calendar from calendar.example.com is larger than 10 MB');
    assert.equal(err.state, 'notReachable');
  }
});

test('redirects are followed only to https://', async () => {
  fake.on('https://calendar.example.com/', () => redirect('https://other.example.net/moved.ics'));
  fake.on('https://other.example.net/', () => text(fixture('calendar.ics')));
  assert.equal((await source(FEED).fetchEvents(now)).length, 9);
  assert.equal(fake.calls[0].init.redirect, 'manual');

  fake.on('https://calendar.example.com/', () => redirect('http://insecure.example.net/feed.ics', 301));
  const err = await failure(source(FEED).fetchEvents(now));
  assert.equal(err.message, 'calendar.example.com redirected to an address that is not https://');
  assert.equal(fake.callsTo('http://').length, 0);
  assertRedacted(err.message);
});

test('too many redirects', async () => {
  fake.on('https://calendar.example.com/', (call) => redirect(call.url));
  const err = await failure(source(FEED).fetchEvents(now));
  assert.equal(err.message, 'too many redirects from calendar.example.com');
  assert.equal(fake.calls.length, 6);
});

test('failures name the host and never the path or query', async () => {
  fake.on('https://calendar.example.com/', () => text('Not found', 404));
  let err = await failure(source(FEED).fetchEvents(now));
  assert.equal(err.message, 'calendar.example.com answered HTTP 404');
  assertRedacted(err.message);

  fake.on('https://calendar.example.com/', () => networkError('ENOTFOUND'));
  err = await failure(source(FEED).fetchEvents(now));
  assert.equal(err.message, 'calendar.example.com could not be found');
  assertRedacted(err.message);

  fake.on('https://calendar.example.com/', () => text('<html><body>Sign in</body></html>'));
  err = await failure(source(FEED).fetchEvents(now));
  assert.equal(err.message, 'the data from calendar.example.com is not a calendar');
  assertRedacted(err.message);
});

test('network failure reasons', () => {
  const timeout = Object.assign(new Error('aborted'), { name: 'TimeoutError' });
  assert.equal(describeNetworkError(timeout, 'h.example'), 'no answer from h.example within 20 seconds');
  const withCode = (code: string) => Object.assign(new TypeError('fetch failed'), { cause: { code } });
  assert.equal(describeNetworkError(withCode('ECONNREFUSED'), 'h.example'), 'h.example refused the connection');
  assert.equal(describeNetworkError(withCode('CERT_HAS_EXPIRED'), 'h.example'), 'h.example has a certificate problem');
  assert.equal(describeNetworkError(withCode('ECONNRESET'), 'h.example'), 'could not connect to h.example');
});

test('Retry-After in seconds or as a date', () => {
  assert.equal(retryAfterMs('120', now), 120_000);
  assert.equal(retryAfterMs(new Date(now + 30_000).toUTCString(), now), 30_000);
  assert.equal(retryAfterMs(null, now), null);
  assert.equal(retryAfterMs('soon', now), null);
});

test('use outOfOffice keeps only the out of office events, on a Google source and a URL source alike (SPEC 5.2 item 6)', async () => {
  fake.on('https://calendar.example.com/', () => text(fixture('calendar.ics'), 200, { etag: '"v1"' }));
  for (const type of ['google', 'url'] as const) {
    const all = await source(FEED, type).fetchEvents(now);
    const { config } = parseConfig({ calendars: [{ type, name: 'Rota', url: FEED, email: 'person@example.com', use: 'outOfOffice' }] });
    const src = new UrlSource(config.calendars[0] as UrlSourceConfig | GoogleSourceConfig, ics);
    const ooo = await src.fetchEvents(now);
    assert.equal(ooo.length, all.length, 'every event is kept, so the window and times are unchanged');
    assert.deepEqual(ooo.filter((e) => e.showAs !== 'free').map((e) => e.showAs), ['oof']);
    assert.deepEqual(ooo.filter((e) => e.showAs === 'oof'), all.filter((e) => e.showAs === 'oof'));
    // A 304 reuses the parsed events; the use still applies.
    fake.on('https://calendar.example.com/', () => new Response(null, { status: 304 }));
    assert.deepEqual((await src.fetchEvents(now + 60_000)).filter((e) => e.showAs !== 'free').map((e) => e.showAs), ['oof']);
    fake.on('https://calendar.example.com/', () => text(fixture('calendar.ics'), 200, { etag: '"v1"' }));
  }
});
