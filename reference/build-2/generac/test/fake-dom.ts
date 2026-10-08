/**
 * A small DOM for rendering the settings page under node:test: elements with attributes, classes, dataset,
 * children, text and listeners, a selector engine covering what the page's queries use (tags, classes, ids,
 * attribute presence and equality, descendant and child chains, `:scope` and comma-separated groups), focus,
 * bubbling events, and timers on a clock the test advances. `installFakeDom()` exposes it as `window`,
 * `document` and `HTMLElement`, so the page modules (which read both at call time) are imported afterwards
 * with a dynamic import. Nothing lays out or paints; the tests read the tree the page built.
 */
import { setImmediate } from 'node:timers/promises';

type Listener = (event: FakeEvent) => void;

export class FakeEvent {
  target: FakeNode | FakeDocument | null = null;
  currentTarget: FakeNode | FakeDocument | null = null;
  defaultPrevented = false;
  propagationStopped = false;
  readonly key: string;

  constructor(readonly type: string, readonly bubbles: boolean, init: { key?: string } = {}) {
    this.key = init.key ?? '';
  }

  preventDefault(): void {
    this.defaultPrevented = true;
  }

  stopPropagation(): void {
    this.propagationStopped = true;
  }
}

/** Events that bubble in a browser; everything else is delivered to the target alone. */
const BUBBLES = new Set(['click', 'input', 'change', 'keydown', 'keyup', 'focusin', 'focusout']);

export abstract class FakeNode {
  parentNode: FakeElement | null = null;
  abstract readonly nodeType: number;
  abstract get textContent(): string;
  abstract set textContent(value: string);

  get parentElement(): FakeElement | null {
    return this.parentNode;
  }
}

export class FakeText extends FakeNode {
  readonly nodeType = 3;

  constructor(public data: string) {
    super();
  }

  get textContent(): string {
    return this.data;
  }

  set textContent(value: string) {
    this.data = String(value);
  }
}

