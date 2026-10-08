/**
 * Finding Busy Light by name (SPEC 18.11, 15 items 20 and 22), with the host's interfaces, the multicast DNS socket
 * and dns.lookup replaced: no test sends UDP or asks a resolver.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AddressCache, ADDRESS_CACHE_MS, inputAddresses, inputUrl, MDNS_ADDRESS, MDNS_PORT, mdnsARecords, mdnsQuery, preferredHost, setupCode,
} from '../src/addresses.js';
import type { AddressDeps } from '../src/addresses.js';
import { FakeMdns, mdnsAnswer, mdnsQueryOf } from './helpers.js';

const interfaces = () => ({
  lo: [{ address: '127.0.0.1', family: 'IPv4' as const, internal: true, netmask: '255.0.0.0', mac: '', cidr: null }],
  wlan0: [
    { address: '192.168.4.10', family: 'IPv4' as const, internal: false, netmask: '255.255.255.0', mac: '', cidr: null },
    { address: 'fe80::1', family: 'IPv6' as const, internal: false, netmask: 'ffff::', mac: '', cidr: null, scopeid: 3 },
  ],
  eth0: [{ address: '10.0.0.7', family: 'IPv4' as const, internal: false, netmask: '255.0.0.0', mac: '', cidr: null }],
});
const ADDRESSES = ['192.168.4.10', '10.0.0.7'];

/** The Pi: its name resolves to 127.0.0.1 through /etc/hosts, so only multicast DNS can confirm it. */
function pi(mdns: FakeMdns, extra: Partial<AddressDeps> = {}): AddressDeps & { lookups: string[] } {
  const lookups: string[] = [];
  return {
    hostname: () => 'homebridge', interfaces, createSocket: mdns.factory, mdnsWaitMs: 30,
    lookup: async (n) => {
      lookups.push(n);
      return [{ address: '127.0.0.1', family: 4 }];
    },
    lookups,
    ...extra,
  };
}

/** Answers each query with the given A records, echoing its id and question. */
function answering(records: Array<{ name: string; address: string }>, opts: { compress?: boolean } = {}) {
  return (query: Buffer): Buffer[] => {
    const { id, name } = mdnsQueryOf(query);
    return [mdnsAnswer(id, name, records, opts)];
  };
}

test('the query: one multicast DNS question, type A, class IN, for the lower-case name, sent to 224.0.0.251:5353', async () => {
  const mdns = new FakeMdns();
  await inputAddresses(pi(mdns, { hostname: () => 'HomeBridge.lan' }));
  assert.equal(mdns.sent.length, 1, 'one query');
  const { msg, port, address } = mdns.sent[0];
  assert.deepEqual([address, port], [MDNS_ADDRESS, MDNS_PORT]);
  assert.deepEqual([address, port], ['224.0.0.251', 5353]);
  const { id, name } = mdnsQueryOf(msg);
  assert.equal(name, 'homebridge.local', 'the host name up to its first dot, in lower case');
  assert.ok(id > 0 && id < 0x10000);
  assert.deepEqual([...msg.subarray(2, 12)], [0, 0, 0, 1, 0, 0, 0, 0, 0, 0], 'a standard query with one question');
  assert.deepEqual([...msg.subarray(msg.length - 4)], [0, 1, 0, 1], 'type A, class IN');
  assert.equal(mdns.closed, 1, 'the socket is closed');
  assert.deepEqual(mdnsQuery('homebridge.local', 7)?.subarray(12), Buffer.from('\x0ahomebridge\x05local\x00\x00\x01\x00\x01', 'latin1'));
  assert.equal(mdnsQuery(`${'x'.repeat(64)}.local`, 7), null, 'a label DNS cannot carry');
});

test('an answer with the host\'s own address confirms the name, without dns.lookup', async () => {
  const mdns = new FakeMdns();
  mdns.answer = answering([{ name: 'homebridge.local', address: '192.168.4.10' }]);
  const deps = pi(mdns);
  assert.deepEqual(await inputAddresses(deps), { hostname: 'homebridge.local', addresses: ADDRESSES });
  assert.deepEqual(deps.lookups, [], 'no fallback needed');
  mdns.answer = answering([{ name: 'HOMEBRIDGE.local', address: '10.0.0.7' }]);
  assert.equal((await inputAddresses(pi(mdns))).hostname, 'homebridge.local', 'names compare without regard to case; any own address');
});

