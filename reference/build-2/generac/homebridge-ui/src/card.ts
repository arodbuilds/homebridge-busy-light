/**
 * The shell card (homebridge-notify-switch homebridge-ui/src/card.ts, the pieces this page needs): a header strip
 * with the bold title and its badges, a body, and a footer strip with at most one outlined action on the right.
 */

import { el, type Child } from './dom.js';

export type BadgeKind = 'status' | 'outline' | 'warn' | 'ready' | 'running' | 'exercising' | 'fault' | 'muted';

/**
 * A badge for a card header or a status row. `status` is the shell's success-filled status badge (Connected);
 * the rest follow SPEC section 11.2: success (Ready), info (Running, Exercising), danger (Fault) and secondary
 * (Not responding) subtle variables, warning for Maintenance due and Low, an outline for Checking.
 */
export function badge(text: string, kind: BadgeKind): HTMLElement {
  if (kind === 'status') {
    return el('span', { class: 'badge text-bg-success ns-status-badge' }, text);
  }
  return el('span', { class: `badge gn-badge gn-badge-${kind}` }, text);
}

export interface CardOptions {
  /** The title node (a name, or a name with its subtitle lines). */
  title: Child;
  badges?: HTMLElement[];
  body: Child[];
  footerRight?: HTMLElement | null;
  cls?: string;
}

export function card(opts: CardOptions): HTMLElement {
  const node = el('div', { class: `card ns-card${opts.cls ? ` ${opts.cls}` : ''}` },
    el('div', { class: 'card-header ns-card-header' },
      el('span', { class: 'ns-card-title' }, opts.title, ...(opts.badges ?? [])),
    ),
    el('div', { class: 'card-body' }, ...opts.body),
  );
  if (opts.footerRight) {
    node.appendChild(el('div', { class: 'card-footer ns-card-footer' }, el('div', { class: 'ns-footer-right' }, opts.footerRight)));
  }
  return node;
}

/** The bold card name, live from the Name field where there is one. */
export function cardName(text: string): HTMLElement {
  return el('span', { class: 'ns-card-name' }, text);
}
