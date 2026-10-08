import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { readCredentials, writeCredentials } from '../src/api.js';
import { AuthError, DPoPKey, type LoginOptions, type LoginResult, type MfaType } from '../src/auth.js';
import { dataDir, primaryCredentialsPath, RESET_MARKER, statePath } from '../src/settings.js';
import { buildStateFile, readStateFile, toGeneratorSnapshot, writeStateFile } from '../src/state.js';
import { toGeneratorState } from '../src/model.js';
import { GeneracUiHandlers, MAX_CODE_ATTEMPTS, mapError, PENDING_LOGIN_TTL_MS } from '../src/ui/server.js';
import { loadFixture, makeCredentials, tmpDir } from './helpers.js';

const KEY = DPoPKey.generate();
const RESULT: LoginResult = { key: KEY, refreshToken: 'refresh-from-login', tokens: { access_token: 'a', expires_in: 7200, token_type: 'Bearer' } };

/** A scripted Mobile Link login: the outcome per step, driven the way auth.ts drives the real one. */
interface Script {
  /** Thrown before any MFA prompt (a password or identifier failure, an unsupported factor, a network error). */
  fail?: Error;
  /** The MFA method Auth0 asks for; absent means no MFA. */
  mfa?: MfaType;
  /** The codes Auth0 accepts. */
  accepts?: string[];
  /** Resolves after the password step so a test can observe the in-flight state. */
  hold?: Promise<void>;
}

function scriptedLogin(script: Script) {
  const calls: Array<{ email: string; password: string }> = [];
  const fn = async (email: string, password: string, opts: LoginOptions): Promise<LoginResult> => {
    calls.push({ email, password });
    await script.hold;
    if (script.fail) {
      throw script.fail;
    }
    if (!script.mfa) {
      return RESULT;
    }
    for (let tries = 0; tries < 3; tries++) {
      const code = await opts.mfaPrompt(script.mfa, tries + 1);
      if ((script.accepts ?? []).includes(code)) {
        return RESULT;
      }
    }
    throw new AuthError('mfa: three rejected codes', 'mfa');
  };
  return { fn, calls };
}

function setup(script: Script, clock = { t: Date.parse('2026-09-15T16:00:00Z') }) {
  const storage = tmpDir('ui');
  const login = scriptedLogin(script);
  const handlers = new GeneracUiHandlers({ storagePath: storage, login: login.fn, now: () => clock.t, version: '0.1.0-beta.1' });
  return { storage, handlers, login, clock };
}