test('an answer with another address only, or for another name, does not confirm it; dns.lookup is asked next', async () => {
  const mdns = new FakeMdns();
  mdns.answer = answering([{ name: 'homebridge.local', address: '192.168.4.99' }]);
  const deps = pi(mdns);
  assert.deepEqual(await inputAddresses(deps), { hostname: null, addresses: ADDRESSES });
  assert.deepEqual(deps.lookups, ['homebridge.local']);
  mdns.answer = answering([{ name: 'other.local', address: '192.168.4.10' }]);
  assert.equal((await inputAddresses(pi(mdns))).hostname, null, 'an own address under another name');
  mdns.answer = (query) => {
    const { id, name } = mdnsQueryOf(query);
    return [mdnsAnswer(id + 1, name, [{ name, address: '192.168.4.10' }])];
  };
  assert.equal((await inputAddresses(pi(mdns))).hostname, null, 'an answer to another query');
});

test('no answer: the answers are waited for, then dns.lookup is asked', async () => {
  const mdns = new FakeMdns();
  const deps = pi(mdns, { mdnsWaitMs: 60 });
  const started = Date.now();
  assert.equal((await inputAddresses(deps)).hostname, null);
  assert.ok(Date.now() - started >= 50, 'the wait');
  assert.deepEqual(deps.lookups, ['homebridge.local']);
  assert.equal(mdns.closed, 1);
});

test('a malformed packet is ignored and never throws; a good answer after it still confirms', async () => {
  const mdns = new FakeMdns();
  mdns.answer = (query) => {
    const { id, name } = mdnsQueryOf(query);
    const good = mdnsAnswer(id, name, [{ name, address: '192.168.4.10' }]);
    const loop = Buffer.from(good);
    loop.writeUInt16BE(0xc00c, 12); // the question's name points at itself
    return [Buffer.from([1, 2, 3]), good.subarray(0, good.length - 3), loop, Buffer.alloc(12), good];
  };
  assert.equal((await inputAddresses(pi(mdns))).hostname, 'homebridge.local');
  for (const bad of [Buffer.alloc(0), Buffer.from([0, 7, 0x84, 0, 0, 0, 0, 9, 0, 0, 0, 0]), Buffer.from('not dns at all, but long enough')]) {
    assert.deepEqual(mdnsARecords(bad, 7), []);
  }
});

test('a compressed name in the answer is followed', async () => {
  const mdns = new FakeMdns();
  mdns.answer = answering([{ name: 'homebridge.local', address: '192.168.4.10' }], { compress: true });
  assert.equal((await inputAddresses(pi(mdns))).hostname, 'homebridge.local');
  const packet = mdnsAnswer(9, 'homebridge.local', [{ name: 'homebridge.local', address: '192.168.4.10' }], { compress: true });
  assert.deepEqual(mdnsARecords(packet, 9), [{ name: 'homebridge.local', address: '192.168.4.10' }]);
});

test('a socket error, or no socket at all, means no confirmation from multicast DNS', async () => {
  const mdns = new FakeMdns();
  mdns.error = new Error('EACCES');
  const deps = pi(mdns, { mdnsWaitMs: 5000 });
  const started = Date.now();
  assert.equal((await inputAddresses(deps)).hostname, null);
  assert.ok(Date.now() - started < 1000, 'the error ends the wait');
  assert.deepEqual(deps.lookups, ['homebridge.local']);
  const thrown = await inputAddresses({ ...pi(mdns), createSocket: () => {
    throw new Error('no sockets here');
  } });
  assert.equal(thrown.hostname, null);
});

