/**
 * The interval selects (SPEC 11.3 C and F, from build 3.1): durations in place of numbers in seconds. `config.json`
 * keeps seconds. A saved value not in the list (typed in an earlier build, or by hand) is one more option, selected,
 * so it is never lost; it leaves the list once another option is chosen and saved.
 */

import { DURATIONS } from './copy.js';
import type { SelectOption } from './dom.js';
import { formatDuration } from './format.js';

/** The value of the card select's `Same as Settings` option, which saves no `calendarSeconds`. */
export const SAME_AS_SETTINGS = '';

/**
 * The options of an interval select: the list, with the saved and the current value added when they are not in it,
 * in order of duration. The default of the list is marked `(default)`.
 */
export function intervalOptions(list: readonly number[], current: number | null, saved: number | null, defaultValue?: number): SelectOption[] {
  const values = [...list];
  for (const value of [saved, current]) {
    if (value !== null && Number.isFinite(value) && !values.includes(value)) {
      values.push(value);
    }
  }
  return values.sort((a, b) => a - b).map((value) => ({
    value: String(value),
    label: value === defaultValue ? DURATIONS.withDefault(formatDuration(value)) : formatDuration(value),
  }));
}
