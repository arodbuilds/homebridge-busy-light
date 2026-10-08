/**
 * The Busy Light footer mark (assets/busy-light-footer.svg without its metadata), drawn inline so the footer loads no
 * file (SPEC 11.1 item 8). A test keeps these shapes equal to the asset. It uses `currentColor`, so it takes the
 * surrounding text colour and follows the host's theme.
 */
const SHAPES: ReadonlyArray<readonly [string, Record<string, string>]> = [
  ['rect', { x: '4', y: '5', width: '16', height: '15' }],
  ['path', { d: 'M4 9.5H20' }],
  ['path', { d: 'M8.5 2.75V6.75M15.5 2.75V6.75' }],
  ['rect', { x: '13', y: '12.75', width: '4.25', height: '4.25', fill: 'currentColor', stroke: 'none' }],
];

/** The drawing as the asset sets it on its root: no fill, a 1.5 stroke in the text colour, round caps. */
export const MARK_ROOT = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5', 'stroke-linecap': 'round' };

export const MARK_SHAPES = SHAPES;

/** The mark at `size` CSS pixels, decorative (`aria-hidden`), in the surrounding text colour. */
export function renderMark(size: number): SVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  for (const [k, v] of Object.entries(MARK_ROOT)) {
    svg.setAttribute(k, v);
  }
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', 'ns-mark-svg');
  for (const [tag, attrs] of SHAPES) {
    const node = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) {
      node.setAttribute(k, v);
    }
    svg.appendChild(node);
  }
  return svg;
}
