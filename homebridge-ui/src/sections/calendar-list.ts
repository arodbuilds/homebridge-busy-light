/**
 * "Calendars to use" (SPEC 11.3 C): the rows of an iCloud or Microsoft 365 card, each a checkbox with the calendar's
 * name, today's count and its badges, and on a ticked row its Counts for choice. Ticking writes the card's `calendars`
 * list with ids and `use`, in the order the server listed them (SPEC 9.1 items 13 to 15).
 */

import type { App, ListState } from '../app.js';
import { badge } from '../card.js';
import { CALENDARS } from '../copy.js';
import { el, helpText, uniqueId } from '../dom.js';
import type { UiChoice, UiSource, Use } from '../model.js';
import { sourcePath } from '../validate.js';

/** A calendar as Connect listed it, or a saved entry before Connect. */
export interface Row {
  /** The calendar's id; a build 1 entry that names its calendar only has none. */
  id: string | null;
  name: string;
  eventsToday: number | null;
  shared: boolean;
  subscribed: boolean;
  isDefault: boolean;
}

/** Two ids name the same calendar: paths compare decoded and without regard to a trailing slash, as the plugin compares them. */
export function sameId(a: string, b: string): boolean {
  const norm = (p: string): string => {
    let decoded = p;
    try {
      decoded = decodeURIComponent(p);
    } catch {
      // keep it as written
    }
    return decoded.replace(/\/+$/, '');
  };
  return norm(a) === norm(b);
}

/** Whether a list entry is this row: by id, or by name for an entry that has none. */
export function matches(choice: UiChoice, row: Row): boolean {
  if (choice.id !== null && row.id !== null) {
    return sameId(choice.id, row.id);
  }
  return choice.id === null && choice.name.toLowerCase() === row.name.toLowerCase();
}

/**
 * After Connect, every entry the plugin would match by name (a build 1 name, or an id that no longer matches) takes
 * the id of the calendar it names, so the list is written with ids from then on. True when anything changed.
 */
export function adoptIds(s: UiSource, listed: Row[]): boolean {
  let changed = false;
  for (const choice of [...s.calendars]) {
    if (choice.id !== null && listed.some((r) => r.id !== null && sameId(r.id, choice.id!))) {
      continue;
    }
    const name = choice.name.toLowerCase();
    const rows = listed.filter((r) => !r.subscribed && r.id !== null && r.name.toLowerCase() === name
      && !s.calendars.some((c) => c.id !== null && sameId(c.id, r.id!)));
    if (rows.length > 0) {
      choice.id = rows[0].id;
      choice.name = rows[0].name;
      // The plugin reads every calendar a name matches, so each one stays ticked.
      for (const row of rows.slice(1)) {
        s.calendars.push({ id: row.id, name: row.name, use: choice.use });
      }
      changed = true;
    }
  }
  return changed;
}

function toRow(choice: UiChoice): Row {
  return { id: choice.id, name: choice.name || CALENDARS.newCalendar, eventsToday: null, shared: false, subscribed: false, isDefault: false };
}

/**
 * The rows to draw: after Connect the calendars listed, then any ticked entry that is not among them (deleted or
 * unshared since); before it, the saved entries and anything ticked since.
 */
export function rowsFor(s: UiSource, state: ListState | undefined, saved: UiChoice[]): Row[] {
  const rows: Row[] = state?.listed ? state.listed.map((c) => ({
    id: c.id, name: c.name, eventsToday: c.eventsToday, shared: c.shared,
    subscribed: 'subscribed' in c ? c.subscribed : false, isDefault: 'isDefault' in c ? c.isDefault : false,
  })) : saved.map(toRow);
  for (const choice of s.calendars) {
    if (!rows.some((r) => matches(choice, r))) {
      rows.push(toRow(choice));
    }
  }
  return rows;
}

/**
 * New: in the list from Connect, but neither in the saved list nor ticked before on this page. A subscribed calendar,
 * which cannot be ticked, is never New.
 */
export function isNew(row: Row, state: ListState | undefined, saved: UiChoice[]): boolean {
  if (!state?.listed || row.id === null || row.subscribed) {
    return false;
  }
  return !saved.some((c) => matches(c, row)) && ![...state.tickedBefore].some((id) => sameId(id, row.id!));
}

