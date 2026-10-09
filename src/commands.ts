/**
 * The command line tool of SPEC 10.2: status, check, login, lights, light, input and help. It follows the plugin's
 * logging rules (SPEC 12): no password, token, device code, calendar address or event content is ever printed;
 * events are shown as times and showAs only. The status input key is printed only inside the setup code, after its
 * warning line.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inputAddresses, inputUrl, preferredHost, setupCode } from './addresses.js';
import type { AddressDeps } from './addresses.js';
import { SOURCE_TYPE_NAMES, isIPv4, normalizeColor, ownerAddresses, parseConfig } from './config.js';
import type { BusyLightConfig } from './config.js';
import { ensureStorageDir, readJson } from './files.js';
import { sendTestReport } from './input-client.js';
import { LifxClient } from './lifx.js';
import { LightController, matchesBulb } from './light.js';
import type { Log } from './log.js';
import {
  bulbName, bulbNotNamed, bulbSilent, count, formatTime, microsoftCode, noBulb, noCalendars, notWorkingLine, statusLine, statusUnknown,
  validation,
} from './messages.js';
import { MicrosoftAuth, TokenStore, tokenFile } from './microsoft.js';
import { STATUS_NAMES, isStatusKey } from './model.js';
import { PLATFORM_NAME, STORAGE_DIR } from './names.js';
import { SourceRunner } from './sources.js';
import type { SourceState } from './sources.js';
import { readState } from './state.js';
import { readInstanceId } from './status-api.js';
import { isActive, resolve } from './status.js';

export const USAGE = [
  'Usage: homebridge-busy-light <command> [-U <storage path>]',
  '',
  'Commands:',
  '  status                          Show what the plugin is doing, from its state file.',
  '  check                           Read every calendar once and show the status they give.',
  '  login [name]                    Sign in to a Microsoft 365 calendar.',
  '  lights                          Search the network for LIFX bulbs.',
  '  light [name|ip] [#RRGGBB|off]   Send a color to a bulb (the Available color by default).',
  '  input [--setup-code]            Show the status input: addresses, id and the apps reporting.',
  '  input test                      Send a test call for 30 seconds to the running plugin.',
  '  help                            Show this list.',
  '',
  'The storage path defaults to /var/lib/homebridge when it exists, otherwise ~/.homebridge.',
];

const STATE_WORDS: Record<SourceState, string> = {
  checking: 'checking',
  connected: 'connected',
  signInNeeded: 'sign-in needed',
  notReachable: 'not reachable',
};

/** Where the CLI writes, and test seams. */
export interface CliIo {
  out(line: string): void;
  err(line: string): void;
  now?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  lifx?: LifxClient;
  /** The default storage path candidates, for tests. */
  defaultStorage?: string[];
  /** The host name and addresses lookups of `input`, for tests. */
  addresses?: AddressDeps;
  fetch?: typeof fetch;
}

export function defaultStoragePath(candidates = ['/var/lib/homebridge', path.join(os.homedir(), '.homebridge')]): string {
  return candidates.find((p) => fs.existsSync(p)) ?? candidates[candidates.length - 1];
}

class CliError extends Error {}

function consoleLog(io: CliIo): Log {
  return {
    info: (m) => io.out(m),
    warn: (m) => io.out(m),
    error: (m) => io.err(m),
    debug: () => undefined,
  };
}

function readConfig(storage: string, io: CliIo): BusyLightConfig {
  const file = path.join(storage, 'config.json');
  const raw = readJson(file) as { platforms?: unknown } | null;
  if (!raw) {
    throw new CliError(`Could not read ${file}.`);
  }
  const block = Array.isArray(raw.platforms)
    ? raw.platforms.find((p: unknown) => typeof p === 'object' && p !== null && (p as { platform?: unknown }).platform === PLATFORM_NAME)
    : undefined;
  if (!block) {
    throw new CliError(`No ${PLATFORM_NAME} platform in ${file}.`);
  }
  const { config, issues } = parseConfig(block);
  for (const issue of issues) {
    (issue.level === 'error' ? io.err : io.out)(validation(issue.path, issue.message));
  }
  return config;
}

function time(iso: string | null): string {
  return iso ? formatTime(Date.parse(iso)) : 'never';
}