describe('UI server: Connect flow (SPEC section 10)', () => {
  let active: GeneracUiHandlers | null = null;
  afterEach(async () => {
    await active?.connectCancel();
    active = null;
  });

  it('signs in without MFA and writes credentials.json atomically with mode 600', async () => {
    const { storage, handlers, login, clock } = setup({});
    active = handlers;
    const r = await handlers.connectStart({ email: ' you@example.com ', password: 'pw' });
    assert.deepEqual(r, { step: 'done' });
    assert.deepEqual(login.calls, [{ email: 'you@example.com', password: 'pw' }]);
    const file = primaryCredentialsPath(storage);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    const creds = readCredentials(file)!;
    assert.equal(creds.email, 'you@example.com');
    assert.equal(creds.refresh_token, 'refresh-from-login');
    assert.equal(creds.created_at, new Date(clock.t).toISOString());
    assert.equal(DPoPKey.fromPem(creds.dpop_private_key_pem).thumbprint, KEY.thumbprint);
    assert.deepEqual(fs.readdirSync(path.dirname(file)), ['credentials.json']);
    assert.equal(handlers.hasPending, false);
  });

  it('asks for the SMS code, rejects two wrong codes, then finishes on the right one', async () => {
    const { storage, handlers } = setup({ mfa: 'sms', accepts: ['123456'] });
    active = handlers;
    assert.deepEqual(await handlers.connectStart({ email: 'you@example.com', password: 'pw' }), { step: 'code', method: 'sms' });
    assert.equal(handlers.hasPending, true);
    assert.equal(fs.existsSync(primaryCredentialsPath(storage)), false, 'nothing written before the code');
    assert.deepEqual(await handlers.connectCode({ code: '000000' }), { error: 'wrong_code' });
    assert.deepEqual(await handlers.connectCode({ code: '111111' }), { error: 'wrong_code' });
    assert.deepEqual(await handlers.connectCode({ code: '123456' }), { step: 'done' });
    assert.equal(readCredentials(primaryCredentialsPath(storage))?.email, 'you@example.com');
    assert.equal(handlers.hasPending, false);
  });

  it('three wrong codes end the sign-in with too_many, and a fourth code is expired', async () => {
    const { storage, handlers } = setup({ mfa: 'otp', accepts: ['123456'] });
    active = handlers;
    assert.deepEqual(await handlers.connectStart({ email: 'you@example.com', password: 'pw' }), { step: 'code', method: 'otp' });
    for (let i = 1; i < MAX_CODE_ATTEMPTS; i++) {
      assert.deepEqual(await handlers.connectCode({ code: '0' }), { error: 'wrong_code' });
    }
    assert.deepEqual(await handlers.connectCode({ code: '0' }), { error: 'too_many' });
    assert.equal(handlers.hasPending, false);
    assert.deepEqual(await handlers.connectCode({ code: '123456' }), { error: 'expired' });
    assert.equal(fs.existsSync(primaryCredentialsPath(storage)), false);
  });

  it('maps password, identifier, unsupported factor and other failures to the SPEC error codes', async () => {
    const cases: Array<[Error, string]> = [
      [new AuthError('password: rejected', 'password'), 'wrong_password'],
      [new AuthError('identifier: email not recognized', 'identifier'), 'unknown_email'],
      [new AuthError('resume: MFA factor at /u/mfa-push-challenge cannot be driven', 'mfa'), 'unsupported_factor'],
      [new AuthError('mfa: unsupported follow-on factor /u/mfa-webauthn', 'mfa'), 'unsupported_factor'],
      [new AuthError('token: code exchange failed HTTP 500', 'token'), 'network'],
      [new TypeError('fetch failed'), 'network'],
    ];
    for (const [err, expected] of cases) {
      const { handlers } = setup({ fail: err });
      assert.deepEqual(await handlers.connectStart({ email: 'you@example.com', password: 'pw' }), { error: expected }, err.message);
      assert.equal(handlers.hasPending, false);
    }
    assert.deepEqual(mapError(new AuthError('mfa: three rejected codes', 'mfa'), 'code'), { error: 'too_many' });
    assert.deepEqual(mapError(new TypeError('fetch failed'), 'code'), { error: 'expired' });
  });

  it('a missing email or password never reaches login', async () => {
    const { handlers, login } = setup({});
    assert.deepEqual(await handlers.connectStart({ email: 'you@example.com' }), { error: 'network' });
    assert.deepEqual(await handlers.connectStart({ password: 'pw' }), { error: 'network' });
    assert.deepEqual(await handlers.connectStart(null), { error: 'network' });
    assert.equal(login.calls.length, 0);
    assert.deepEqual(await handlers.connectCode({ code: '1' }), { error: 'expired' }, 'no pending login');
    assert.deepEqual(await handlers.connectCode({}), { error: 'expired' });
  });

  it('the pending code step expires after five minutes', async () => {
    const { storage, handlers, clock } = setup({ mfa: 'email', accepts: ['1'] });
    active = handlers;
    assert.deepEqual(await handlers.connectStart({ email: 'you@example.com', password: 'pw' }), { step: 'code', method: 'email' });
    clock.t += PENDING_LOGIN_TTL_MS;
    assert.deepEqual(await handlers.connectCode({ code: '1' }), { error: 'expired' });
    assert.equal(handlers.hasPending, false);
    assert.equal(fs.existsSync(primaryCredentialsPath(storage)), false);
  });

  it('cancel discards the pending login: a late right code is expired and nothing is written', async () => {
    const { storage, handlers } = setup({ mfa: 'sms', accepts: ['1'] });
    assert.deepEqual(await handlers.connectStart({ email: 'you@example.com', password: 'pw' }), { step: 'code', method: 'sms' });
    assert.deepEqual(await handlers.connectCancel(), { ok: true });
    assert.equal(handlers.hasPending, false);
    assert.deepEqual(await handlers.connectCode({ code: '1' }), { error: 'expired' });
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(fs.existsSync(primaryCredentialsPath(storage)), false);
  });

  it('a second Sign in replaces the first; the first login result is ignored', async () => {
    let release: () => void = () => undefined;
    const hold = new Promise<void>((r) => {
      release = r;
    });
    const storage = tmpDir('ui');
    const first = scriptedLogin({ hold });
    const second = scriptedLogin({ mfa: 'sms', accepts: ['9'] });
    let which = first;
    const handlers = new GeneracUiHandlers({
      storagePath: storage, login: (e, p, o) => which.fn(e, p, o), now: Date.now, version: 'x',
    });
    active = handlers;
    const firstStart = handlers.connectStart({ email: 'a@example.com', password: 'p1' });
    which = second;
    assert.deepEqual(await handlers.connectStart({ email: 'b@example.com', password: 'p2' }), { step: 'code', method: 'sms' });
    assert.deepEqual(await firstStart, { error: 'network' }, 'the replaced request is answered');
    release();
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(fs.existsSync(primaryCredentialsPath(storage)), false, 'the abandoned login writes nothing');
    assert.deepEqual(await handlers.connectCode({ code: '9' }), { step: 'done' });
    assert.equal(readCredentials(primaryCredentialsPath(storage))?.email, 'b@example.com');
  });
});