const SIMPLE = /^([a-zA-Z*][\w-]*)?((?:[.#][\w-]+|\[[\w-]+(?:=(?:"[^"]*"|[^\]]*))?\])*)$/;
const PIECES = /[.#][\w-]+|\[[\w-]+(?:=(?:"[^"]*"|[^\]]*))?\]/g;
const ATTRIBUTE = /^\[([\w-]+)(?:=(?:"([^"]*)"|([^\]]*)))?\]$/;

function matchesSimple(node: FakeElement, simple: string, scope: FakeElement | null): boolean {
  if (simple === ':scope') {
    return node === scope;
  }
  const parts = SIMPLE.exec(simple);
  if (!parts) {
    throw new Error(`Unsupported selector: ${simple}`);
  }
  const [, tag, rest] = parts;
  if (tag && tag !== '*' && node.tagName !== tag.toUpperCase()) {
    return false;
  }
  for (const piece of rest.match(PIECES) ?? []) {
    if (piece.startsWith('.')) {
      if (!node.classList.contains(piece.slice(1))) {
        return false;
      }
    } else if (piece.startsWith('#')) {
      if (node.getAttribute('id') !== piece.slice(1)) {
        return false;
      }
    } else {
      const m = ATTRIBUTE.exec(piece)!;
      const [, name, quoted, bare] = m;
      const value = node.getAttribute(name);
      if (value === null) {
        return false;
      }
      if ((quoted !== undefined || bare !== undefined) && value !== (quoted ?? bare)) {
        return false;
      }
    }
  }
  return true;
}

/** Matches one selector without commas, walking ancestors for descendant and child combinators. */
function matchesCompound(node: FakeElement, compound: string, scope: FakeElement | null): boolean {
  const tokens = compound.replace(/\s*>\s*/g, ' > ').trim().split(/\s+/);
  let index = tokens.length - 1;
  if (!matchesSimple(node, tokens[index], scope)) {
    return false;
  }
  let current: FakeElement | null = node;
  for (index -= 1; index >= 0; index -= 1) {
    let child = false;
    if (tokens[index] === '>') {
      child = true;
      index -= 1;
    }
    const wanted = tokens[index];
    current = current.parentNode;
    if (!child) {
      while (current && !matchesSimple(current, wanted, scope)) {
        current = current.parentNode;
      }
    }
    if (!current || !matchesSimple(current, wanted, scope)) {
      return false;
    }
  }
  return true;
}

function splitGroups(selector: string): string[] {
  return selector.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
}

class ClassList {
  constructor(private readonly node: FakeElement) {}

  private get names(): string[] {
    return (this.node.getAttribute('class') ?? '').split(/\s+/).filter((n) => n.length > 0);
  }

  private set names(value: string[]) {
    this.node.setAttribute('class', value.join(' '));
  }

  contains(name: string): boolean {
    return this.names.includes(name);
  }

  add(...names: string[]): void {
    const current = this.names;
    for (const name of names) {
      if (!current.includes(name)) {
        current.push(name);
      }
    }
    this.names = current;
  }

  remove(...names: string[]): void {
    this.names = this.names.filter((n) => !names.includes(n));
  }

  toggle(name: string, force?: boolean): boolean {
    const on = force ?? !this.contains(name);
    if (on) {
      this.add(name);
    } else {
      this.remove(name);
    }
    return on;
  }
}

export class FakeElement extends FakeNode {
  readonly nodeType = 1;
  readonly tagName: string;
  readonly childNodes: FakeNode[] = [];
  readonly classList = new ClassList(this);
  readonly style: Record<string, string> = {};
  private readonly attributes = new Map<string, string>();
  private readonly listeners = new Map<string, Set<Listener>>();
  /** Input state, kept as properties like a browser does (not attributes). */
  private valueState: string | null = null;
  checked = false;
  disabled = false;
  open = false;
  hidden = false;
  /** How often `scrollIntoView` was called and with what. */
  readonly scrolledInto: unknown[] = [];

  constructor(tagName: string, readonly ownerDocument: FakeDocument) {
    super();
    this.tagName = tagName.toUpperCase();
  }

  // --- tree ---------------------------------------------------------------

  get children(): FakeElement[] {
    return this.childNodes.filter((n): n is FakeElement => n instanceof FakeElement);
  }

  get firstChild(): FakeNode | null {
    return this.childNodes[0] ?? null;
  }

  get lastChild(): FakeNode | null {
    return this.childNodes[this.childNodes.length - 1] ?? null;
  }

  get firstElementChild(): FakeElement | null {
    return this.children[0] ?? null;
  }

  get nextElementSibling(): FakeElement | null {
    if (!this.parentNode) {
      return null;
    }
    const siblings = this.parentNode.children;
    return siblings[siblings.indexOf(this) + 1] ?? null;
  }

  get previousElementSibling(): FakeElement | null {
    if (!this.parentNode) {
      return null;
    }
    const siblings = this.parentNode.children;
    return siblings[siblings.indexOf(this) - 1] ?? null;
  }

  appendChild<T extends FakeNode>(node: T): T {
    if (node.parentNode) {
      node.parentNode.removeChild(node);
    }
    node.parentNode = this;
    this.childNodes.push(node);
    return node;
  }

  insertBefore<T extends FakeNode>(node: T, reference: FakeNode | null): T {
    if (!reference) {
      return this.appendChild(node);
    }
    if (node.parentNode) {
      node.parentNode.removeChild(node);
    }
    const index = this.childNodes.indexOf(reference);
    if (index < 0) {
      throw new Error('insertBefore: reference is not a child');
    }
    node.parentNode = this;
    this.childNodes.splice(index, 0, node);
    return node;
  }

  after(...nodes: FakeNode[]): void {
    const parent = this.parentNode;
    if (!parent) {
      return;
    }
    const reference = parent.childNodes[parent.childNodes.indexOf(this) + 1] ?? null;
    for (const node of nodes) {
      parent.insertBefore(node, reference);
    }
  }

  removeChild<T extends FakeNode>(node: T): T {
    const index = this.childNodes.indexOf(node);
    if (index < 0) {
      throw new Error('removeChild: not a child');
    }
    this.childNodes.splice(index, 1);
    node.parentNode = null;
    if (node instanceof FakeElement && node.contains(this.ownerDocument.activeElement)) {
      this.ownerDocument.activeElement = this.ownerDocument.body;
    }
    return node;
  }

  remove(): void {
    this.parentNode?.removeChild(this);
  }

  contains(node: FakeNode | null): boolean {
    for (let current: FakeNode | null = node; current; current = current.parentNode) {
      if (current === this) {
        return true;
      }
    }
    return false;
  }

  // --- attributes and text --------------------------------------------------

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, String(value));
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  get id(): string {
    return this.getAttribute('id') ?? '';
  }

  get className(): string {
    return this.getAttribute('class') ?? '';
  }

  set className(value: string) {
    this.setAttribute('class', value);
  }

  get dataset(): Record<string, string | undefined> {
    const out: Record<string, string> = {};
    for (const [name, value] of this.attributes) {
      if (name.startsWith('data-')) {
        out[name.slice(5).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())] = value;
      }
    }
    return out;
  }

  get type(): string {
    return this.getAttribute('type') ?? (this.tagName === 'INPUT' ? 'text' : '');
  }

  set type(value: string) {
    this.setAttribute('type', value);
  }

  /** An input's value: the attribute until the page or the test writes the property. */
  get value(): string {
    return this.valueState ?? this.getAttribute('value') ?? '';
  }

  set value(value: string) {
    this.valueState = String(value);
  }

  get textContent(): string {
    return this.childNodes.map((n) => n.textContent).join('');
  }

  set textContent(value: string) {
    this.childNodes.splice(0).forEach((n) => {
      n.parentNode = null;
    });
    if (value !== '') {
      this.appendChild(new FakeText(value));
    }
  }

  // --- events and focus ---------------------------------------------------

  addEventListener(type: string, fn: Listener): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(fn);
  }

  removeEventListener(type: string, fn: Listener): void {
    this.listeners.get(type)?.delete(fn);
  }

  /** Calls this node's listeners for the event (the document dispatches and bubbles). */
  invoke(event: FakeEvent): void {
    event.currentTarget = this;
    for (const fn of [...(this.listeners.get(event.type) ?? [])]) {
      fn(event);
    }
  }

  dispatchEvent(event: FakeEvent): boolean {
    return this.ownerDocument.dispatch(this, event);
  }

  click(): void {
    if (this.disabled) {
      return;
    }
    this.dispatchEvent(new FakeEvent('click', true));
  }

  focus(): void {
    const doc = this.ownerDocument;
    if (doc.activeElement === this) {
      return;
    }
    const previous = doc.activeElement;
    if (previous && previous !== doc.body) {
      previous.blur();
    }
    doc.activeElement = this;
    this.dispatchEvent(new FakeEvent('focus', false));
    this.dispatchEvent(new FakeEvent('focusin', true));
  }

  blur(): void {
    const doc = this.ownerDocument;
    if (doc.activeElement !== this) {
      return;
    }
    doc.activeElement = doc.body;
    this.dispatchEvent(new FakeEvent('blur', false));
    this.dispatchEvent(new FakeEvent('focusout', true));
  }

  select(): void {
    // Nothing to select in a tree that does not render.
  }

  scrollIntoView(arg?: unknown): void {
    this.scrolledInto.push(arg);
  }

  // --- selectors ----------------------------------------------------------

  matches(selector: string, scope: FakeElement | null = null): boolean {
    return splitGroups(selector).some((compound) => matchesCompound(this, compound, scope));
  }

  closest(selector: string): FakeElement | null {
    if (this.matches(selector)) {
      return this;
    }
    return this.parentNode ? this.parentNode.closest(selector) : null;
  }

  *descendants(): IterableIterator<FakeElement> {
    for (const child of this.children) {
      yield child;
      yield* child.descendants();
    }
  }

  querySelectorAll(selector: string): FakeElement[] {
    return [...this.descendants()].filter((node) => node.matches(selector, this));
  }

  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
}

export class FakeDocument {
  readonly documentElement: FakeElement;
  readonly head: FakeElement;
  readonly body: FakeElement;
  activeElement: FakeElement;
  readonly readyState = 'complete';
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor() {
    this.documentElement = new FakeElement('html', this);
    this.head = this.documentElement.appendChild(new FakeElement('head', this));
    this.body = this.documentElement.appendChild(new FakeElement('body', this));
    this.activeElement = this.body;
  }

  createElement(tagName: string): FakeElement {
    return new FakeElement(tagName, this);
  }

  /** SVG elements (the footer mark) are plain elements here; the namespace is not kept. */
  createElementNS(_ns: string, tagName: string): FakeElement {
    return new FakeElement(tagName, this);
  }

  createTextNode(text: string): FakeText {
    return new FakeText(String(text));
  }

  getElementById(id: string): FakeElement | null {
    return this.documentElement.querySelector(`#${id}`);
  }

  querySelectorAll(selector: string): FakeElement[] {
    return this.documentElement.querySelectorAll(selector);
  }

  querySelector(selector: string): FakeElement | null {
    return this.documentElement.querySelector(selector);
  }

  addEventListener(type: string, fn: Listener): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(fn);
  }

  removeEventListener(type: string, fn: Listener): void {
    this.listeners.get(type)?.delete(fn);
  }

  /** Delivers an event to its target, then up the ancestors and the document when it bubbles. */
  dispatch(target: FakeElement, event: FakeEvent): boolean {
    event.target = target;
    const bubbles = event.bubbles || BUBBLES.has(event.type);
    for (let current: FakeElement | null = target; current; current = current.parentNode) {
      current.invoke(event);
      if (!bubbles || event.propagationStopped) {
        break;
      }
    }
    if (bubbles && !event.propagationStopped) {
      event.currentTarget = this;
      for (const fn of [...(this.listeners.get(event.type) ?? [])]) {
        fn(event);
      }
    }
    return !event.defaultPrevented;
  }

  dispatchEvent(event: FakeEvent): boolean {
    event.target = this;
    for (const fn of [...(this.listeners.get(event.type) ?? [])]) {
      fn(event);
    }
    return !event.defaultPrevented;
  }
}

/** Lets pending promise chains settle. */
export async function flush(rounds = 4): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await setImmediate();
  }
}

