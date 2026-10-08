// Minimal LIFX LAN protocol client (UDP port 56700). Sets color and power on one bulb by IP address.

import * as dgram from 'node:dgram';

const PORT = 56700;

/** Converts #RRGGBB to hue, saturation and brightness, each 0 to 1. Returns null if not a hex color. */
export function hexToHsb(hex: string): { h: number; s: number; b: number } | null {
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

function header(size: number, type: number, sequence: number): Buffer {
  const buf = Buffer.alloc(size);
  buf.writeUInt16LE(size, 0);
  buf.writeUInt16LE(0x3400, 2); // protocol 1024, addressable, tagged (no target address)
  buf.writeUInt32LE(0x4d333635, 4); // source id
  buf.writeUInt8(sequence & 255, 23);
  buf.writeUInt16LE(type, 32);
  return buf;
}

const u16 = (v: number) => Math.max(0, Math.min(65535, Math.round(v * 65535)));

export function buildSetColor(h: number, s: number, b: number, kelvin: number, durationMs: number, seq = 0): Buffer {
  const buf = header(49, 102, seq);
  buf.writeUInt16LE(u16(h), 37);
  buf.writeUInt16LE(u16(s), 39);
  buf.writeUInt16LE(u16(b), 41);
  buf.writeUInt16LE(kelvin, 43);
  buf.writeUInt32LE(durationMs, 45);
  return buf;
}

export function buildSetPower(on: boolean, durationMs: number, seq = 0): Buffer {
  const buf = header(42, 117, seq);
  buf.writeUInt16LE(on ? 65535 : 0, 36);
  buf.writeUInt32LE(durationMs, 38);
  return buf;
}

export class LifxBulb {
  private seq = 0;

  constructor(private readonly host: string) {}

  /** color is #RRGGBB or "off". brightnessPct scales the color's own brightness. */
  async set(color: string, brightnessPct: number, durationMs: number): Promise<void> {
    const packets: Buffer[] = [];
    const hsb = hexToHsb(color);
    if (!hsb) {
      packets.push(buildSetPower(false, durationMs, this.seq++));
    } else {
      const b = hsb.b * Math.max(1, Math.min(100, brightnessPct)) / 100;
      packets.push(buildSetColor(hsb.h, hsb.s, b, 3500, durationMs, this.seq++));
      packets.push(buildSetPower(true, durationMs, this.seq++));
    }
    const socket = dgram.createSocket('udp4');
    try {
      // UDP is not acknowledged here, so each (idempotent) packet is sent three times.
      for (let i = 0; i < 3; i++) {
        for (const p of packets) {
          await new Promise<void>((resolve, reject) =>
            socket.send(p, PORT, this.host, (err) => (err ? reject(err) : resolve())));
        }
        await new Promise((r) => setTimeout(r, 150));
      }
    } finally {
      socket.close();
    }
  }
}