async function cmdStatus(storage: string, io: CliIo): Promise<number> {
  const state = readState(path.join(storage, STORAGE_DIR));
  if (!state) {
    io.err(`No state file in ${path.join(storage, STORAGE_DIR)}. Is Homebridge running with Busy Light?`);
    return 1;
  }
  if (state.status === 'notWorking') {
    io.out(notWorkingLine());
  } else if (state.status && isStatusKey(state.status)) {
    const until = state.reason?.until ? Date.parse(state.reason.until) : null;
    io.out(statusLine(STATUS_NAMES[state.status], state.reason ? { source: state.reason.source, until } : null, (io.now ?? Date.now)()));
  } else {
    io.out(statusUnknown());
  }
  if (state.override) {
    io.out('The override switch is on.');
  }
  io.out(`Updated ${time(state.updatedAt)}.`);
  for (const s of state.sources) {
    const events = s.events === null ? '' : `, ${s.events} event${s.events === 1 ? '' : 's'}`;
    const error = s.error ? ` (${s.error})` : '';
    io.out(`${s.name} (${SOURCE_TYPE_NAMES[s.type]}): ${STATE_WORDS[s.state]}${error}${events}, checked ${time(s.lastChecked)}.`);
    if (s.help) {
      io.out(`  Instructions to send your Microsoft 365 administrator: ${s.help}`);
    }
  }
  if (state.signIn) {
    const source = state.sources.find((s) => s.id === state.signIn!.id);
    io.out(microsoftCode(source?.name ?? state.signIn.id, state.signIn.verificationUri, state.signIn.userCode));
  }
  const light = state.light;
  if (!light.enabled) {
    io.out('Light: not used.');
  } else if (!light.host) {
    io.out('Light: no bulb chosen yet.');
  } else {
    const name = light.label ? `${light.label} at ${light.host}` : light.host;
    const sent = light.lastSent ? `, last sent ${light.lastSent} at ${time(light.lastSentAt)}, ${light.answered ? 'answered' : 'no answer'}` : '';
    io.out(`Light: ${name}${sent}.`);
  }
  return 0;
}

async function cmdCheck(storage: string, io: CliIo): Promise<number> {
  const config = readConfig(storage, io);
  const now = (io.now ?? Date.now)();
  if (config.calendars.length === 0) {
    io.out(noCalendars());
    return 1;
  }
  const storageDir = path.join(storage, STORAGE_DIR);
  const log = consoleLog(io);
  const ics = { outOfOfficeWords: config.outOfOfficeWords, ownerAddresses: ownerAddresses(config) };
  const runners = config.calendars.map((c) => new SourceRunner({
    config: c, storageDir, ics, log, now: () => now, logFailures: false, autoSignIn: false,
  }));
  let ok = true;
  for (const runner of runners) {
    await runner.runOnce(now);
    const entry = runner.stateEntry();
    const events = entry.events === null || entry.state !== 'connected' ? '' : `, ${entry.events} event${entry.events === 1 ? '' : 's'} in the window`;
    const error = entry.error ? ` (${entry.error})` : '';
    io.out(`${runner.name} (${SOURCE_TYPE_NAMES[runner.config.type]}): ${STATE_WORDS[entry.state]}${error}${events}.`);
    if (entry.help) {
      io.out(`  Instructions to send your Microsoft 365 administrator: ${entry.help}`);
    }
    if (entry.state !== 'connected') {
      ok = false;
      if (runner.auth && !runner.auth.hasToken()) {
        io.out(`  Run "homebridge-busy-light login ${runner.name}" to sign in.`);
      }
      continue;
    }
    const presence = runner.lastPresence;
    if (presence) {
      io.out(`  Teams: ${presence.availability || 'no availability'}, ${presence.activity || 'no activity'}${presence.outOfOffice ? ', out of office' : ''}.`);
    }
    const active = (runner.lastEvents ?? []).filter((e) => isActive(e, now)).sort((a, b) => a.start - b.start);
    for (const e of active) {
      const when = e.isAllDay ? 'all day' : `${formatTime(e.start)} to ${formatTime(e.end)}`;
      io.out(`  Now: ${when}, ${e.showAs}${e.isAllDay ? ' (all-day)' : ''}.`);
    }
    if (runner.lastEvents && active.length === 0) {
      io.out('  Nothing on this calendar right now.');
    }
  }
  const result = resolve(runners.map((r) => r.data()), false, now, { ignoreAllDayBusy: config.ignoreAllDayBusy });
  io.out(result.status === 'unknown' ? statusUnknown() : statusLine(STATUS_NAMES[result.status], result.reason, now));
  for (const runner of runners) {
    runner.stop();
  }
  return ok ? 0 : 1;
}