interface Timer {
  id: number;
  due: number;
  fn: () => void;
  every: number | null;
}

/** Timers and Date.now on one clock; `advance` runs what comes due and lets promises settle between timers. */
export class FakeClock {
  now: number;
  private next = 1;
  private timers: Timer[] = [];

  constructor(start = Date.parse('2026-09-15T19:14:44Z')) {
    this.now = start;
  }

  setTimeout(fn: () => void, ms = 0): number {
    return this.schedule(fn, ms, null);
  }

  setInterval(fn: () => void, ms: number): number {
    return this.schedule(fn, ms, Math.max(1, ms));
  }

  clear(id: number | undefined): void {
    this.timers = this.timers.filter((t) => t.id !== id);
  }

  /** Drops every pending timer (a page from an earlier test stops polling). */
  clearAll(): void {
    this.timers = [];
  }

  private schedule(fn: () => void, ms: number, every: number | null): number {
    const id = this.next++;
    this.timers.push({ id, due: this.now + Math.max(0, ms), fn, every });
    return id;
  }

  /** Advances the clock, firing due timers in order (an interval re-arms itself). */
  async advance(ms: number): Promise<void> {
    const end = this.now + ms;
    for (;;) {
      const due = this.timers.filter((t) => t.due <= end).sort((a, b) => a.due - b.due || a.id - b.id)[0];
      if (!due) {
        break;
      }
      this.now = Math.max(this.now, due.due);
      if (due.every === null) {
        this.clear(due.id);
      } else {
        due.due += due.every;
      }
      due.fn();
      await flush();
    }
    this.now = end;
    await flush();
  }
}

