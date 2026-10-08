/**
 * Small XML helpers for CalDAV responses (SPEC 5.1). They ignore namespace prefixes, since servers use different
 * prefix styles for the same elements, and decode entities and CDATA. No XML dependency.
 */

/** The inner XML of every element with this local name, whatever its prefix. Self-closing elements are skipped. */
export function xmlBlocks(xml: string, local: string): string[] {
  const name = local.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`<(?:[\\w.-]+:)?${name}(?:\\s[^>]*)?(?<!/)>([\\s\\S]*?)</(?:[\\w.-]+:)?${name}\\s*>`, 'gi');
  const out: string[] = [];
  for (const m of xml.matchAll(re)) {
    out.push(m[1]);
  }
  return out;
}

/** True when an element with this local name appears, open or self-closing. */
export function xmlHas(xml: string, local: string): boolean {
  const name = local.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`<(?:[\\w.-]+:)?${name}[\\s/>]`, 'i').test(xml);
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, '\'')
    .replace(/&amp;/g, '&');
}

/** Text content with CDATA unwrapped and entities decoded. */
export function xmlText(s: string): string {
  let out = '';
  let rest = s;
  for (;;) {
    const start = rest.indexOf('<![CDATA[');
    if (start < 0) {
      out += decodeEntities(rest);
      break;
    }
    const end = rest.indexOf(']]>', start);
    if (end < 0) {
      out += decodeEntities(rest);
      break;
    }
    out += decodeEntities(rest.slice(0, start)) + rest.slice(start + 9, end);
    rest = rest.slice(end + 3);
  }
  return out;
}
