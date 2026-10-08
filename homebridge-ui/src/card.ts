/**
 * The shell card (homebridge-notify-switch and homebridge-generac homebridge-ui/src/card.ts, the pieces this page
 * needs): a header strip with the bold title, its badges and a meta line, a body, a result area and a footer strip
 * with the red text button on the left and at most one outlined action on the right. A calendar card's header is
 * also the button that opens and closes it.
 */

import { el, type Child } from './dom.js';

export type BadgeKind = 'type' | 'connected' | 'checking' | 'warning' | 'danger' | 'muted' | 'new';

/**
 * A badge for a card header or a calendar row. `type` is the shell's type badge; the state pills use the host's
 * success (Connected), secondary (Checking, Not saved yet), warning (Sign-in needed) and danger (Not reachable) subtle
 * variables (SPEC 11.2 addition 2); `muted` is an outline in the secondary colour (Teams only, Default, Shared with
 * you) and `new` the link colour (New).
 */
export function badge(text: string, kind: BadgeKind): HTMLElement {
  if (kind === 'type') {
    return el('span', { class: 'badge text-bg-secondary ns-type-badge' }, text);
  }
  return el('span', { class: `badge bl-badge bl-badge-${kind}` }, text);
}

export interface CardOptions {
  /** The title node: the bold name, live as typed where there is a Name field. */
  title: Child;
  badges?: HTMLElement[];
  /** A secondary line at the right of the header (Last checked). */
  meta?: Child;
  /** Makes the header the button that opens and closes the card; the body and footer are drawn only while open. */
  toggle?: { expanded: boolean; onToggle(): void };
  /** A line under the header (the state file's error for this source). */
  notice?: Child;
  body: Child[];
  /** A result between the body and the footer (shell rule C6). */
  results?: Child;
  footerLeft?: Child[];
  footerRight?: Child;
  cls?: string;
  attrs?: Record<string, string>;
}

export function card(opts: CardOptions): HTMLElement {
  const title = el('span', { class: 'ns-card-title' }, opts.title, ...(opts.badges ?? []));
  let head: HTMLElement = title;
  if (opts.toggle) {
    const toggle = opts.toggle;
    head = el('button', { type: 'button', class: 'ns-card-toggle', 'aria-expanded': toggle.expanded ? 'true' : 'false' }, title);
    head.addEventListener('click', () => toggle.onToggle());
  }
  const open = !opts.toggle || opts.toggle.expanded;
  const node = el('div', { class: `card ns-card${opts.cls ? ` ${opts.cls}` : ''}${open ? '' : ' ns-card-closed'}`, ...(opts.attrs ?? {}) },
    el('div', { class: 'card-header ns-card-header' }, head, opts.meta ? el('span', { class: 'ns-card-meta' }, opts.meta) : null),
  );
  if (opts.notice) {
    node.appendChild(opts.notice as Node);
  }
  if (!open) {
    return node;
  }
  node.appendChild(el('div', { class: 'card-body' }, ...opts.body));
  if (opts.results) {
    node.appendChild(el('div', { class: 'ns-card-results' }, opts.results));
  }
  if (opts.footerRight || opts.footerLeft?.length) {
    // The primary side comes first in the markup and the row is reversed, so on a phone it stays on the top line.
    node.appendChild(el('div', { class: 'card-footer ns-card-footer' },
      el('div', { class: 'ns-footer-right' }, opts.footerRight),
      el('div', { class: 'ns-footer-left' }, ...(opts.footerLeft ?? [])),
    ));
  }
  return node;
}

/** The bold card name. */
export function cardName(text: string): HTMLElement {
  return el('span', { class: 'ns-card-name' }, text);
}
