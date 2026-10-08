import { el } from './dom.js';

/**
 * The Generac for Homebridge mark (assets/generac-mark.svg without its metadata), drawn inline so the footer
 * loads no file. It uses `currentColor`, so it takes the surrounding text colour and follows the host's theme.
 */
const PATHS = [
  ['rect', { x: '30', y: '34', width: '132', height: '90', rx: '12' }],
  ['path', { d: 'M56 62H94M56 79H94M56 96H94', 'stroke-linecap': 'round' }],
  ['rect', { x: '112', y: '64', width: '30', height: '30', rx: '6' }],
  ['path', { d: 'M66 124V148M126 124V148', 'stroke-linecap': 'round' }],
  ['path', { d: 'M18 154H174', 'stroke-linecap': 'round' }],
] as const;

/** The mark at `size` CSS pixels, decorative (`aria-hidden`), in the surrounding text colour. */
export function renderMark(size: number): SVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 192 192');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('ns-mark-svg');
  for (const [tag, attrs] of PATHS) {
    const node = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) {
      node.setAttribute(k, v);
    }
    node.setAttribute('fill', 'none');
    node.setAttribute('stroke', 'currentColor');
    node.setAttribute('stroke-width', '12');
    svg.appendChild(node);
  }
  return el('span', { class: 'ns-mark' }, svg).firstElementChild as SVGElement;
}
