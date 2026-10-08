/**
 * The address change notice (SPEC 18.11 item 6, 15 item 23): what the plugin records, when it warns, and that a host
 * name never warns. The host's network is replaced: no test sends UDP or asks a resolver.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ADDRESS_CHECK_MS, AddressWatcher } from '../src/address-watch.js';
import type { AddressDeps } from '../src/addresses.js';
import { addressChanged } from '../src/messages.js';
import { FakeMdns, fakeLog, mdnsAnswer, mdnsQueryOf } from './helpers.js';

const T0 = Date.parse('2026-10-08T15:00:00Z');

/** The host with `ip` as its only network address; with `named`, multicast DNS confirms homebridge.local. */
function network(ip: string, named = false): AddressDeps {
  const mdns = new FakeMdns();
  if (named) {
    mdns.answer = (query) => {
      const { id, name } = mdnsQueryOf(query);
      return [mdnsAnswer(id, name, [{ name, address: ip }])];
    };
  }
  return {
    hostname: () => 'homebridge',
    interfaces: () => ({ eth0: [{ address: ip, family: 'IPv4', internal: false, netmask: '255.255.255.0', mac: '', cidr: null }] }),
    createSocket: mdns.factory, mdnsWaitMs: 5, lookup: async () => [{ address: '127.0.0.1', family: 4 }],
  };
}

test('the first check records the first IPv4 address without a warning', async () => {
  const log = fakeLog();
  let changes = 0;
  const watcher = new AddressWatcher({ log: log.log, addresses: network('192.168.4.10'), now: () => T0, onChange: () => changes++ });
  await watcher.check();
  assert.deepEqual(watcher.record(), { advertised: '192.168.4.10', addressChange: null });
  assert.deepEqual(log.lines('warn'), []);
  assert.equal(changes, 1, 'the state file is written');
});

test('a new IPv4 address with no host name warns once and records the change', async () => {
  const log = fakeLog();
  const previous = { advertised: '192.168.4.10', addressChange: null };
  const watcher = new AddressWatcher({ log: log.log, previous, addresses: network('192.168.4.23'), now: () => T0 });
  await watcher.check();
  await watcher.check();
  assert.deepEqual(log.lines('warn'), [addressChanged('192.168.4.10', '192.168.4.23')], 'once per change');
  assert.equal(log.lines('warn')[0], 'Homebridge\'s address changed from 192.168.4.10 to 192.168.4.23. Apps that use the old address need the new setup code.');
  assert.deepEqual(watcher.record(), {
    advertised: '192.168.4.23',
    addressChange: { from: '192.168.4.10', to: '192.168.4.23', at: new Date(T0).toISOString() },
  });
});

test('a host name never warns: when one is confirmed, and when one was recorded and the network no longer confirms it', async () => {
  const log = fakeLog();
  const named = new AddressWatcher({ log: log.log, previous: { advertised: '192.168.4.10' }, addresses: network('192.168.4.23', true), now: () => T0 });
  await named.check();
  assert.deepEqual(named.record(), { advertised: 'homebridge.local', addressChange: null });
  const unnamed = new AddressWatcher({ log: log.log, previous: { advertised: 'homebridge.local' }, addresses: network('192.168.4.23'), now: () => T0 });
  await unnamed.check();
  assert.deepEqual(unnamed.record(), { advertised: '192.168.4.23', addressChange: null });
  assert.deepEqual(log.lines('warn'), []);
});

test('the previous record is kept as it was read, and a bad one is ignored', async () => {
  const change = { from: '192.168.4.9', to: '192.168.4.10', at: '2026-10-07T09:00:00.000Z' };
  const kept = new AddressWatcher({ log: fakeLog().log, previous: { advertised: '192.168.4.10', addressChange: change }, addresses: network('192.168.4.10') });
  await kept.check();
  assert.deepEqual(kept.record(), { advertised: '192.168.4.10', addressChange: change }, 'nothing changed, nothing new');
  const bad = new AddressWatcher({ log: fakeLog().log, previous: { advertised: 5 as unknown as string, addressChange: { from: 1 } as never } });
  assert.deepEqual(bad.record(), { advertised: null, addressChange: null });
});

test('start checks at once and every 10 minutes; stop ends it', async () => {
  const watcher = new AddressWatcher({ log: fakeLog().log, addresses: network('192.168.4.10') });
  let checks = 0;
  watcher.check = async () => {
    checks++;
  };
  watcher.start();
  assert.equal(checks, 1);
  watcher.stop();
  assert.equal(ADDRESS_CHECK_MS, 600_000);
});
