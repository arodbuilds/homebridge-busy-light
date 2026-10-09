/**
 * The address change notice (SPEC 18.11 item 6): the plugin keeps the address it last gave senders, the host name or
 * the first IPv4 address, and warns once when, with no host name, the first IPv4 address is a different one. It
 * checks when the status input starts and every 10 minutes after; the record lives in the state file (10.1 item 7)
 * and is read back from the previous one at startup.
 */
import net from 'node:net';
import { inputAddresses, preferredHost } from './addresses.js';
import type { AddressDeps } from './addresses.js';
import type { Log } from './log.js';
import { addressChanged } from './messages.js';
import type { AddressChange } from './state.js';

/** How often the address is checked while the status input is on (18.11 item 4). */
export const ADDRESS_CHECK_MS = 600_000;

export interface AddressRecord {
  advertised: string | null;
  addressChange: AddressChange | null;
}

export interface AddressWatcherOptions {
  log: Log;
  /** The record of the previous state file, if any. */
  previous?: Partial<AddressRecord> | null;
  addresses?: AddressDeps;
  now?: () => number;
  /** Called when the record changes, so the state file is written. */
  onChange?: () => void;
}

export class AddressWatcher {
  advertised: string | null;
  addressChange: AddressChange | null;
  private timer: NodeJS.Timeout | null = null;
  private readonly now: () => number;

  constructor(private readonly opts: AddressWatcherOptions) {
    this.advertised = typeof opts.previous?.advertised === 'string' ? opts.previous.advertised : null;
    const change = opts.previous?.addressChange;
    this.addressChange = change && typeof change.from === 'string' && typeof change.to === 'string' && typeof change.at === 'string'
      ? { from: change.from, to: change.to, at: change.at }
      : null;
    this.now = opts.now ?? Date.now;
  }

  /** The record for the state file. */
  record(): AddressRecord {
    return { advertised: this.advertised, addressChange: this.addressChange };
  }

  /**
   * One check. A host name is recorded as it is and never warns; with none, the first IPv4 address is recorded, and
   * when the recorded address was another IPv4 address the change is logged once and kept. Never rejects.
   */
  async check(): Promise<void> {
    const found = await inputAddresses(this.opts.addresses);
    const next = preferredHost(found);
    if (next === null || next === this.advertised) {
      return;
    }
    if (found.hostname === null && this.advertised !== null && net.isIPv4(this.advertised)) {
      this.opts.log.warn(addressChanged(this.advertised, next));
      this.addressChange = { from: this.advertised, to: next, at: new Date(this.now()).toISOString() };
    }
    this.advertised = next;
    this.opts.onChange?.();
  }

  /** Checks now and every 10 minutes until `stop`. */
  start(): void {
    void this.check();
    this.timer = setInterval(() => void this.check(), ADDRESS_CHECK_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
