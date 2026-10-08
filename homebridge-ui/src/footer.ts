import { FOOTER } from './copy.js';
import { el, outLink } from './dom.js';
import { renderMark } from './mark.js';

/**
 * Version and credit footer (SPEC 11.1 item 8, 11.3 G): the last element on the page, one line of secondary text
 * above a 1px rule. The version arrives from /version; without it the line reads "Busy Light". Both links open in a
 * new tab; the site link carries `?ref=busy-light` and nothing else is tracked.
 */

const MARK_SIZE = 20;

function item(...children: Array<Node | string>): HTMLElement {
  return el('span', { class: 'ns-footer-item' }, ...children);
}

export interface FooterHandle {
  el: HTMLElement;
  setVersion(version: string | undefined): void;
}

export function renderFooter(): FooterHandle {
  const label = document.createTextNode(FOOTER.name);
  const separator = (): string => ' · ';
  const footer = el('footer', { class: 'ns-footer form-text' },
    item(el('span', { class: 'ns-mark-label' }, renderMark(MARK_SIZE), label)), separator(),
    item(FOOTER.madeBy), separator(),
    item(outLink(FOOTER.site, FOOTER.siteUrl)), separator(),
    item(outLink(FOOTER.issues, FOOTER.issuesUrl)),
  );
  return {
    el: footer,
    setVersion(version) {
      label.textContent = version ? FOOTER.version(version) : FOOTER.name;
    },
  };
}