describe('UI server: /status, /disconnect and /reset (SPEC section 10)', () => {
  const ready = loadFixture('details-generator-ready.json');
  const snapshot = toGeneratorSnapshot(toGeneratorState(ready, undefined, { faultOnStopped: true, faultOnDisconnected: false }));

  it('not_connected without credentials, whatever state.json says', async () => {
    const { storage, handlers } = setup({});
    const others = [{ type: 2, name: 'Tank', apparatusId: 9 }];
    writeStateFile(statePath(storage), buildStateFile({ state: 'connected', email: 'old@example.com' }, [snapshot], others));
    const r = await handlers.status();
    assert.deepEqual(r.account, { state: 'not_connected' });
    assert.equal(r.generators[0].name, 'Blue Door');
    assert.deepEqual(r.others, [{ type: 2, name: 'Tank' }]);
    assert.equal(r.version, '0.1.0-beta.1');
  });

  it('checking while the platform has not polled with these credentials, then the platform state', async () => {
    const { storage, handlers } = setup({});
    writeCredentials(primaryCredentialsPath(storage), makeCredentials({ created_at: '2026-09-15T15:22:34Z' }));
    assert.deepEqual((await handlers.status()).account, { state: 'checking', email: 'you@example.com' }, 'no state file');

    writeStateFile(statePath(storage), buildStateFile({ state: 'not_connected' }, [], [], new Date('2026-09-15T15:20:00Z')));
    assert.equal((await handlers.status()).account.state, 'checking', 'older state');
    writeStateFile(statePath(storage), buildStateFile({ state: 'not_connected' }, [], [], new Date('2026-09-15T15:30:00Z')));
    assert.equal((await handlers.status()).account.state, 'checking', 'newer but not_connected: the platform has not used them');

    const connected = { state: 'connected' as const, email: 'you@example.com', lastChecked: '2026-09-15T15:30:00Z' };
    writeStateFile(statePath(storage), buildStateFile(connected, [snapshot], [], new Date('2026-09-15T15:30:00Z')));
    assert.deepEqual((await handlers.status()).account, connected);

    const revoked = { state: 'reconnect_needed' as const, email: 'you@example.com' };
    writeStateFile(statePath(storage), buildStateFile(revoked, [snapshot], [], new Date('2026-09-15T15:40:00Z')));
    assert.equal((await handlers.status()).account.state, 'reconnect_needed');
  });

  it('reads credentialsPath from config.json', async () => {
    const storage = tmpDir('ui');
    const explicit = path.join(tmpDir('explicit'), 'creds.json');
    writeCredentials(explicit, makeCredentials({ email: 'explicit@example.com' }));
    const configPath = path.join(storage, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({ platforms: [{ platform: 'Generac', credentialsPath: explicit }] }));
    const handlers = new GeneracUiHandlers({ storagePath: storage, configPath, login: scriptedLogin({}).fn, version: 'x' });
    assert.equal((await handlers.status()).account.email, 'explicit@example.com');
    assert.deepEqual(await handlers.disconnect(), { ok: true });
    assert.equal(fs.existsSync(explicit), false, 'disconnect deletes the file in use');
  });

  it('disconnect deletes credentials.json and clears the account section of state.json', async () => {
    const { storage, handlers, clock } = setup({});
    writeCredentials(primaryCredentialsPath(storage), makeCredentials());
    const account = { state: 'connected' as const, email: 'you@example.com', lastChecked: 'x' };
    writeStateFile(statePath(storage), buildStateFile(account, [snapshot], [{ type: 7, name: 'T', apparatusId: 1 }]));
    assert.deepEqual(await handlers.disconnect(), { ok: true });
    assert.equal(fs.existsSync(primaryCredentialsPath(storage)), false);
    const state = readStateFile(statePath(storage))!;
    assert.deepEqual(state.account, { state: 'not_connected' });
    assert.equal(state.generators.length, 1, 'generator states are kept for the page');
    assert.equal(state.others.length, 1);
    assert.equal(state.updatedAt, new Date(clock.t).toISOString());
    assert.deepEqual((await handlers.status()).account, { state: 'not_connected' });
    assert.deepEqual(await handlers.disconnect(), { ok: true }, 'idempotent');
  });

  it('reset signs out, forgets the state and leaves the marker for the platform', async () => {
    const { storage, handlers } = setup({});
    writeCredentials(primaryCredentialsPath(storage), makeCredentials());
    writeStateFile(statePath(storage), buildStateFile({ state: 'connected' }, [snapshot], []));
    assert.deepEqual(await handlers.reset(), { ok: true });
    assert.equal(fs.existsSync(primaryCredentialsPath(storage)), false);
    assert.equal(fs.existsSync(statePath(storage)), false);
    assert.equal(fs.existsSync(path.join(dataDir(storage), RESET_MARKER)), true);
  });

  it('routes cover the SPEC section 10 endpoints', () => {
    const { handlers } = setup({});
    assert.deepEqual(Object.keys(handlers.routes()).sort(), ['/connect/cancel', '/connect/code', '/connect/start', '/disconnect', '/reset', '/status']);
  });
});