async function cmdLogin(storage: string, name: string | undefined, io: CliIo): Promise<number> {
  const config = readConfig(storage, io);
  const microsoft = config.calendars.filter((c) => c.type === 'microsoft');
  if (microsoft.length === 0) {
    io.err('No Microsoft 365 calendar is set up in the plugin settings.');
    return 1;
  }
  let source = microsoft[0];
  if (name) {
    const found = microsoft.find((c) => c.name.toLowerCase() === name.toLowerCase() || c.id === name);
    if (!found) {
      io.err(`No Microsoft 365 calendar named ${name}. Choose one of: ${microsoft.map((c) => c.name).join(', ')}.`);
      return 1;
    }
    source = found;
  } else if (microsoft.length > 1) {
    io.err(`Name the Microsoft 365 calendar to sign in to: ${microsoft.map((c) => c.name).join(', ')}.`);
    return 1;
  }
  if (source.type !== 'microsoft') {
    return 1;
  }
  const storageDir = ensureStorageDir(storage);
  const auth = new MicrosoftAuth({ source, store: new TokenStore(tokenFile(storageDir, source.id)), log: consoleLog(io), now: io.now, sleep: io.sleep });
  const result = await auth.signIn({ retryStart: false });
  return result === 'signedIn' ? 0 : 1;
}

async function cmdLights(io: CliIo): Promise<number> {
  const client = io.lifx ?? new LifxClient();
  io.out('Searching for LIFX bulbs...');
  const bulbs = await client.discover();
  if (bulbs.length === 0) {
    io.out(noBulb());
    return 1;
  }
  for (const b of bulbs) {
    io.out(`${bulbName(b)}: serial number ${b.serial}, IP address ${b.host}`);
  }
  return 0;
}

async function cmdLight(storage: string, args: string[], io: CliIo): Promise<number> {
  const config = readConfig(storage, io);
  let color: string | null = null;
  const rest: string[] = [];
  for (const a of args) {
    const c = normalizeColor(a);
    if (c && color === null) {
      color = c;
    } else {
      rest.push(a);
    }
  }
  color ??= config.colors.available;
  const target = rest.join(' ').trim();
  const client = io.lifx ?? new LifxClient();
  const log = consoleLog(io);
  let host: string;
  let answered: boolean;
  if (target && isIPv4(target)) {
    host = target;
    answered = await client.sendColor(host, null, color, config.lifx.brightness, 1000);
  } else if (target) {
    const bulbs = await client.discover();
    const bulb = bulbs.find((b) => matchesBulb(target, b));
    if (!bulb) {
      io.out(bulbs.length ? bulbNotNamed(target, bulbs) : noBulb());
      return 1;
    }
    host = bulb.host;
    answered = await client.sendColor(host, bulb.serial, color, config.lifx.brightness, 1000);
  } else {
    const light = new LightController({
      config: { ...config.lifx, enabled: true }, client, log, storageDir: path.join(storage, STORAGE_DIR), remember: false, now: io.now,
    });
    await light.start();
    if (!light.host) {
      return 1;
    }
    answered = (await light.send(color, 1000)) === true;
    if (answered) {
      io.out(`The LIFX bulb at ${light.host} answered.`);
    }
    return answered ? 0 : 1; // a bulb that did not answer has been reported by the controller
  }
  io.out(answered ? `The LIFX bulb at ${host} answered.` : bulbSilent(host));
  return answered ? 0 : 1;
}

