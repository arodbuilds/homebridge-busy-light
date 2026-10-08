import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatVolts, hhmmTo12h, relativeTime } from '../homebridge-ui/src/format.js';
import { emptyConfig, exportConfig, overrideFor, readConfig, setOverride } from '../homebridge-ui/src/model.js';
import { validate } from '../homebridge-ui/src/validate.js';

describe('settings page: platform block (SPEC section 9)', () => {
  it('reads defaults for a missing or empty block', () => {
    const c = readConfig(undefined);
    assert.deepEqual(c, emptyConfig());
    assert.equal(c.exerciseSensor, true);
    assert.equal(c.exerciseHoldMinutes, 5);
    assert.equal(c.exerciseTime, '');
  });

  it('keeps keys it does not edit, such as the host\'s _bridge and credentialsPath, and writes them back', () => {
    const raw = {
      platform: 'Generac', name: 'Gen', pollIdleMinutes: '15', batteryLowVoltage: 12.2, exerciseTime: '10:00', debug: true,
      generators: [{ apparatusId: 1, name: ' Basement ' }, { apparatusId: 'x', name: 'bad' }, { apparatusId: 2, name: '' }],
      _bridge: { username: '0E:AA', port: 1 }, credentialsPath: '/etc/generac/creds.json',
    };
    const c = readConfig(raw);
    assert.equal(c.name, 'Gen');
    assert.equal(c.pollIdleMinutes, 15);
    assert.equal(c.batteryLowVoltage, 12.2);
    assert.equal(c.debug, true);
    assert.deepEqual(c.generators, [{ apparatusId: 1, name: 'Basement' }]);
    assert.deepEqual(c.extra, { _bridge: { username: '0E:AA', port: 1 }, credentialsPath: '/etc/generac/creds.json' });
    const block = exportConfig(c);
    assert.deepEqual(block, {
      _bridge: { username: '0E:AA', port: 1 }, credentialsPath: '/etc/generac/creds.json',
      platform: 'Generac', name: 'Gen', pollIdleMinutes: 15, pollActiveSeconds: 90, batteryLowVoltage: 12.2, faultOnStopped: true,
      faultOnDisconnected: false, attentionSensor: false, exerciseSensor: true, exerciseHoldMinutes: 5, debug: true, exerciseTime: '10:00',
      generators: [{ apparatusId: 1, name: 'Basement' }],
    });
    assert.equal('exerciseTime' in exportConfig(emptyConfig()), false, 'an empty exercise time is left out so the API value applies');
    assert.equal('generators' in exportConfig(emptyConfig()), false);
  });

  it('Rename sets an override and clears it for the Mobile Link name', () => {
    const c = emptyConfig();
    setOverride(c, 7, ' Basement ', 'Blue Door');
    assert.equal(overrideFor(c, 7), 'Basement');
    setOverride(c, 7, 'Blue Door', 'Blue Door');
    assert.equal(overrideFor(c, 7), undefined);
    setOverride(c, 7, '', 'Blue Door');
    assert.deepEqual(c.generators, []);
  });
});

describe('settings page: validation (SPEC section 11.3 E)', () => {
  it('the low battery threshold takes one decimal place: 12, 12.0 and 11.8 pass, 12.05 is rejected', () => {
    for (const ok of [12, 12.0, 11.8, 13.6]) {
      assert.deepEqual(validate({ ...emptyConfig(), batteryLowVoltage: ok }), [], `${ok} passes`);
    }
    assert.deepEqual(validate({ ...emptyConfig(), batteryLowVoltage: 12.05 }),
      [{ path: 'batteryLowVoltage', message: 'Enter volts with one decimal place, for example 12.0.' }]);
    assert.equal(formatVolts(12), '12.0');
    assert.equal(formatVolts(11.8), '11.8');
  });

  it('passes the defaults and reports each rule with its message', () => {
    assert.deepEqual(validate(emptyConfig()), []);
    const c = {
      ...emptyConfig(), name: ' ', pollIdleMinutes: 1, pollActiveSeconds: 59, batteryLowVoltage: Number.NaN, exerciseTime: '10', exerciseHoldMinutes: 0,
    };
    assert.deepEqual(validate(c), [
      { path: 'name', message: 'Name is required.' },
      { path: 'pollIdleMinutes', message: 'Minimum is 2 minutes.' },
      { path: 'pollActiveSeconds', message: 'Minimum is 60 seconds.' },
      { path: 'batteryLowVoltage', message: 'Low battery threshold (volts) is required.' },
      { path: 'exerciseTime', message: 'Enter a time as HH:MM, for example 10:00.' },
      { path: 'exerciseHoldMinutes', message: 'Minimum is 1 minute.' },
    ]);
    assert.deepEqual(validate({ ...emptyConfig(), pollIdleMinutes: Number.NaN }), [
      { path: 'pollIdleMinutes', message: 'Poll interval while idle (minutes) is required.' },
    ]);
    assert.deepEqual(validate({ ...emptyConfig(), exerciseTime: '23:59' }), []);
    assert.deepEqual(validate({ ...emptyConfig(), exerciseTime: '24:00' }).map((i) => i.path), ['exerciseTime']);
  });
});

describe('settings page: formatting', () => {
  it('relative times', () => {
    const now = new Date('2026-09-15T16:00:00Z');
    const ago = (s: number): Date => new Date(now.getTime() - s * 1000);
    assert.equal(relativeTime(ago(10), now), 'just now');
    assert.equal(relativeTime(ago(60), now), '1 minute ago');
    assert.equal(relativeTime(ago(125), now), '2 minutes ago');
    assert.equal(relativeTime(ago(3600), now), '1 hour ago');
    assert.equal(relativeTime(ago(5 * 3600), now), '5 hours ago');
    assert.equal(relativeTime(ago(26 * 3600), now), '1 day ago');
    assert.equal(relativeTime(ago(3 * 86400), now), '3 days ago');
  });

  it('12-hour exercise times and volts', () => {
    assert.equal(hhmmTo12h('10:00'), '10:00 AM');
    assert.equal(hhmmTo12h('00:05'), '12:05 AM');
    assert.equal(hhmmTo12h('13:30'), '1:30 PM');
    assert.equal(hhmmTo12h('12:00'), '12:00 PM');
    assert.equal(hhmmTo12h('9'), null);
    assert.equal(hhmmTo12h(null), null);
    assert.equal(formatVolts(13.6), '13.6');
    assert.equal(formatVolts(12), '12.0');
    assert.equal(formatVolts(11.87), '11.9');
  });
});