export interface FakeDom {
  document: FakeDocument;
  window: Record<string, unknown>;
  clock: FakeClock;
  restore(): void;
}

/** Installs the fake DOM on the global object. The page modules are imported afterwards with a dynamic import. */
export function installFakeDom(): FakeDom {
  const document = new FakeDocument();
  const clock = new FakeClock();
  const window: Record<string, unknown> = {
    document,
    setTimeout: (fn: () => void, ms?: number) => clock.setTimeout(fn, ms),
    clearTimeout: (id?: number) => clock.clear(id),
    setInterval: (fn: () => void, ms: number) => clock.setInterval(fn, ms),
    clearInterval: (id?: number) => clock.clear(id),
    matchMedia: () => ({ matches: false }),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
  const g = globalThis as Record<string, unknown>;
  const saved = { window: g.window, document: g.document, HTMLElement: g.HTMLElement, now: Date.now };
  g.window = window;
  g.document = document;
  g.HTMLElement = FakeElement;
  Date.now = () => clock.now;
  return {
    document,
    window,
    clock,
    restore() {
      g.window = saved.window;
      g.document = saved.document;
      g.HTMLElement = saved.HTMLElement;
      Date.now = saved.now;
    },
  };
}

/** Types into an input: sets the value and fires `input`. */
export function type(input: FakeElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new FakeEvent('input', true));
}

/** The visible text of a node, whitespace collapsed. */
export function text(node: FakeNode | null): string {
  return (node?.textContent ?? '').replace(/\s+/g, ' ').trim();
}