/** `input test` (SPEC 10.2): a signed In a call for 30 seconds from `Busy Light test` to the running plugin. */
async function cmdInputTest(config: BusyLightConfig, io: CliIo): Promise<number> {
  const input = config.statusInput;
  if (!input.enabled || !input.key) {
    io.err('The status input is off. Turn it on in the plugin settings, save, and restart Homebridge.');
    return 1;
  }
  const result = await sendTestReport(input.port, input.key, { now: io.now, fetch: io.fetch });
  if (result.ok) {
    io.out(`Busy Light received the test: ${JSON.stringify(result.body)}`);
    return 0;
  }
  io.err(`The test failed (${result.error}${result.status === null ? '' : `, HTTP ${result.status}`}): ${result.message}`);
  return 1;
}

/** `input` and `input --setup-code` (SPEC 10.2): the status input as the configuration and the state file have it. */
async function cmdInput(storage: string, rest: string[], io: CliIo): Promise<number> {
  const config = readConfig(storage, io);
  if (rest[0] === 'test' && rest.length === 1) {
    return cmdInputTest(config, io);
  }
  if (rest.some((a) => a !== '--setup-code')) {
    USAGE.forEach((l) => io.err(l));
    return 1;
  }
  const dir = path.join(storage, STORAGE_DIR);
  const input = config.statusInput;
  const id = readInstanceId(dir);
  io.out(input.enabled ? `Status input: on, port ${input.port}.` : `Status input: off (port ${input.port} when on).`);
  io.out(config.callSwitch.enabled ? `On a Call switch: on, turns itself off after ${count(config.callSwitch.hours, 'hour')}.` : 'On a Call switch: off.');
  io.out(`Instance id: ${id ?? 'none yet (it is created when the status input first starts)'}.`);
  const found = await inputAddresses(io.addresses);
  for (const host of [...(found.hostname ? [found.hostname] : []), ...found.addresses]) {
    io.out(`Address: ${inputUrl(host, input.port)}`);
  }
  const senders = readState(dir)?.inputs ?? [];
  io.out('Apps reporting now:');
  if (senders.length === 0) {
    io.out('  No app has reported in the last 12 hours.');
  }
  for (const e of senders) {
    const how = e.via === 'switch' ? '' : `, ${e.auth === 'plain' ? 'plain key' : 'signed'}`;
    const from = e.app ? ` from ${e.app}` : '';
    const state = e.active ? 'active' : e.ended === 'cleared' ? 'cleared' : 'expired';
    io.out(`  ${e.sender}: ${STATUS_NAMES[e.status]}${from}${how}, last heard ${time(e.lastHeard)}, ${state}.`);
  }
  if (rest.includes('--setup-code')) {
    const host = preferredHost(found);
    if (!input.enabled || !input.key || !id || !host) {
      io.err('There is no setup code yet: turn on the status input in the plugin settings, save, and restart Homebridge.');
      return 1;
    }
    io.out('The setup code contains your key. Treat it like a password.');
    io.out(setupCode(host, input.port, input.key, id));
  }
  return 0;
}

/** Runs one command. Returns the exit code: 0 on success, 1 on failure. */
export async function main(argv: string[], io: CliIo): Promise<number> {
  const args = [...argv];
  let storage: string | undefined;
  const flag = args.indexOf('-U');
  if (flag >= 0) {
    storage = args[flag + 1];
    args.splice(flag, 2);
    if (!storage) {
      io.err('-U needs a storage path.');
      return 1;
    }
  }
  storage = path.resolve(storage ?? defaultStoragePath(io.defaultStorage));
  const [command, ...rest] = args;
  try {
    switch (command) {
    case 'status':
      return await cmdStatus(storage, io);
    case 'check':
      return await cmdCheck(storage, io);
    case 'login':
      return await cmdLogin(storage, rest.join(' ').trim() || undefined, io);
    case 'lights':
      return await cmdLights(io);
    case 'light':
      return await cmdLight(storage, rest, io);
    case 'input':
      return await cmdInput(storage, rest, io);
    case 'help':
    case '--help':
    case '-h':
      USAGE.forEach((l) => io.out(l));
      return 0;
    default:
      USAGE.forEach((l) => io.err(l));
      return 1;
    }
  } catch (err) {
    io.err(err instanceof CliError ? err.message : `Failed: ${(err as Error).message}`);
    return 1;
  }
}
