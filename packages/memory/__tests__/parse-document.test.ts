import { describe, expect, it } from 'vitest';
import { parseDocument } from '../src/parse-document.ts';

// The document identifier is a fixture value: the parser never derives it from the text.
const DOC_ID = 'memory/adr/sample-document';

function parse(text: string) {
  return parseDocument({ id: DOC_ID, text });
}

function sectionShapes(text: string) {
  return parse(text).sections.map(({ anchor, ord, title }) => ({ anchor, ord, title }));
}

describe('parseDocument — title', () => {
  // Reading the H1 first (or only the H1) drops the frontmatter title the document declares.
  it('prefers the frontmatter title over the first H1', () => {
    const doc = parse('---\ntitle: From frontmatter\n---\n# From H1\n\n## First\n');
    expect(doc.title).toBe('From frontmatter');
  });

  // A YAML error that propagates rejects the document; one that is swallowed without
  // stripping the block leaks the broken YAML into the preamble body.
  it('falls back to the H1 when the frontmatter is not valid YAML, and still returns the document', () => {
    const doc = parse(
      '---\ntitle: [unclosed\n---\n# Heading one {#h1}\n\nPreamble.\n\n## First\n\nBody.\n',
    );
    expect(doc.title).toBe('Heading one');
    expect(doc.sections.map((s) => s.anchor)).toEqual(['', 'first']);
    expect(doc.sections[0]?.body).not.toContain('[unclosed');
  });

  // A parser that requires a frontmatter block returns nothing (or throws) for plain markdown.
  it('reads a document without frontmatter, taking the title from the H1', () => {
    const doc = parse('# Plain document\n\nIntro.\n\n## First\n\nBody.\n');
    expect(doc.title).toBe('Plain document');
    expect(doc.sections.map((s) => s.anchor)).toEqual(['', 'first']);
    expect(doc.sections[0]?.body).toContain('# Plain document');
  });

  // With neither frontmatter title nor H1 the title falls to the identifier, never to '' or undefined.
  it('falls back to the document identifier when there is no frontmatter title and no H1', () => {
    const doc = parse('Just prose.\n\n## First\n');
    expect(doc.title).toBe(DOC_ID);
  });

  // An empty text is the degenerate document: one identifier, no rows, no throw.
  it('returns a document with no sections for an empty text', () => {
    expect(parse('')).toEqual({ id: DOC_ID, title: DOC_ID, sections: [] });
  });
});

