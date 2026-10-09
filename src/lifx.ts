/**
 * The LIFX LAN protocol over UDP port 56700 (SPEC 13.1 and 13.2): packets, sending a color with acknowledgements,
 * and broadcast discovery. No LIFX account and no cloud.
 */
import dgram from 'node:dgram';
import os from 'node:os';

export const LIFX_PORT = 56700;
/** A fixed non-zero source identifier (SPEC 13.1 item 1). Replies arrive on this client's own port. */
export const SOURCE_ID = 0x4c425942;
export const KELVIN = 3500;

export const MSG = {
  GetService: 2,
  StateService: 3,
  GetLabel: 23,
  StateLabel: 25,
  Acknowledgement: 45,
  SetColor: 102,
  SetPower: 117,
} as const;

const TAGGED = 0x3400;
const UNTAGGED = 0x1400;
const ACK_REQUIRED = 0x02;

/** Addressing: a serial number (12 hex digits) sends untagged to that bulb; null sends tagged with a zero target. */
export interface PacketOptions {
  serial: string | null;
  sequence: number;
  ackRequired: boolean;
}

/** The 36-byte header of SPEC 13.1 item 1, at the start of a buffer of `size` bytes. */
export function header(size: number, type: number, opts: PacketOptions): Buffer {
  const buf = Buffer.alloc(size);
  buf.writeUInt16LE(size, 0);
  buf.writeUInt16LE(opts.serial ? UNTAGGED : TAGGED, 2);
  buf.writeUInt32LE(SOURCE_ID, 4);
  if (opts.serial) {
    Buffer.from(opts.serial, 'hex').copy(buf, 8, 0, 6);
  }
  buf.writeUInt8(opts.ackRequired ? ACK_REQUIRED : 0, 22);
  buf.writeUInt8(opts.sequence & 0xff, 23);
  buf.writeUInt16LE(type, 32);
  return buf;
}

export interface Hsb {
  /** 0 to 1. */
  h: number;
  s: number;
  b: number;
}

/** `#RRGGBB` as hue, saturation and brightness from 0 to 1, or null for anything else (such as `off`). */
export function hexToHsb(hex: string): Hsb | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) {
    return null;
  }
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const bl = (n & 255) / 255;
  const max = Math.max(r, g, bl);
  const d = max - Math.min(r, g, bl);
  let h = 0;
  if (d > 0) {
    if (max === r) {
      h = ((g - bl) / d + 6) % 6;
    } else if (max === g) {
      h = (bl - r) / d + 2;
    } else {
      h = (r - g) / d + 4;
    }
  }
  return { h: h / 6, s: max === 0 ? 0 : d / max, b: max };
}

const u16 = (v: number) => Math.max(0, Math.min(65535, Math.round(v * 65535)));

/** SetColor, type 102, 49 bytes. Brightness is the color's own, scaled by `brightnessPercent`. */
export function buildSetColor(hsb: Hsb, brightnessPercent: number, durationMs: number, opts: PacketOptions): Buffer {
  const buf = header(49, MSG.SetColor, opts);
  buf.writeUInt16LE(u16(hsb.h), 37);
  buf.writeUInt16LE(u16(hsb.s), 39);
  buf.writeUInt16LE(u16(hsb.b * Math.max(1, Math.min(100, brightnessPercent)) / 100), 41);
  buf.writeUInt16LE(KELVIN, 43);
  buf.writeUInt32LE(durationMs, 45);
  return buf;
}

/** SetPower, type 117, 42 bytes. */
export function buildSetPower(on: boolean, durationMs: number, opts: PacketOptions): Buffer {
  const buf = header(42, MSG.SetPower, opts);
  buf.writeUInt16LE(on ? 65535 : 0, 36);
  buf.writeUInt32LE(durationMs, 38);
  return buf;
}

/** GetService, type 2: always tagged with a zero target. */
export function buildGetService(sequence: number): Buffer {
  return header(36, MSG.GetService, { serial: null, sequence, ackRequired: false });
}

/** GetLabel, type 23, to one bulb. */
export function buildGetLabel(serial: string, sequence: number): Buffer {
  return header(36, MSG.GetLabel, { serial, sequence, ackRequired: false });
}

export interface Header {
  size: number;
  tagged: boolean;
  source: number;
  /** The first 6 bytes of the target, as 12 hex digits. */
  serial: string;
  sequence: number;
  type: number;
}

export function parseHeader(buf: Buffer): Header | null {
  if (buf.length < 36 || buf.readUInt16LE(0) !== buf.length) {
    return null;
  }
  return {
    size: buf.readUInt16LE(0),
    tagged: (buf.readUInt16LE(2) & 0x2000) !== 0,
    source: buf.readUInt32LE(4),
    serial: buf.subarray(8, 14).toString('hex'),
    sequence: buf.readUInt8(23),
    type: buf.readUInt16LE(32),
  };
}

