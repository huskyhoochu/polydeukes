import { parse } from 'yaml';

/** One markdown document: its identifier and full text. */
export type ParseDocumentSpec = { id: string; text: string };

/** One row of a document: the preamble (anchor `''`) or one H2 section. */
export type ParsedSection = { anchor: string; ord: number; title: string; body: string };

/** A document split into its title, section rows, and optional frontmatter mapping. */
export type ParsedDocument = {
  id: string;
  title: string;
  sections: ParsedSection[];
  metadata?: Record<string, unknown>;
};

// A backtick fence's info string may not contain a backtick; a tilde fence's may.
const FENCE = /^ {0,3}(`{3,}(?=[^`]*$)|~{3,})/;
const H1 = /^ {0,3}#(?:[ \t](.*))?$/;
const H2 = /^ {0,3}##(?:[ \t](.*))?$/;
const EXPLICIT_ANCHOR = /\s*\{#([^}]+)\}\s*$/;
const CLOSING_HASHES = /(?:^|\s+)#+\s*$/;

function frontmatterMetadata(yamlText: string): Record<string, unknown> | undefined {
  try {
    const data: unknown = parse(yamlText);
    if (typeof data !== 'object' || data === null || Array.isArray(data)) return undefined;
    return data as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function slug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}_\- ]/gu, '')
    .replace(/ /g, '-');
}

/** Splits a markdown text into a title and preamble + H2 section rows; never refuses a text. */
export function parseDocument({ id, text: raw }: ParseDocumentSpec): ParsedDocument {
  const text = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  let content = text;
  let metadata: Record<string, unknown> | undefined;
  if (text.startsWith('---\n')) {
    const end = text.indexOf('\n---\n', 3);
    if (end !== -1) {
      metadata = frontmatterMetadata(text.slice(4, end));
      content = text.slice(end + 5);
    }
  }

  let h1Title: string | undefined;
  const preamble: string[] = [];
  const headings: { title: string; anchor: string | undefined; lines: string[] }[] = [];
  let fence: { char: string; length: number } | undefined;

  for (const line of content === '' ? [] : content.split('\n')) {
    const current = headings.at(-1)?.lines ?? preamble;
    if (fence) {
      const close = line.match(FENCE);
      const marker = close?.[1];
      if (marker?.[0] === fence.char && marker.length >= fence.length && line.trim() === marker) {
        fence = undefined;
      }
      current.push(line);
      continue;
    }
    const open = line.match(FENCE)?.[1];
    if (open) {
      fence = { char: open[0] as string, length: open.length };
      current.push(line);
      continue;
    }
    const h2 = line.match(H2);
    if (h2) {
      let title = h2[1] ?? '';
      const explicit = title.match(EXPLICIT_ANCHOR);
      if (explicit) title = title.slice(0, explicit.index);
      title = title.replace(CLOSING_HASHES, '').trim();
      headings.push({ title, anchor: explicit?.[1], lines: [] });
      continue;
    }
    if (h1Title === undefined) {
      const h1 = line.match(H1);
      const title = (h1?.[1] ?? '').replace(EXPLICIT_ANCHOR, '').replace(CLOSING_HASHES, '').trim();
      if (title !== '') h1Title = title;
    }
    current.push(line);
  }

  const sections: ParsedSection[] = [];
  const preambleBody = preamble.join('\n');
  if (preambleBody.trim() !== '') {
    sections.push({ anchor: '', ord: 0, title: '', body: preambleBody });
  }
  // The preamble's '' is always taken, so an H2 whose slug is empty never collides with it.
  const used = new Set<string>(['']);
  for (const heading of headings) {
    const base = heading.anchor ?? slug(heading.title);
    let anchor = base;
    for (let n = 1; used.has(anchor); n++) anchor = `${base}-${n}`;
    used.add(anchor);
    sections.push({
      anchor,
      ord: sections.length,
      title: heading.title,
      body: heading.lines.join('\n'),
    });
  }

  const fmTitle = metadata?.title;
  const title = typeof fmTitle === 'string' && fmTitle.trim() !== '' ? fmTitle : (h1Title ?? id);
  return metadata ? { id, title, sections, metadata } : { id, title, sections };
}