describe('parseDocument — sections', () => {
  // Text before the first H2 that is dropped is unsearchable; the preamble row carries it at ord 0.
  it('emits a preamble row with anchor "", title "", ord 0 for text before the first H2', () => {
    const doc = parse('---\ntitle: T\n---\nPreamble prose.\n\n## First\n\nBody.\n');
    expect(doc.sections[0]).toMatchObject({ anchor: '', title: '', ord: 0 });
    expect(doc.sections[0]?.body.trim()).toBe('Preamble prose.');
    expect(doc.sections[1]).toMatchObject({ anchor: 'first', title: 'First', ord: 1 });
  });

  // A whitespace-only preamble that still produces a row shifts every ord by one and adds an empty row.
  it('emits no preamble row when the text before the first H2 is whitespace only, so the first H2 has ord 0', () => {
    expect(sectionShapes('---\ntitle: T\n---\n\n   \n\n## First\n\nBody.\n')).toEqual([
      { anchor: 'first', ord: 0, title: 'First' },
    ]);
  });

  // The explicit anchor must win over the slug, and the `{#x}` suffix must leave the title.
  it('uses an explicit {#x} anchor and strips it from the title', () => {
    expect(sectionShapes('## Acceptance criteria {#acceptance}\n\nBody.\n')).toEqual([
      { anchor: 'acceptance', ord: 0, title: 'Acceptance criteria' },
    ]);
  });

  // ATX closing hashes left in the title also leak into the slug.
  it('strips closing hashes from an H2 title', () => {
    expect(sectionShapes('## Closed heading ##\n\nBody.\n')).toEqual([
      { anchor: 'closed-heading', ord: 0, title: 'Closed heading' },
    ]);
  });

  // Stripping closing hashes before the explicit anchor leaves 'Title ##' as the title.
  it('strips the explicit anchor before the closing hashes', () => {
    expect(sectionShapes('## Title ## {#x}\n\nBody.\n')).toEqual([
      { anchor: 'x', ord: 0, title: 'Title' },
    ]);
  });

  // An ASCII-only slug ([a-z0-9]) erases Korean letters and yields '' or '-ac'; the slug must keep \p{L}.
  it('slugs a Korean heading the way GitHub does', () => {
    expect(sectionShapes('## 수용 기준 (AC)\n\nBody.\n')).toEqual([
      { anchor: '수용-기준-ac', ord: 0, title: '수용 기준 (AC)' },
    ]);
  });

  // Two sections with the same anchor collide on the row identifier; the second must get `-1`.
  it('suffixes a duplicate anchor with -1 in order of appearance', () => {
    expect(
      sectionShapes(
        '## Notes {#footnotes}\n\nA.\n\n## Other\n\nB.\n\n## Notes {#footnotes}\n\nC.\n',
      ),
    ).toEqual([
      { anchor: 'footnotes', ord: 0, title: 'Notes' },
      { anchor: 'other', ord: 1, title: 'Other' },
      { anchor: 'footnotes-1', ord: 2, title: 'Notes' },
    ]);
  });

  // The preamble holds anchor "" even when it has no row, so an H2 whose slug is empty would
  // collide with it on the row identifier and the document would be refused.
  it('gives an H2 whose slug is empty the anchor -1', () => {
    expect(sectionShapes('Preamble.\n\n## ???\n\nBody.\n')).toEqual([
      { anchor: '', ord: 0, title: '' },
      { anchor: '-1', ord: 1, title: '???' },
    ]);
  });

  // A `## ` line inside a backtick fence read as a heading splits a code sample into a section.
  it('keeps a `## ` line inside a ``` fence in the body instead of opening a section', () => {
    const doc = parse('## Real\n\n```md\n## Not a heading\n```\n\nAfter the fence.\n');
    expect(doc.sections.map((s) => s.anchor)).toEqual(['real']);
    expect(doc.sections[0]?.body).toContain('## Not a heading');
    expect(doc.sections[0]?.body).toContain('After the fence.');
  });

  // A fence detector that only knows backticks opens a section inside a tilde fence.
  it('keeps a `## ` line inside a ~~~ fence in the body', () => {
    const doc = parse('## Real\n\n~~~\n## Not a heading\n~~~\n\nAfter the fence.\n');
    expect(doc.sections.map((s) => s.anchor)).toEqual(['real']);
    expect(doc.sections[0]?.body).toContain('## Not a heading');
  });

  // A heading detector matching `#{2,}` promotes H3 to its own row.
  it('keeps an H3 heading inside the enclosing H2 body', () => {
    const doc = parse('## Parent\n\nIntro.\n\n### Child\n\nChild body.\n');
    expect(doc.sections.map((s) => s.anchor)).toEqual(['parent']);
    expect(doc.sections[0]?.body).toContain('### Child');
    expect(doc.sections[0]?.body).toContain('Child body.');
  });

  // The heading indent boundary is three spaces: four spaces is an indented code line.
  it('accepts up to three leading spaces before ## and treats four as body text', () => {
    const doc = parse('   ## Indented\n\nA.\n\n    ## Code line\n\nB.\n');
    expect(doc.sections.map((s) => s.anchor)).toEqual(['indented']);
    expect(doc.sections[0]?.body).toContain('## Code line');
  });

  // A CRLF file read with \n-only patterns yields no frontmatter and no H2: one preamble row
  // holding the YAML, titled by the identifier.
  it('reads a CRLF document with a byte-order mark like its LF form', () => {
    const crlf = parse('\uFEFF---\r\ntitle: T\r\n---\r\n# H\r\n\r\n## A\r\n\r\nx\r\n');
    const lf = parse('---\ntitle: T\n---\n# H\n\n## A\n\nx\n');
    expect(crlf).toEqual(lf);
  });

  // An info string with a backtick is not a fence opener, so the H2 after it must still split.
  it('does not open a fence on a backtick line whose info string holds a backtick', () => {
    expect(sectionShapes('```js``` inline\n\n## A\n\nx\n').map((s) => s.anchor)).toEqual(['', 'a']);
  });

  // A bare ## line is an empty ATX H2; it must become its own row, anchored -1.
  it('reads a bare ## line as an H2 with an empty title', () => {
    expect(sectionShapes('Pre.\n##\nbody\n')).toEqual([
      { anchor: '', ord: 0, title: '' },
      { anchor: '-1', ord: 1, title: '' },
    ]);
  });

  // An empty H1 would make every section's doc_title empty; a closing # would be indexed as text.
  it('skips an empty H1 for the title and strips closing hashes from an H1', () => {
    expect(parse('# \n\n## A\nx\n').title).toBe(DOC_ID);
    expect(parse('# Title #\n\n## A\n').title).toBe('Title');
  });
});