/** StateLabel, type 25: 32 bytes of UTF-8, zero padded. */
export function parseStateLabel(buf: Buffer): string {
  const raw = buf.subarray(36, 68);
  const end = raw.indexOf(0);
  return raw.subarray(0, end < 0 ? raw.length : end).toString('utf8').trim();
}

/** A serial written any way (with colons, upper case) as 12 lower-case hex digits, or null. */
export function normalizeSerial(value: string): string | null {
  const hex = value.replace(/[^0-9a-f]/gi, '').toLowerCase();
  return hex.length === 12 && /^[0-9a-f:\s-]+$/i.test(value.trim()) ? hex : null;
}

/** What the client needs from a UDP socket. Tests replace it with a fake network. */
export interface UdpSocket {
  onMessage(listener: (msg: Buffer, from: string) => void): void;
  bind(): Promise<void>;
  setBroadcast(on: boolean): void;
  send(msg: Buffer, port: number, address: string): Promise<void>;
  close(): void;
}

export type SocketFactory = () => UdpSocket;

export function nodeSocket(): UdpSocket {
  const socket = dgram.createSocket('udp4');
  socket.on('error', () => undefined);
  return {
    onMessage: (listener) => {
      socket.on('message', (msg, rinfo) => listener(msg, rinfo.address));
    },
    bind: () => new Promise((resolve, reject) => {
      socket.once('error', reject);
      socket.bind(0, () => {
        socket.off('error', reject);
        resolve();
      });
    }),
    setBroadcast: (on) => socket.setBroadcast(on),
    send: (msg, port, address) => new Promise((resolve, reject) => {
      socket.send(msg, port, address, (err) => (err ? reject(err) : resolve()));
    }),
    close: () => {
      try {
        socket.close();
      } catch {
        // already closed
      }
    },
  };
}

/** The broadcast address of every non-internal IPv4 interface. */
export function interfaceBroadcasts(interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces()): string[] {
  const out = new Set<string>();
  for (const list of Object.values(interfaces)) {
    for (const info of list ?? []) {
      if (info.family !== 'IPv4' || info.internal) {
        continue;
      }
      const addr = info.address.split('.').map(Number);
      const mask = info.netmask.split('.').map(Number);
      if (addr.length !== 4 || mask.length !== 4) {
        continue;
      }
      out.add(addr.map((a, i) => (a | (~mask[i] & 255)) & 255).join('.'));
    }
  }
  return [...out];
}

export interface Bulb {
  serial: string;
  /** The name shown in the LIFX app; empty when the bulb did not say. */
  label: string;
  host: string;
}

export interface LifxTimings {
  /** How long to wait for an acknowledgement or a label before trying again. */
  replyMs: number;
  /** Tries per packet. */
  tries: number;
  /** GetService broadcasts, `replyMs` apart. */
  broadcasts: number;
  /** How long to collect StateService replies. */
  collectMs: number;
}

export const DEFAULT_TIMINGS: LifxTimings = { replyMs: 500, tries: 3, broadcasts: 3, collectMs: 2000 };

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

let sequence = 0;
function nextSequence(): number {
  sequence = (sequence + 1) & 0xff;
  return sequence;
}

export interface LifxClientOptions {
  socket?: SocketFactory;
  timings?: Partial<LifxTimings>;
  interfaces?: () => NodeJS.Dict<os.NetworkInterfaceInfo[]>;
}

export class LifxClient {
  private readonly socket: SocketFactory;
  private readonly timings: LifxTimings;
  private readonly interfaces: () => NodeJS.Dict<os.NetworkInterfaceInfo[]>;

  constructor(opts: LifxClientOptions = {}) {
    this.socket = opts.socket ?? nodeSocket;
    this.timings = { ...DEFAULT_TIMINGS, ...opts.timings };
    this.interfaces = opts.interfaces ?? os.networkInterfaces;
  }

  /**
   * Sends a color (`#RRGGBB`) as SetColor then SetPower on, or `off` as SetPower off, each with an acknowledgement
   * requested and up to three tries. True when the last packet was acknowledged. One socket per send.
   */
  async sendColor(host: string, serial: string | null, color: string, brightnessPercent: number, durationMs: number): Promise<boolean> {
    const hsb = hexToHsb(color);
    const opts = (seq: number) => ({ serial, sequence: seq, ackRequired: true });
    return this.sendPackets(host, hsb
      ? [(seq) => buildSetColor(hsb, brightnessPercent, durationMs, opts(seq)), (seq) => buildSetPower(true, durationMs, opts(seq))]
      : [(seq) => buildSetPower(false, durationMs, opts(seq))]);
  }

