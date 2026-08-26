import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// The offline docs query core: the topic map over the bundled docs and the fence-aware
// section extractor under it. Nothing here spawns.
import { extractSection, queryDocs, TOPICS } from '../src/docs-query.ts';

// Two fixture layers. extractSection runs on synthetic markdown built line by line — each
// payload is the minimal document separating its mutant, and the fenced `#` lines reuse
// installation.md's real fenced spellings. queryDocs runs on a bundle COPIED from this
// repository's docs/ into a throwaway docsRoot, because the topic map is a claim about
// those exact files: every heading literal and landmark pin below is measured from the
// shipped docs, and each landmark occurs in exactly one of the files its topic joins.

const repoRoot = resolve(import.meta.dirname, '../../..');
const realDocs = join(repoRoot, 'docs');

/** The bundle members queryDocs reads (guides) and the see-also targets (reference). */
const GUIDE_DOCS = ['installation.md', 'configuration.md', 'troubleshooting.md'];
const REFERENCE_DOCS = [
  // The split configuration reference — a bundle member queryDocs reads directly.
  'configuration.md',
  'polydeukes.md',
  'core.md',
  'covenant.md',
  'adapter-claude-code.md',
  'adapter-git.md',
];

/**
 * Heading literals, exactly as the shipped docs spell them. Each config key is a `##`
 * section of docs/reference/configuration.md, with the optional/required tag carried in
 * the section's prose rather than the heading.
 */
const DISCIPLINES_HEADING = '## `disciplines`';
const WITNESS_HEADING = '## `witness`';
const ENFORCEMENT_HEADING = '## What enforcement looks like';
const BLOCKED_CALL_HEADING = '## Opening a blocked call — the witness';

/** One markdown document from lines — keeps fence markers readable in fixtures. */
function md(...rows: string[]): string {
  return `${rows.join('\n')}\n`;
}

describe('DOCS-02 §3-c TOPICS — the finite query domain', () => {
  it('pins the topic list to exactly the five shipped names', () => {
    // A topic added without a mapping row, or a rename desyncing the list from the
    // answers the map can produce, makes `pdks docs` advertise a query that exits 2 or
    // hide one that works.
    expect([...TOPICS].sort()).toEqual(['config', 'covenant', 'discipline', 'install', 'witness']);
  });
});

describe('DOCS-02 §3-d extractSection — fenced # lines are content, never boundaries', () => {
  it('reads past a # line inside a backtick fence', () => {
    // A line scanner with no fence state cuts the section at the fenced
    // `# Judged at commit time:` line and still LOOKS successful — silent truncation is
    // the quietest failure this extractor has.
    const doc = md(
      '## Alpha',
      'before',
      '```',
      '# Judged at commit time:',
      '```',
      'after',
      '## Beta',
    );

    const section = extractSection(doc, '## Alpha');

    expect(section).toContain('# Judged at commit time:');
    expect(section).toContain('after');
    expect(section).not.toContain('## Beta');
  });

  it('reads past a # line inside a tilde fence', () => {
    // Fence tracking implemented for backticks only would reopen the truncation hole the
    // moment a doc edit uses the other CommonMark fence marker.
    const doc = md('## Alpha', '~~~', '# lefthook.yml', '~~~', 'after', '## Beta');

    const section = extractSection(doc, '## Alpha');

    expect(section).toContain('# lefthook.yml');
    expect(section).toContain('after');
  });

  it('recognizes a fence opener carrying an info string', () => {
    // An opener matched by whole-line equality with the bare marker leaves ```sh
    // unrecognized: the scanner believes itself outside a fence, the fenced
    // `# .husky/pre-commit` line becomes a boundary, and `tail` is lost.
    const doc = md('## Alpha', '```sh', '# .husky/pre-commit', '```', 'tail', '## Beta');

    const section = extractSection(doc, '## Alpha');

    expect(section).toContain('tail');
    expect(section).not.toContain('## Beta');
  });

  it('never matches the target heading inside a fence', () => {
    // Fence state applied to the boundary scan but not to the START search lets a heading
    // quoted inside a fence anchor a section that does not exist, returning fence
    // remainder as a confident answer.
    const doc = md('```md', '## Reference', '```', 'body outside any section');

    expect(() => extractSection(doc, '## Reference')).toThrow();
  });

  it('closes an indented fence that its own opener line opened', () => {
    // An asymmetric fence matcher — opener allowing leading whitespace, closer compared
    // strictly against the bare marker — leaves the fence open to end of file, and every
    // heading after it silently stops being a heading. installation.md really carries a
    // two-space-indented ```yaml closed by an equally indented marker.
    const doc = md('## Alpha', '  ```yaml', '  # not a heading', '  ```', '## Beta', 'beta-body');

    const section = extractSection(doc, '## Beta');

    expect(section).toContain('beta-body');
    expect(section).not.toContain('## Alpha');
  });

  it('skips a heading quoted inside a fence and anchors on the real one after it', () => {
    // A start search taking the first TEXTUAL match anchors inside the fence, since the
    // quoted copy comes first, and returns fence remainder as the answer — the opposite
    // end of the axis the throw-on-fenced-only test covers.
    const doc = md('```md', '## Reference', 'quoted body', '```', '## Reference', 'real body');

    const section = extractSection(doc, '## Reference');

    expect(section).toContain('real body');
    expect(section).not.toContain('quoted body');
  });
});

