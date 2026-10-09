/**
 * Finding Busy Light by name (SPEC 18.11): the host's `.local` name when the network confirms it is this host, first
 * by one multicast DNS query (as every Mac and iPhone on the network finds it), then by `dns.lookup`; the host's
 * non-internal IPv4 addresses; and the setup code built from them. Used by the CLI `input` command, the UI server's
 * `/input/info` (through a 10-minute cache) and the plugin's address change notice.
 */
import crypto from 'node:crypto';
import dgram from 'node:dgram';
import dns from 'node:dns/promises';
import os from 'node:os';

/** How long the `.local` name may take to resolve with `dns.lookup` (18.11 item 2). */
export const LOOKUP_TIMEOUT_MS = 2000;
/** How long the answers to the multicast DNS query are collected (18.11 item 1). */
export const MDNS_WAIT_MS = 1500;
export const MDNS_ADDRESS = '224.0.0.251';
export const MDNS_PORT = 5353;
/** How long the UI server keeps a result (18.11 item 4). */
export const ADDRESS_CACHE_MS = 600_000;

const TYPE_A = 1;
const CLASS_IN = 1;

/** The part of a `dgram` socket the query uses; tests replace it, so no test sends UDP. */
export interface MdnsSocket {
  on(event: 'message', listener: (msg: Buffer) => void): unknown;
  on(event: 'error', listener: (err: Error) => void): unknown;
  send(msg: Buffer, port: number, address: string, callback?: (err: Error | null) => void): void;
  close(): void;
}

export interface AddressDeps {
  hostname?: () => string;
  interfaces?: () => NodeJS.Dict<os.NetworkInterfaceInfo[]>;
  /** The multicast DNS socket (18.11 item 1). */
  createSocket?: () => MdnsSocket;
  mdnsWaitMs?: number;
  lookup?: (name: string) => Promise<{ address: string; family: number }[]>;
  timeoutMs?: number;
}

export interface InputAddresses {
  /** For example `homebridge.local`, or null when the network does not confirm the name is this host. */
  hostname: string | null;
  /** The host's non-internal IPv4 addresses. */
  addresses: string[];
}

/** Every non-internal address of the host, and the IPv4 ones in order. */
function ownAddresses(interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]>): { all: Set<string>; ipv4: string[] } {
  const all = new Set<string>();
  const ipv4: string[] = [];
  for (const list of Object.values(interfaces)) {
    for (const info of list ?? []) {
      if (info.internal) {
        continue;
      }
      all.add(info.address.replace(/%.*$/, '').toLowerCase());
      if (info.family === 'IPv4' && !ipv4.includes(info.address)) {
        ipv4.push(info.address);
      }
    }
  }
  return { all, ipv4 };
}

// ---------------------------------------------------------------------------
// Multicast DNS (18.11 item 1): one query, type A, class IN, in the legacy unicast form
// ---------------------------------------------------------------------------

/** The query for `name`: a 12-byte header with `id` and one question, type A, class IN. Null for a name DNS cannot carry. */
export function mdnsQuery(name: string, id: number): Buffer | null {
  const labels = name.split('.').map((l) => Buffer.from(l, 'utf8'));
  if (labels.some((l) => l.length === 0 || l.length > 63)) {
    return null;
  }
  const header = Buffer.alloc(12);
  header.writeUInt16BE(id, 0);
  header.writeUInt16BE(1, 4);
  const question = Buffer.concat([...labels.flatMap((l) => [Buffer.from([l.length]), l]), Buffer.from([0, 0, TYPE_A, 0, CLASS_IN])]);
  return Buffer.concat([header, question]);
}

/** A name at `offset`, following compression pointers; throws on anything malformed. */
function readName(buf: Buffer, offset: number): { name: string; next: number } {
  const labels: string[] = [];
  let at = offset;
  let next = -1;
  for (let steps = 0; steps < 128; steps++) {
    if (at >= buf.length) {
      throw new Error('name past the end');
    }
    const len = buf[at];
    if (len === 0) {
      return { name: labels.join('.'), next: next === -1 ? at + 1 : next };
    }
    if ((len & 0xc0) === 0xc0) {
      if (at + 1 >= buf.length) {
        throw new Error('pointer past the end');
      }
      if (next === -1) {
        next = at + 2;
      }
      at = ((len & 0x3f) << 8) | buf[at + 1];
      continue;
    }
    if ((len & 0xc0) !== 0 || at + 1 + len > buf.length) {
      throw new Error('bad label');
    }
    labels.push(buf.toString('utf8', at + 1, at + 1 + len));
    at += 1 + len;
  }
  throw new Error('name too long');
}

/**
 * The A records of an answer to the query `id`, as lower-case names and dotted addresses. A packet that is not an
 * answer, answers another query, or cannot be read gives none; this never throws.
 */
export function mdnsARecords(buf: Buffer, id: number): Array<{ name: string; address: string }> {
  try {
    if (buf.length < 12 || buf.readUInt16BE(0) !== id || (buf.readUInt16BE(2) & 0x8000) === 0) {
      return [];
    }
    const questions = buf.readUInt16BE(4);
    const records = buf.readUInt16BE(6) + buf.readUInt16BE(8) + buf.readUInt16BE(10);
    let at = 12;
    for (let i = 0; i < questions; i++) {
      at = readName(buf, at).next + 4;
    }
    const found: Array<{ name: string; address: string }> = [];
    for (let i = 0; i < records; i++) {
      const { name, next } = readName(buf, at);
      if (next + 10 > buf.length) {
        throw new Error('record past the end');
      }
      const type = buf.readUInt16BE(next);
      // The top bit of the class is the multicast DNS cache-flush bit.
      const cls = buf.readUInt16BE(next + 2) & 0x7fff;
      const length = buf.readUInt16BE(next + 8);
      const data = next + 10;
      if (data + length > buf.length) {
        throw new Error('data past the end');
      }
      if (type === TYPE_A && cls === CLASS_IN && length === 4) {
        found.push({ name: name.toLowerCase(), address: [...buf.subarray(data, data + 4)].join('.') });
      }
      at = data + length;
    }
    return found;
  } catch {
    return [];
  }
}

