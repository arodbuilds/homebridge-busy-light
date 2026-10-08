#!/usr/bin/env node
/**
 * homebridge-generac CLI
 *
 *   homebridge-generac login [--out <file>] [--debug]   sign in once, save refresh token
 *   homebridge-generac status [--creds <file>]           print what the account exposes
 *
 * Run `login` as the same user Homebridge runs as so the credentials land where
 * the platform looks for them. With `--debug`, a failed sign-in step's page is
 * saved, redacted, to a `debug` folder next to the credentials file (SPEC section 12).
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { extractAuth0ErrorCode, login, redactBody, type MfaType } from './auth.js';
import { MobileLinkClient, readCredentials, writeCredentials } from './api.js';
import { writeFileAtomic } from './files.js';
import { toGeneratorState } from './model.js';
import { credentialCandidates, defaultStoragePath, primaryCredentialsPath } from './settings.js';
import { DEVICE_TYPE, DEVICE_TYPE_LABEL } from './types.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function log(step: string, msg: string): void {
  console.error(`  ${step.padEnd(14)} ${msg}`);
}

async function prompt(question: string, hidden = false): Promise<string> {
  if (hidden && !process.stdin.isTTY) {
    console.error('Refusing to read a password without a terminal (it would echo in the clear). Use `ssh -t`.');
    process.exit(2);
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr, terminal: true });
  if (hidden) {
    const anyRl = rl as unknown as { _writeToOutput: (s: string) => void };
    const orig = anyRl._writeToOutput;
    anyRl._writeToOutput = function (s: string) {
      if (s.includes(question)) {
        orig.call(rl, s);
      } else {
        orig.call(rl, '*');
      }
    };
  }
  const answer = await new Promise<string>((res) => rl.question(question, res));
  rl.close();
  if (hidden) {
    process.stderr.write('\n');
  }
  return answer.trim();
}

/**
 * What `login` does with the page of a failed sign-in step. Without `--debug` it prints the step, the HTTP status
 * and the Auth0 error code. With `--debug` it also saves the page, redacted, as `<step>-<status>.html` (mode 600) in
 * a `debug` folder (mode 700) next to the credentials file: `<storage>/homebridge-generac/debug/` by default.
 * Nothing is ever written to the working directory.
 */
function failureBodySink(out: string, debug: boolean): (step: string, status: number, body: string) => void {
  return (step, status, body) => {
    const code = extractAuth0ErrorCode(body);
    log(step, `HTTP ${status}${code ? ` (auth0: ${code})` : ''}`);
    if (!debug) {
      return;
    }
    const dir = path.join(path.dirname(out), 'debug');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.chmodSync(dir, 0o700);
    const f = path.join(dir, `${step}-${status}.html`);
    writeFileAtomic(f, redactBody(body), 0o600);
    log('debug', `saved the server response, redacted, to ${f}`);
  };
}

async function cmdLogin(): Promise<void> {
  const out = arg('--out') ?? primaryCredentialsPath(defaultStoragePath());
  const debug = process.argv.includes('--debug');
  const email = process.env.GENERAC_EMAIL || (await prompt('Mobile Link email: '));
  const password = process.env.GENERAC_PASSWORD || (await prompt('Mobile Link password: ', true));

  console.error(`\nSigning in to Mobile Link as ${email}…`);
  const result = await login(email, password, {
    log,
    mfaPrompt: async (type: MfaType) => prompt(`Enter the ${type.toUpperCase()} code you just received: `),
    onFailureBody: failureBodySink(out, debug),
  });

  writeCredentials(out, {
    email,
    refresh_token: result.refreshToken,
    dpop_private_key_pem: result.key.toPem(),
    created_at: new Date().toISOString(),
  });

  console.error(`\nSaved credentials to ${out} (mode 600).`);
  console.error('The password was not stored. Homebridge will use the refresh token from now on.\n');
  console.error('Add this platform to your Homebridge config if you have not already:\n');
  console.error(JSON.stringify({ platform: 'Generac', name: 'Generac' }, null, 2));
  console.error('');
}

async function cmdStatus(): Promise<void> {
  const explicit = arg('--creds');
  const candidates = credentialCandidates(defaultStoragePath(), explicit);
  const file = candidates.find((f) => fs.existsSync(f));
  if (!file) {
    console.error(`No credentials found. Looked in:\n  ${candidates.join('\n  ')}\nRun \`homebridge-generac login\` first.`);
    process.exit(1);
  }
  const creds = readCredentials(file)!;
  console.error(`Using ${file} (${creds.email})`);
  const client = MobileLinkClient.fromCredentials(creds, { log });

  const list = await client.listApparatus();
  const out: unknown[] = [];
  for (const raw of list) {
    const label = DEVICE_TYPE_LABEL[raw.type] ?? `type ${raw.type}`;
    if (raw.type !== DEVICE_TYPE.GENERATOR) {
      out.push({ apparatusId: raw.apparatusId, name: raw.name, type: `${raw.type} (${label})`, exposed: false });
      continue;
    }
    try {
      const d = await client.apparatusDetails(raw.apparatusId);
      out.push(d ? toGeneratorState(d, raw, { faultOnStopped: true, faultOnDisconnected: false }) : { apparatusId: raw.apparatusId, error: 'no details' });
    } catch (err) {
      out.push({ apparatusId: raw.apparatusId, name: raw.name, error: (err as Error).message });
    }
  }
  console.log(JSON.stringify(out, null, 2));
}

const cmd = process.argv[2];
const run = cmd === 'login' ? cmdLogin : cmd === 'status' ? cmdStatus : null;
if (!run) {
  console.error('Usage: homebridge-generac <login [--out file] [--debug] | status [--creds file]>');
  process.exit(2);
}
run().catch((err) => {
  console.error(`\nFAILED: ${(err as Error).message}`);
  process.exit(1);
});