describe('DOCS-02 §3-d extractSection — the boundary is heading LEVEL', () => {
  it('starts at the heading line and stops before the next same-level heading', () => {
    // The section must carry its own heading line, and the boundary scan must stop at a
    // same-level sibling rather than running into its body.
    const doc = md('### One', 'body-one', '### Two', 'body-two');

    const section = extractSection(doc, '### One');

    expect(section).toMatch(/^### One\n/);
    expect(section).toContain('body-one');
    expect(section).not.toContain('### Two');
    expect(section).not.toContain('body-two');
  });

  it('stops before a HIGHER-level heading', () => {
    // A terminator scan looking only for the same level swallows everything to end of
    // file for a `###` child that closes at its parent's next `##` sibling — the shape the
    // bundled docs carry — while every same-level fixture stays green.
    const doc = md('### One', 'body-one', '## Up', 'up-body');

    const section = extractSection(doc, '### One');

    expect(section).toContain('body-one');
    expect(section).not.toContain('## Up');
    expect(section).not.toContain('up-body');
  });

  it('runs past lower-level child headings to the next same-level one', () => {
    // Stopping at the next heading of ANY level returns only the intro and drops the rest
    // of the section while still exiting 0. The split reference document's key sections
    // carry lower-level children (`adapters.git` under `adapters`).
    const doc = md(
      '## Parent',
      'intro',
      '### Child A',
      'a-body',
      '### Child B',
      'b-body',
      '## Next',
    );

    const section = extractSection(doc, '## Parent');

    expect(section).toContain('### Child A');
    expect(section).toContain('### Child B');
    expect(section).toContain('b-body');
    expect(section).not.toContain('## Next');
  });
});

describe('DOCS-02 §3-d extractSection — exact-string match, failing loud', () => {
  it.each([
    ['a case-folded spelling', '## reference'],
    ['a trailing-punctuation variant', '## Reference:'],
  ])('refuses to match %s (%s)', (_kind, actualHeading) => {
    // One row per normalizing matcher: startsWith, toLowerCase, punctuation trimming. A
    // renamed heading must kill the query rather than let any of them return a nearby
    // section with full confidence.
    const doc = md(actualHeading, 'body');

    expect(() => extractSection(doc, '## Reference')).toThrow();
  });
});

describe('DOCS-02 §3-b/§3-c queryDocs — over a bundle copied from the real docs', () => {
  let docsRoot: string;

  beforeEach(() => {
    docsRoot = mkdtempSync(join(tmpdir(), 'pdks-docs-'));
    for (const name of GUIDE_DOCS) {
      copyFileSync(join(realDocs, name), join(docsRoot, name));
    }
    mkdirSync(join(docsRoot, 'reference'));
    for (const name of REFERENCE_DOCS) {
      copyFileSync(join(realDocs, 'reference', name), join(docsRoot, 'reference', name));
    }
  });

  afterEach(() => {
    rmSync(docsRoot, { recursive: true, force: true });
  });

  it('names every topic in the no-argument listing', () => {
    // An AI discovers what it can ask ONLY through this text, so a listing hardcoded
    // apart from TOPICS desyncs and a topic missing here is a topic never queried.
    // Word-boundary match: `install` must appear as itself, not inside `installation`.
    const { text } = queryDocs({ docsRoot });

    for (const topic of TOPICS) {
      expect(text, topic).toMatch(new RegExp(`\\b${topic}\\b`));
    }
  });

  it.each([...TOPICS])('%s resolves to a section rather than an empty answer', (topic) => {
    // A universal over the code path rather than a hardcoded count: every member of the
    // finite domain must actually resolve. A topic carried in TOPICS and advertised by
    // the listing but absent from the map would advertise a query that throws, and the
    // per-topic tests below only reach the names spelled out in them. The see-also line is
    // stripped before the length check: it is appended to every answer, so with it in
    // place a heading whose section body has gone empty would still pass as "resolved".
    const { text } = queryDocs({ docsRoot, topic });

    const body = text.slice(0, text.lastIndexOf('\nSee also: '));
    expect(body.trim().length).toBeGreaterThan(0);
  });

  it.each([
    ['install', 'reference/polydeukes.md'],
    ['config', 'reference/core.md'],
    ['discipline', 'reference/covenant.md'],
    ['covenant', 'reference/polydeukes.md'],
    ['witness', 'reference/covenant.md'],
  ] as const)('appends the %s see-also line naming %s', (topic, seeAlso) => {
    // The see-also column, pinned as the finite enumeration it is. The pin is the
    // answer's TAIL, not a containment: a body cross-reference naming the same reference
    // file would satisfy toContain, while only the appended see-also line — resolved
    // against the bundle — can close the text.
    const { text } = queryDocs({ docsRoot, topic });

    expect(text.endsWith(`See also: ${join(docsRoot, seeAlso)}\n`)).toBe(true);
  });

  it('answers install with the whole installation.md, verbatim', () => {
    // The install row's FILE pin. The config test below covers the heading-less
    // whole-file branch, but nothing else names which document install reads: repointing
    // the row at troubleshooting.md was measured leaving the rest of the suite green.
    // Prefix equality over the real file is what catches it.
    const installationText = readFileSync(join(realDocs, 'installation.md'), 'utf-8');
    const { text } = queryDocs({ docsRoot, topic: 'install' });

    expect(text.startsWith(installationText)).toBe(true);
  });

  it('answers config with the whole reference/configuration.md, verbatim', () => {
    // config is a whole-file reference carrying no heading. Prefix equality over the real
    // split document catches every direction: a map row still reading the guide file
    // returns text starting with the guide's own title, a row keeping a `## Reference`
    // heading throws, and any truncation breaks the prefix. The exclusions pin the file
    // boundary — the guide's sections stay in the guide.
    const referenceConfigText = readFileSync(
      join(realDocs, 'reference', 'configuration.md'),
      'utf-8',
    );
    const { text } = queryDocs({ docsRoot, topic: 'config' });

    expect(text.startsWith(referenceConfigText)).toBe(true);
    expect(text).toContain(DISCIPLINES_HEADING);
    expect(text).not.toContain(ENFORCEMENT_HEADING);
    expect(text).not.toContain('## IDE support');
  });

  it('answers discipline with the ## `disciplines` section of the split reference', () => {
    // The key is a `##` section of reference/configuration.md, spelled without the
    // optional tag — under exact heading equality a map row keeping
    // `### `disciplines` (optional)` finds no such line and throws. `disciplines` is the
    // last key section, so this exercises the end-of-file form on real data. The
    // token-sentence exclusion catches a start latched one section early, inside
    // `## `witness``.
    const { text } = queryDocs({ docsRoot, topic: 'discipline' });

    expect(text.startsWith(DISCIPLINES_HEADING)).toBe(true);
    expect(text).toContain('Each entry is one discipline');
    expect(text).toContain('Adding a discipline is a data edit');
    expect(text).not.toContain('The token must stand alone');
  });

  it('answers covenant with the enforcement section, running to end of file', () => {
    // The end-of-file form on real data: `## What enforcement looks like` closes
    // configuration.md, so an extractor requiring a terminating heading dies here. The
    // pin is the section's own last sentence — any truncation loses it — and the
    // IDE-support exclusion catches a started-too-early answer, that being the guide
    // section immediately before it.
    const { text } = queryDocs({ docsRoot, topic: 'covenant' });

    expect(text.startsWith(ENFORCEMENT_HEADING)).toBe(true);
    expect(text).toContain('the system fails closed');
    expect(text).not.toContain('## IDE support');
  });

  it('answers witness with the reference section followed by the troubleshooting section', () => {
    // The one two-section topic, joining the split reference's `## `witness`` section to
    // a troubleshooting section. Each half's landmark is unique to its own file across the
    // two joined here, so returning only one half — or swapping the join order — breaks.
    // Boundary pins: the reference half stops before `## `disciplines``, the
    // troubleshooting half before `## A blocked commit`.
    const { text } = queryDocs({ docsRoot, topic: 'witness' });

    expect(text).toContain(WITNESS_HEADING);
    expect(text).toContain('The token must stand alone');
    expect(text).toContain(BLOCKED_CALL_HEADING);
    expect(text).toContain('only human-authored messages count');
    expect(text.indexOf('The token must stand alone')).toBeLessThan(
      text.indexOf('only human-authored messages count'),
    );
    expect(text).not.toContain('Each entry is one discipline');
    expect(text).not.toContain('## A blocked commit');
  });

  describe('failure directions throw — never partial text', () => {
    it('throws naming the topic on an unknown topic, with no fuzzy recovery', () => {
      // `installation` is the nearest plausible misspelling of a real topic, so a prefix
      // or fuzzy matcher accepting it silently widens the finite domain. The thrown name
      // is what the bin's stderr line is built from.
      expect(() => queryDocs({ docsRoot, topic: 'installation' })).toThrow(/installation/);
    });

    it('throws on an empty topic rather than falling back to the listing', () => {
      // `if (spec.topic)` where `spec.topic !== undefined` is meant answers `pdks docs ""`
      // with the topic listing at exit 0, because an empty string is falsy. That call
      // carries one argument, and an unknown one, so it belongs in the exit-2 direction.
      expect(() => queryDocs({ docsRoot, topic: '' })).toThrow();
    });

    it('throws naming the heading when the doc renamed it', () => {
      // The fail-loud contract at the queryDocs LEVEL, not just extractSection's: a
      // readSection swallowing the extractor's throw into empty text was measured keeping
      // the extractSection unit fixtures green while `pdks docs` handed back a blank body
      // at exit 0. The rename target is this test's own bundle copy.
      const path = join(docsRoot, 'reference', 'configuration.md');
      const renamed = readFileSync(path, 'utf-8').replace(
        `\n${WITNESS_HEADING}\n`,
        '\n## `witness` (optional)\n',
      );
      writeFileSync(path, renamed);

      expect(() => queryDocs({ docsRoot, topic: 'witness' })).toThrow(/witness/);
    });

    it('throws naming the file when a bundled doc is missing', () => {
      // A read failure swallowed into an empty answer leaves a silently incomplete bundle,
      // which must instead surface as the missing path named — not as empty text an AI
      // would read as the document. config reads the split reference document, so that is
      // the file whose absence must be named.
      rmSync(join(docsRoot, 'reference', 'configuration.md'));

      expect(() => queryDocs({ docsRoot, topic: 'config' })).toThrow(
        /reference\/configuration\.md/,
      );
    });
  });
});
