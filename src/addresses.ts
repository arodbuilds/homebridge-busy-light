/**
 * Finding Busy Light by name (SPEC 18.11): the host's `.local` name when it resolves to one of the host's own
 * addresses, the host's non-internal IPv4 addresses, and the setup code built from them. Used by the CLI `input`
 * command and the UI server's `/input/info`.
 */
import dns from 'node:dns/promises';
import os from 'node:os';

/** How long the `.local` name may take to resolve (18.11 item 1). */
export const LOOKUP_TIMEOUT_MS = 2000;

export interface AddressDeps {
  hostname?: () => string;
  interfaces?: () => NodeJS.Dict<os.NetworkInterfaceInfo[]>;
  lookup?: (name: string) => Promise<{ address: string; family: number }[]>;
  timeoutMs?: number;
}

export interface InputAddresses {
  /** For example `homebridge.local`, or null when the name does not resolve to this host. */
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

/**
 * `{hostname}.local` resolved with `dns.lookup` (every address, 2-second timeout). It is the host name when it
 * resolves to at least one of the host's own non-internal addresses (18.11 item 1). Only the first label of the
 * host's name is used, so a name that already carries a domain still gives `name.local`.
 */
export async function inputAddresses(deps: AddressDeps = {}): Promise<InputAddresses> {
  const { all, ipv4 } = ownAddresses((deps.interfaces ?? os.networkInterfaces)());
  const label = (deps.hostname ?? os.hostname)().split('.')[0].trim();
  if (!label) {
    return { hostname: null, addresses: ipv4 };
  }
  const name = `${label}.local`;
  const lookup = deps.lookup ?? ((n: string) => dns.lookup(n, { all: true }));
  let timer: NodeJS.Timeout | undefined;
  try {
    const found = await Promise.race([
      lookup(name),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), deps.timeoutMs ?? LOOKUP_TIMEOUT_MS);
      }),
    ]);
    const ours = found.some((a) => all.has(a.address.replace(/%.*$/, '').toLowerCase()));
    return { hostname: ours ? name : null, addresses: ipv4 };
  } catch {
    return { hostname: null, addresses: ipv4 };
  } finally {
    clearTimeout(timer);
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

/** The host a sender should use: the host name when there is one, else the first IPv4 address (18.11 item 2). */
export function preferredHost(found: InputAddresses): string | null {
  return found.hostname ?? found.addresses[0] ?? null;
}

/** The setup code: `busylight://{host}:{port}/?key={key}&id={id}` (18.11 item 3). It contains the key. */
export function setupCode(host: string, port: number, key: string, id: string): string {
  return `busylight://${hostPort(host, port)}/?key=${key}&id=${id}`;
}
