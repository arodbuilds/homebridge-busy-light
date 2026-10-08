/** Finding Busy Light by name (SPEC 18.11), with the host's interfaces and dns.lookup replaced. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inputAddresses, inputUrl, preferredHost, setupCode } from '../src/addresses.js';
import type { AddressDeps } from '../src/addresses.js';

const interfaces = () => ({
  lo: [{ address: '127.0.0.1', family: 'IPv4' as const, internal: true, netmask: '255.0.0.0', mac: '', cidr: null }],
  wlan0: [
    { address: '192.168.4.10', family: 'IPv4' as const, internal: false, netmask: '255.255.255.0', mac: '', cidr: null },
    { address: 'fe80::1', family: 'IPv6' as const, internal: false, netmask: 'ffff::', mac: '', cidr: null, scopeid: 3 },
  ],
  eth0: [{ address: '10.0.0.7', family: 'IPv4' as const, internal: false, netmask: '255.0.0.0', mac: '', cidr: null }],
});

test('a .local name that resolves to one of the host\'s own addresses is the host name; the IPv4 addresses are always listed', async () => {
  const names: string[] = [];
  const deps: AddressDeps = { hostname: () => 'homebridge', interfaces, lookup: async (n) => {
    names.push(n);
    return [{ address: 'fe80::1', family: 6 }];
  } };
  assert.deepEqual(await inputAddresses(deps), { hostname: 'homebridge.local', addresses: ['192.168.4.10', '10.0.0.7'] });
  assert.deepEqual(names, ['homebridge.local']);
});

test('a name that resolves elsewhere, fails, or times out gives no host name', async () => {
  const base = { hostname: () => 'homebridge', interfaces };
  assert.equal((await inputAddresses({ ...base, lookup: async () => [{ address: '192.168.4.99', family: 4 }] })).hostname, null);
  assert.equal((await inputAddresses({ ...base, lookup: async () => [{ address: '127.0.0.1', family: 4 }] })).hostname, null, 'not an internal one');
  assert.equal((await inputAddresses({ ...base, lookup: async () => Promise.reject(new Error('ENOTFOUND')) })).hostname, null);
  const started = Date.now();
  assert.equal((await inputAddresses({ ...base, lookup: () => new Promise(() => undefined), timeoutMs: 30 })).hostname, null);
  assert.ok(Date.now() - started < 1000, 'the timeout ends the wait');
});

test('only the first label of the host name is used', async () => {
  const names: string[] = [];
  await inputAddresses({ hostname: () => 'pi.lan', interfaces, lookup: async (n) => {
    names.push(n);
    return [];
  } });
  assert.deepEqual(names, ['pi.local']);
});

test('addresses and the setup code, with an IPv6 address in brackets', () => {
  assert.equal(inputUrl('homebridge.local', 8582), 'http://homebridge.local:8582');
  assert.equal(inputUrl('fd00::5', 8582), 'http://[fd00::5]:8582');
  assert.equal(setupCode('fd00::5', 8582, 'k'.repeat(43), 'q3Lr8vT0cXw2mN5a'), `busylight://[fd00::5]:8582/?key=${'k'.repeat(43)}&id=q3Lr8vT0cXw2mN5a`);
  assert.equal(preferredHost({ hostname: null, addresses: ['192.168.4.10', '10.0.0.7'] }), '192.168.4.10');
  assert.equal(preferredHost({ hostname: 'homebridge.local', addresses: ['192.168.4.10'] }), 'homebridge.local');
  assert.equal(preferredHost({ hostname: null, addresses: [] }), null);
});
