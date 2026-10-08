/**
 * The platform block as the page edits it (SPEC section 9). `readConfig` accepts whatever config.json holds and
 * fills in the defaults; `exportConfig` writes the block back, keeping keys the page does not know (the host's
 * `_bridge` settings, `credentialsPath`) exactly as loaded.
 */

export const PLATFORM = 'Generac';

export interface UiGeneratorOverride {
  apparatusId: number;
  name: string;
}

export interface UiConfig {
  name: string;
  pollIdleMinutes: number;
  pollActiveSeconds: number;
  batteryLowVoltage: number;
  faultOnStopped: boolean;
  faultOnDisconnected: boolean;
  attentionSensor: boolean;
  exerciseSensor: boolean;
  /** 24-hour "HH:MM" or empty. */
  exerciseTime: string;
  exerciseHoldMinutes: number;
  debug: boolean;
  generators: UiGeneratorOverride[];
  /** Keys the page does not edit, written back untouched. */
  extra: Record<string, unknown>;
}

export const DEFAULTS = {
  name: 'Generac',
  pollIdleMinutes: 10,
  pollIdleMinutesMin: 2,
  pollActiveSeconds: 90,
  pollActiveSecondsMin: 60,
  batteryLowVoltage: 12.0,
  faultOnStopped: true,
  faultOnDisconnected: false,
  attentionSensor: false,
  exerciseSensor: true,
  exerciseHoldMinutes: 5,
  exerciseHoldMinutesMin: 1,
  debug: false,
};

const KNOWN = new Set([
  'platform', 'name', 'pollIdleMinutes', 'pollActiveSeconds', 'batteryLowVoltage', 'faultOnStopped', 'faultOnDisconnected',
  'attentionSensor', 'exerciseSensor', 'exerciseTime', 'exerciseHoldMinutes', 'debug', 'generators',
]);

function num(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN;
  return Number.isFinite(n) ? n : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export function emptyConfig(): UiConfig {
  return {
    name: DEFAULTS.name,
    pollIdleMinutes: DEFAULTS.pollIdleMinutes,
    pollActiveSeconds: DEFAULTS.pollActiveSeconds,
    batteryLowVoltage: DEFAULTS.batteryLowVoltage,
    faultOnStopped: DEFAULTS.faultOnStopped,
    faultOnDisconnected: DEFAULTS.faultOnDisconnected,
    attentionSensor: DEFAULTS.attentionSensor,
    exerciseSensor: DEFAULTS.exerciseSensor,
    exerciseTime: '',
    exerciseHoldMinutes: DEFAULTS.exerciseHoldMinutes,
    debug: DEFAULTS.debug,
    generators: [],
    extra: {},
  };
}

export function readConfig(raw: unknown): UiConfig {
  const c = emptyConfig();
  if (!raw || typeof raw !== 'object') {
    return c;
  }
  const r = raw as Record<string, unknown>;
  c.name = typeof r.name === 'string' && r.name.trim() ? r.name : DEFAULTS.name;
  c.pollIdleMinutes = num(r.pollIdleMinutes, DEFAULTS.pollIdleMinutes);
  c.pollActiveSeconds = num(r.pollActiveSeconds, DEFAULTS.pollActiveSeconds);
  c.batteryLowVoltage = num(r.batteryLowVoltage, DEFAULTS.batteryLowVoltage);
  c.faultOnStopped = bool(r.faultOnStopped, DEFAULTS.faultOnStopped);
  c.faultOnDisconnected = bool(r.faultOnDisconnected, DEFAULTS.faultOnDisconnected);
  c.attentionSensor = bool(r.attentionSensor, DEFAULTS.attentionSensor);
  c.exerciseSensor = bool(r.exerciseSensor, DEFAULTS.exerciseSensor);
  c.exerciseTime = typeof r.exerciseTime === 'string' ? r.exerciseTime.trim() : '';
  c.exerciseHoldMinutes = num(r.exerciseHoldMinutes, DEFAULTS.exerciseHoldMinutes);
  c.debug = bool(r.debug, DEFAULTS.debug);
  if (Array.isArray(r.generators)) {
    for (const g of r.generators) {
      if (g && typeof g === 'object') {
        const id = num((g as Record<string, unknown>).apparatusId, Number.NaN);
        const name = (g as Record<string, unknown>).name;
        if (Number.isFinite(id) && typeof name === 'string' && name.trim()) {
          c.generators.push({ apparatusId: id, name: name.trim() });
        }
      }
    }
  }
  for (const [key, value] of Object.entries(r)) {
    if (!KNOWN.has(key)) {
      c.extra[key] = value;
    }
  }
  return c;
}

/** The block for `updatePluginConfig`. Optional keys at their default are written all the same, so the file reads as the page shows. */
export function exportConfig(c: UiConfig): Record<string, unknown> {
  const block: Record<string, unknown> = {
    ...c.extra,
    platform: PLATFORM,
    name: c.name,
    pollIdleMinutes: c.pollIdleMinutes,
    pollActiveSeconds: c.pollActiveSeconds,
    batteryLowVoltage: c.batteryLowVoltage,
    faultOnStopped: c.faultOnStopped,
    faultOnDisconnected: c.faultOnDisconnected,
    attentionSensor: c.attentionSensor,
    exerciseSensor: c.exerciseSensor,
    exerciseHoldMinutes: c.exerciseHoldMinutes,
    debug: c.debug,
  };
  if (c.exerciseTime.trim()) {
    block.exerciseTime = c.exerciseTime.trim();
  }
  if (c.generators.length > 0) {
    block.generators = c.generators.map((g) => ({ apparatusId: g.apparatusId, name: g.name }));
  }
  return block;
}

/** The display name override for a generator, or undefined. */
export function overrideFor(c: UiConfig, apparatusId: number): string | undefined {
  return c.generators.find((g) => g.apparatusId === apparatusId)?.name;
}

/** Sets or clears a generator's display name override: a name equal to the Mobile Link name needs no override. */
export function setOverride(c: UiConfig, apparatusId: number, name: string, mobileLinkName: string): void {
  const trimmed = name.trim();
  c.generators = c.generators.filter((g) => g.apparatusId !== apparatusId);
  if (trimmed && trimmed !== mobileLinkName) {
    c.generators.push({ apparatusId, name: trimmed });
  }
}