  /**
   * The meeting warning (SPEC 6.7, 13.1 item 8): SetPower on, then one SetColor of `to` lasting `durationMs`, so the bulb
   * fades by itself. Before them, with `from` `off`, SetColor of `to` at 1 percent brightness, so the bulb comes on
   * dim; with `from` a color, SetColor of it, so the fade starts there. True when the last packet was acknowledged.
   */
  async sendFade(host: string, serial: string | null, fade: { from: string | null; to: string; durationMs: number },
    brightnessPercent: number): Promise<boolean> {
    const to = hexToHsb(fade.to);
    if (!to) {
      return false;
    }
    const opts = (seq: number) => ({ serial, sequence: seq, ackRequired: true });
    const start = fade.from === null ? null : fade.from === 'off' ? { hsb: to, percent: 1 } : { hsb: hexToHsb(fade.from), percent: brightnessPercent };
    const build: ((seq: number) => Buffer)[] = [];
    if (start?.hsb) {
      const hsb = start.hsb;
      build.push((seq) => buildSetColor(hsb, start.percent, 0, opts(seq)));
    }
    build.push((seq) => buildSetPower(true, 0, opts(seq)));
    build.push((seq) => buildSetColor(to, brightnessPercent, Math.max(0, Math.round(fade.durationMs)), opts(seq)));
    return this.sendPackets(host, build);
  }

  /** Sends packets in order, each acknowledged with up to three tries. True when the last was acknowledged. */
  private async sendPackets(host: string, build: ((seq: number) => Buffer)[]): Promise<boolean> {
    const socket = this.socket();
    const acks = new Set<number>();
    const waiters = new Map<number, () => void>();
    socket.onMessage((msg) => {
      const h = parseHeader(msg);
      if (h && h.type === MSG.Acknowledgement) {
        acks.add(h.sequence);
        waiters.get(h.sequence)?.();
      }
    });
    try {
      await socket.bind();
      let answered = false;
      for (const make of build) {
        const seq = nextSequence();
        const packet = make(seq);
        answered = false;
        for (let attempt = 0; attempt < this.timings.tries && !answered; attempt++) {
          try {
            await socket.send(packet, LIFX_PORT, host);
          } catch {
            // An unreachable or unknown host is the same as no answer.
          }
          answered = acks.has(seq) || await new Promise<boolean>((resolve) => {
            const timer = setTimeout(() => {
              waiters.delete(seq);
              resolve(false);
            }, this.timings.replyMs);
            waiters.set(seq, () => {
              clearTimeout(timer);
              waiters.delete(seq);
              resolve(true);
            });
          });
        }
      }
      return answered;
    } catch {
      return false;
    } finally {
      socket.close();
    }
  }

  /** SPEC 13.2 item 1: GetService broadcasts, StateService replies, then each bulb's label. */
  async discover(): Promise<Bulb[]> {
    const socket = this.socket();
    const found = new Map<string, Bulb>();
    const labels = new Map<string, string>();
    const labelWaiters = new Map<string, () => void>();
    socket.onMessage((msg, from) => {
      const h = parseHeader(msg);
      if (!h) {
        return;
      }
      if (h.type === MSG.StateService && msg.length >= 41 && msg.readUInt8(36) === 1 && h.serial !== '000000000000') {
        if (!found.has(h.serial)) {
          found.set(h.serial, { serial: h.serial, label: '', host: from });
        }
      } else if (h.type === MSG.StateLabel && msg.length >= 68) {
        labels.set(h.serial, parseStateLabel(msg));
        labelWaiters.get(h.serial)?.();
      }
    });
    try {
      await socket.bind();
      socket.setBroadcast(true);
      const targets = ['255.255.255.255', ...interfaceBroadcasts(this.interfaces())];
      const started = Date.now();
      for (let i = 0; i < this.timings.broadcasts; i++) {
        const packet = buildGetService(nextSequence());
        for (const address of targets) {
          await socket.send(packet, LIFX_PORT, address).catch(() => undefined);
        }
        if (i < this.timings.broadcasts - 1) {
          await wait(this.timings.replyMs);
        }
      }
      await wait(Math.max(0, this.timings.collectMs - (Date.now() - started)));
      for (const bulb of found.values()) {
        for (let attempt = 0; attempt < this.timings.tries && !labels.has(bulb.serial); attempt++) {
          await socket.send(buildGetLabel(bulb.serial, nextSequence()), LIFX_PORT, bulb.host).catch(() => undefined);
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, this.timings.replyMs);
            labelWaiters.set(bulb.serial, () => {
              clearTimeout(timer);
              resolve();
            });
          });
          labelWaiters.delete(bulb.serial);
        }
        bulb.label = labels.get(bulb.serial) ?? '';
      }
      return [...found.values()].sort((a, b) => a.label.localeCompare(b.label) || a.serial.localeCompare(b.serial));
    } catch {
      return [...found.values()];
    } finally {
      socket.close();
    }
  }
}