/**
 * Asks the network for `name`'s A records with one multicast DNS query from an ephemeral port, and resolves true at
 * the first answer that gives the name one of `own` addresses, or false after the wait, on an error, or when no
 * socket can be made. Never rejects.
 */
function mdnsConfirms(name: string, own: Set<string>, deps: AddressDeps): Promise<boolean> {
  return new Promise((resolve) => {
    let socket: MdnsSocket | null = null;
    let timer: NodeJS.Timeout | undefined;
    let done = false;
    const finish = (confirmed: boolean): void => {
      if (done) {
        return;
      }
      done = true;
      clearTimeout(timer);
      try {
        socket?.close();
      } catch {
        // Already closed.
      }
      resolve(confirmed);
    };
    try {
      const id = crypto.randomInt(1, 0x10000);
      const query = mdnsQuery(name, id);
      if (!query) {
        finish(false);
        return;
      }
      socket = (deps.createSocket ?? (() => dgram.createSocket('udp4') as unknown as MdnsSocket))();
      socket.on('error', () => finish(false));
      socket.on('message', (msg: Buffer) => {
        if (mdnsARecords(msg, id).some((r) => r.name === name && own.has(r.address))) {
          finish(true);
        }
      });
      timer = setTimeout(() => finish(false), deps.mdnsWaitMs ?? MDNS_WAIT_MS);
      socket.send(query, MDNS_PORT, MDNS_ADDRESS, (err) => {
        if (err) {
          finish(false);
        }
      });
    } catch {
      finish(false);
    }
  });
}

/** `dns.lookup` of `name` (every address, 2-second timeout): true when it gives one of the host's own addresses. */
async function lookupConfirms(name: string, own: Set<string>, deps: AddressDeps): Promise<boolean> {
  const lookup = deps.lookup ?? ((n: string) => dns.lookup(n, { all: true }));
  let timer: NodeJS.Timeout | undefined;
  try {
    const found = await Promise.race([
      lookup(name),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), deps.timeoutMs ?? LOOKUP_TIMEOUT_MS);
      }),
    ]);
    return found.some((a) => own.has(a.address.replace(/%.*$/, '').toLowerCase()));
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The host name and the IPv4 addresses (18.11 items 1 to 3, 5). The name is `{hostname}.local` from the host name up
 * to its first dot, in lower case. Multicast DNS confirms it when an A record for it carries one of the host's own
 * non-internal IPv4 addresses; failing that, `dns.lookup` confirms it by one of the host's own non-internal
 * addresses. Without a confirmation there is no host name. Never rejects: any error means no host name.
 */
export async function inputAddresses(deps: AddressDeps = {}): Promise<InputAddresses> {
  let own: { all: Set<string>; ipv4: string[] } = { all: new Set(), ipv4: [] };
  try {
    own = ownAddresses((deps.interfaces ?? os.networkInterfaces)());
    const label = (deps.hostname ?? os.hostname)().split('.')[0].trim().toLowerCase();
    if (!label) {
      return { hostname: null, addresses: own.ipv4 };
    }
    const name = `${label}.local`;
    if (own.ipv4.length > 0 && await mdnsConfirms(name, new Set(own.ipv4), deps)) {
      return { hostname: name, addresses: own.ipv4 };
    }
    return { hostname: await lookupConfirms(name, own.all, deps) ? name : null, addresses: own.ipv4 };
  } catch {
    return { hostname: null, addresses: own.ipv4 };
  }
}

/** The check of `inputAddresses` kept for 10 minutes (18.11 item 4), with one check at a time. */
export class AddressCache {
  private result: { at: number; value: InputAddresses } | null = null;
  private pending: Promise<InputAddresses> | null = null;

  constructor(private readonly deps: AddressDeps = {}, private readonly now: () => number = Date.now) {}

  get(): Promise<InputAddresses> {
    if (this.result && this.now() - this.result.at < ADDRESS_CACHE_MS) {
      return Promise.resolve(this.result.value);
    }
    if (!this.pending) {
      this.pending = inputAddresses(this.deps).then((value) => {
        this.result = { at: this.now(), value };
        this.pending = null;
        return value;
      });
    }
    return this.pending;
  }
}

/** `host:port` for a URL, with an IPv6 address in brackets (18.11 item 3). */
function hostPort(host: string, port: number): string {
  return host.includes(':') ? `[${host}]:${port}` : `${host}:${port}`;
}

/** `http://{host}:{port}`. */
export function inputUrl(host: string, port: number): string {
  return `http://${hostPort(host, port)}`;
}

/** The host a sender should use: the host name when there is one, else the first IPv4 address (18.11 item 3). */
export function preferredHost(found: InputAddresses): string | null {
  return found.hostname ?? found.addresses[0] ?? null;
}

/** The setup code: `busylight://{host}:{port}/?key={key}&id={id}` (18.11 item 3). It contains the key. */
export function setupCode(host: string, port: number, key: string, id: string): string {
  return `busylight://${hostPort(host, port)}/?key=${key}&id=${id}`;
}