test('the dns.lookup fallback confirms a name that resolves to an own address, and nothing else', async () => {
  const silent = new FakeMdns();
  const base = { hostname: () => 'homebridge', interfaces, createSocket: silent.factory, mdnsWaitMs: 10 };
  assert.deepEqual(await inputAddresses({ ...base, lookup: async () => [{ address: 'fe80::1', family: 6 }] }),
    { hostname: 'homebridge.local', addresses: ADDRESSES }, 'an own IPv6 address');
  assert.equal((await inputAddresses({ ...base, lookup: async () => [{ address: '192.168.4.99', family: 4 }] })).hostname, null);
  assert.equal((await inputAddresses({ ...base, lookup: async () => [{ address: '127.0.0.1', family: 4 }] })).hostname, null, 'not an internal one');
  assert.equal((await inputAddresses({ ...base, lookup: async () => Promise.reject(new Error('ENOTFOUND')) })).hostname, null);
  const started = Date.now();
  assert.equal((await inputAddresses({ ...base, lookup: () => new Promise(() => undefined), timeoutMs: 30 })).hostname, null);
  assert.ok(Date.now() - started < 1000, 'the timeout ends the wait');
});

test('only the first label of the host name is used; with no IPv4 address there is no query', async () => {
  const mdns = new FakeMdns();
  const names: string[] = [];
  await inputAddresses({ hostname: () => 'pi.lan', interfaces, createSocket: mdns.factory, mdnsWaitMs: 10, lookup: async (n) => {
    names.push(n);
    return [];
  } });
  assert.deepEqual(names, ['pi.local']);
  const before = mdns.sent.length;
  const v6only = () => ({ wlan0: [{ address: 'fd00::5', family: 'IPv6' as const, internal: false, netmask: 'ffff::', mac: '', cidr: null, scopeid: 0 }] });
  const found = await inputAddresses({
    hostname: () => 'pi', interfaces: v6only, createSocket: mdns.factory, lookup: async () => [{ address: 'fd00::5', family: 6 }],
  });
  assert.deepEqual(found, { hostname: 'pi.local', addresses: [] });
  assert.equal(mdns.sent.length, before, 'no IPv4 address to confirm');
  assert.deepEqual(await inputAddresses({ hostname: () => '', interfaces, createSocket: mdns.factory }), { hostname: null, addresses: ADDRESSES });
  assert.deepEqual(await inputAddresses({ interfaces, hostname: () => {
    throw new Error('no host name');
  } }), { hostname: null, addresses: ADDRESSES }, 'any error means no host name');
});

test('the cache keeps a result for 10 minutes and checks once at a time', async () => {
  const mdns = new FakeMdns();
  mdns.answer = answering([{ name: 'homebridge.local', address: '192.168.4.10' }]);
  let now = 1_000_000;
  const cache = new AddressCache(pi(mdns), () => now);
  const [a, b] = await Promise.all([cache.get(), cache.get()]);
  assert.equal(a.hostname, 'homebridge.local');
  assert.equal(b, a);
  assert.equal(mdns.sent.length, 1, 'one check for both');
  mdns.answer = () => [];
  now += ADDRESS_CACHE_MS - 1;
  assert.equal((await cache.get()).hostname, 'homebridge.local', 'still cached');
  assert.equal(mdns.sent.length, 1);
  now += 1;
  assert.equal((await cache.get()).hostname, null, 'checked again after 10 minutes');
  assert.equal(mdns.sent.length, 2);
  assert.equal(ADDRESS_CACHE_MS, 600_000);
});

test('addresses and the setup code, with an IPv6 address in brackets', () => {
  assert.equal(inputUrl('homebridge.local', 8582), 'http://homebridge.local:8582');
  assert.equal(inputUrl('fd00::5', 8582), 'http://[fd00::5]:8582');
  assert.equal(setupCode('fd00::5', 8582, 'k'.repeat(43), 'q3Lr8vT0cXw2mN5a'), `busylight://[fd00::5]:8582/?key=${'k'.repeat(43)}&id=q3Lr8vT0cXw2mN5a`);
  assert.equal(preferredHost({ hostname: null, addresses: ['192.168.4.10', '10.0.0.7'] }), '192.168.4.10');
  assert.equal(preferredHost({ hostname: 'homebridge.local', addresses: ['192.168.4.10'] }), 'homebridge.local');
  assert.equal(preferredHost({ hostname: null, addresses: [] }), null);
});