export interface ListOptions {
  state: ListState | undefined;
  saved: UiChoice[];
  /** Badges after the count, in the order of SPEC 11.3 C (Default, Shared with you, New). */
  badges(row: Row): HTMLElement[];
  /** The line under a row that cannot be ticked (a subscribed iCloud calendar). */
  disabledLine?(row: Row): string | null;
}

function useSelect(choice: UiChoice, onChange: (use: Use) => void): HTMLElement {
  const id = uniqueId('use');
  const select = el('select', { id, class: 'form-select form-select-sm bl-cal-use' },
    el('option', { value: 'all', selected: choice.use === 'all' }, CALENDARS.countsAll),
    el('option', { value: 'outOfOffice', selected: choice.use === 'outOfOffice' }, CALENDARS.countsOutOfOffice),
  );
  select.value = choice.use;
  select.addEventListener('change', () => onChange(select.value === 'outOfOffice' ? 'outOfOffice' : 'all'));
  return el('div', { class: 'bl-cal-use-field' }, el('label', { class: 'form-label bl-cal-use-label', for: id }, CALENDARS.countsFor), select);
}

/** The rows of a card's list, redrawn in place when one is ticked, keeping focus on that row's checkbox. */
export function calendarList(app: App, s: UiSource, opts: ListOptions): HTMLElement {
  let node: HTMLElement | null = null;
  let build: () => HTMLElement = () => el('div');

  const redraw = (focusKey: string | null): void => {
    const next = build();
    node?.parentNode?.insertBefore(next, node);
    node?.remove();
    node = next;
    if (focusKey !== null) {
      [...next.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find((i) => i.dataset.row === focusKey)?.focus();
    }
  };

  build = (): HTMLElement => {
    const rows = rowsFor(s, opts.state, opts.saved);
    const list = el('div', { class: 'bl-cal-list', 'data-path': sourcePath(s, 'calendars') });
    rows.forEach((row, i) => {
      const key = `${i}`;
      const choice = s.calendars.find((c) => matches(c, row));
      const line = opts.disabledLine?.(row) ?? null;
      const id = uniqueId('cal');
      const input = el('input', { id, class: 'form-check-input', type: 'checkbox', 'data-row': key });
      input.checked = !!choice;
      input.disabled = line !== null;
      input.addEventListener('change', () => {
        if (input.checked && !s.calendars.some((c) => matches(c, row))) {
          s.calendars.push({ id: row.id, name: row.name, use: 'all' });
          if (row.id !== null) {
            opts.state?.tickedBefore.add(row.id);
          }
        } else if (!input.checked) {
          s.calendars = s.calendars.filter((c) => !matches(c, row));
        }
        // Written in the order the calendars are listed.
        s.calendars.sort((a, b) => rows.findIndex((r) => matches(a, r)) - rows.findIndex((r) => matches(b, r)));
        redraw(key);
        app.touch(sourcePath(s, 'calendars'));
        app.changed();
      });
      const head = el('div', { class: 'form-check bl-cal-check' },
        input,
        el('label', { class: 'form-check-label', for: id }, row.name),
        row.eventsToday !== null ? el('span', { class: 'bl-cal-meta' }, CALENDARS.eventsToday(row.eventsToday)) : null,
        ...opts.badges(row),
      );
      list.appendChild(el('div', { class: `bl-cal-row${line !== null ? ' bl-cal-row-disabled' : ''}` },
        head,
        choice ? useSelect(choice, (use) => {
          choice.use = use;
          app.changed();
        }) : null,
        line !== null ? el('div', { class: 'form-text bl-cal-line' }, line) : null,
      ));
    });
    if (s.calendars.length > 0) {
      list.appendChild(helpText(CALENDARS.countsHelp));
    }
    list.appendChild(el('div', { class: 'invalid-feedback' }));
    return list;
  };

  node = build();
  return node;
}

/** The badges of an iCloud or Microsoft row: Default, Shared with you, New. */
export function rowBadges(row: Row, state: ListState | undefined, saved: UiChoice[], labels: { isDefault?: string }): HTMLElement[] {
  const out: HTMLElement[] = [];
  if (row.isDefault && labels.isDefault) {
    out.push(badge(labels.isDefault, 'muted'));
  }
  if (row.shared) {
    out.push(badge(CALENDARS.shared, 'muted'));
  }
  if (isNew(row, state, saved)) {
    out.push(badge(CALENDARS.isNew, 'new'));
  }
  return out;
}
