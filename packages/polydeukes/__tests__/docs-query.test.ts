import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// DOCS-02 §3-b/§3-c/§3-d — the offline docs query core: the five-topic map over the
// bundled docs and the fence-aware section extractor under it. The bin's argv wiring and
// the dist/docs copy step are later phases of this cycle; nothing here spawns.
// DOCS-04 re-points the §3-c map at the split reference document
// (docs/reference/configuration.md, the six config-key sections promoted to `##`);
// the five topic names are invariant.
//
// Contract asserted (the implementer matches these named exports; both synchronous):
//   TOPICS: readonly string[] — the five topic names, the finite query domain (§3-c).
//   queryDocs(spec: { docsRoot: string; topic?: string }): { text: string }
//     - no topic: the listing text naming every topic (§3-b's no-argument form).
//     - with topic: the §3-c section body with the see-also line at the end.
//     - FAILURE SHAPE CHOSEN: throws (unknown topic / missing bundled doc / heading not
//       found) — one try/catch in the bin yields §3-b's stderr + exit 2 with stdout
//       still at zero bytes, the same translation the initClaudeCode bin path uses.
//   extractSection(markdown: string, heading: string): string
//     - `heading` is the full heading line (`## Reference`), matched by exact string
//       equality (§3-d — a renamed heading fails loud, never a neighbouring section).
//     - returns from the heading line up to just before the next heading of the same or
//       higher level; `#` lines inside code fences are content, never boundaries.
//     - throws when the heading is absent (outside fences) from the markdown.
import { extractSection, queryDocs, TOPICS } from '../src/docs-query.ts';

// ---------------------------------------------------------------------------
// Two fixture layers. extractSection runs on synthetic markdown built line by line —
// each payload is the minimal document separating its mutant, and the fenced `#` lines
// reuse installation.md's real fenced spellings. queryDocs runs on a bundle COPIED from
// this repository's docs/ into a throwaway docsRoot, because §3-c is a claim about
// those exact files: every heading literal and landmark pin below is measured from the
// shipped docs (and each landmark occurs in exactly one of the files its topic joins).
// ---------------------------------------------------------------------------

const repoRoot = resolve(import.meta.dirname, '../../..');
const realDocs = join(repoRoot, 'docs');

/** The §3-a bundle members queryDocs reads (guides) and the see-also targets (reference). */
const GUIDE_DOCS = ['installation.md', 'configuration.md', 'troubleshooting.md'];
const REFERENCE_DOCS = [
  // DOCS-04: the split configuration reference — a bundle member queryDocs reads directly.
  'configuration.md',
  'polydeukes.md',
  'core.md',
  'covenant.md',
  'adapter-claude-code.md',
  'adapter-git.md',
];

/**
 * §3-c heading literals, exactly as the shipped docs spell them. DOCS-04 promotes each
 * config key to a `##` section of docs/reference/configuration.md, with the
 * optional/required tag carried in the section's prose rather than the heading.
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
    // Mutation caught: a sixth topic added without a §3-c mapping row, or a rename
    // desyncing the list from the answers the map can produce — either way `pdks docs`
    // would advertise a query that exits 2, or hide one that works.
    expect([...TOPICS].sort()).toEqual(['config', 'covenant', 'discipline', 'install', 'witness']);
  });
});

describe('DOCS-02 §3-d extractSection — fenced # lines are content, never boundaries', () => {
  it('reads past a # line inside a backtick fence', () => {
    // Mutation caught: a line scanner with no fence state. It cuts the section at the
    // fenced `# Judged at commit time:` line and still LOOKS successful — the exact
    // silent-truncation shape §3-d names as this ticket's quietest failure.
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
    // Mutation caught: fence tracking implemented for backticks only — a future doc
    // edit using the other CommonMark fence marker would reopen the truncation hole.
    const doc = md('## Alpha', '~~~', '# lefthook.yml', '~~~', 'after', '## Beta');

    const section = extractSection(doc, '## Alpha');

    expect(section).toContain('# lefthook.yml');
    expect(section).toContain('after');
  });

  it('recognizes a fence opener carrying an info string', () => {
    // Mutation caught: the opener matched by whole-line equality with the bare marker.
    // ```sh then goes unrecognized, the scanner believes itself outside a fence, and
    // the fenced `# .husky/pre-commit` line becomes a boundary — `tail` is lost.
    const doc = md('## Alpha', '```sh', '# .husky/pre-commit', '```', 'tail', '## Beta');

    const section = extractSection(doc, '## Alpha');

    expect(section).toContain('tail');
    expect(section).not.toContain('## Beta');
  });

  it('never matches the target heading inside a fence', () => {
    // Mutation caught: fence state applied to the boundary scan but not to the START
    // search — a heading quoted inside a fence would then anchor a section that does
    // not exist, returning fence remainder as a confident answer.
    const doc = md('```md', '## Reference', '```', 'body outside any section');

    expect(() => extractSection(doc, '## Reference')).toThrow();
  });

  it('closes an indented fence that its own opener line opened', () => {
    // Mutation caught: an asymmetric fence matcher — the opener allowing leading
    // whitespace while the closer is compared strictly against the bare marker.
    // installation.md really carries a two-space-indented ```yaml closed by an equally
    // indented marker, so that mutant leaves the fence open to end of file and every
    // heading after it silently stops being a heading.
    const doc = md('## Alpha', '  ```yaml', '  # not a heading', '  ```', '## Beta', 'beta-body');

    const section = extractSection(doc, '## Beta');

    expect(section).toContain('beta-body');
    expect(section).not.toContain('## Alpha');
  });

  it('skips a heading quoted inside a fence and anchors on the real one after it', () => {
    // Mutation caught: the start search taking the first TEXTUAL match. The quoted copy
    // comes first, so that mutant anchors inside the fence and returns fence remainder
    // as the answer — the opposite end of the axis the throw-on-fenced-only test covers.
    const doc = md('```md', '## Reference', 'quoted body', '```', '## Reference', 'real body');

    const section = extractSection(doc, '## Reference');

    expect(section).toContain('real body');
    expect(section).not.toContain('quoted body');
  });
});

describe('DOCS-02 §3-d extractSection — the boundary is heading LEVEL', () => {
  it('starts at the heading line and stops before the next same-level heading', () => {
    // Mutation caught: the section returned without its own heading line, or the
    // boundary scan running past a same-level sibling into its body.
    const doc = md('### One', 'body-one', '### Two', 'body-two');

    const section = extractSection(doc, '### One');

    expect(section).toMatch(/^### One\n/);
    expect(section).toContain('body-one');
    expect(section).not.toContain('### Two');
    expect(section).not.toContain('body-two');
  });

  it('stops before a HIGHER-level heading', () => {
    // Mutation caught: a terminator scan looking only for the same level. A `###`
    // child section that closes at its parent's next `##` sibling is the shape the
    // bundled docs carry — this mutant swallows everything to end of file while every
    // same-level fixture stays green.
    const doc = md('### One', 'body-one', '## Up', 'up-body');

    const section = extractSection(doc, '### One');

    expect(section).toContain('body-one');
    expect(section).not.toContain('## Up');
    expect(section).not.toContain('up-body');
  });

  it('runs past lower-level child headings to the next same-level one', () => {
    // Mutation caught: stopping at the next heading of ANY level. The split reference
    // document's key sections carry lower-level children (`adapters.git` under
    // `adapters`) — this mutant returns only the intro and drops the rest of the
    // section while still exiting 0.
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
    // Mutation caught, one row per matcher: startsWith / toLowerCase / punctuation
    // trimming. §3-d's contract is that a renamed heading kills the query rather than
    // letting a normalizing matcher return a nearby section with full confidence.
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
    // Mutation caught: the listing hardcoded apart from TOPICS and desynced. An AI
    // discovers what it can ask ONLY through this text (§3-b), so a topic missing here
    // is a topic never queried. Word-boundary match: `install` must appear as itself,
    // not merely inside `installation`.
    const { text } = queryDocs({ docsRoot });

    for (const topic of TOPICS) {
      expect(text, topic).toMatch(new RegExp(`\\b${topic}\\b`));
    }
  });

  it.each([...TOPICS])('%s resolves to a section rather than an empty answer', (topic) => {
    // A universal over the code path instead of a hardcoded five (claims-and-criteria):
    // every member of the finite domain must actually resolve. Mutation caught: a topic
    // carried in TOPICS and advertised by the listing but absent from the §3-c map — it
    // would advertise a query that throws, and the per-topic tests below only reach the
    // five names spelled out in them today. The see-also line is stripped before the
    // length check: it is appended to every answer, so with it in place a heading whose
    // section body has gone empty would still pass as "resolved".
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
    // §3-c's see-also column, pinned as the finite enumeration it is. The pin is the
    // answer's TAIL, not a containment: a body cross-reference happening to name the
    // same reference file would satisfy toContain, while only the appended see-also
    // line — resolved against the bundle — can close the text. Dropping the line or
    // pointing it at the wrong reference file both break here.
    const { text } = queryDocs({ docsRoot, topic });

    expect(text.endsWith(`See also: ${join(docsRoot, seeAlso)}\n`)).toBe(true);
  });

  it('answers install with the whole installation.md, verbatim', () => {
    // The install row's FILE pin. The config test below covers the heading-less
    // whole-file branch, but nothing else names which document install reads —
    // review measured that repointing the row at troubleshooting.md left the rest
    // of the suite green. Prefix equality over the real file is the kill.
    const installationText = readFileSync(join(realDocs, 'installation.md'), 'utf-8');
    const { text } = queryDocs({ docsRoot, topic: 'install' });

    expect(text.startsWith(installationText)).toBe(true);
  });

  it('answers config with the whole reference/configuration.md, verbatim', () => {
    // DOCS-04 §3-b: config is a whole-file reference carrying no heading. Prefix
    // equality over the real split document is the kill: a map row still reading the
    // guide file returns text starting with the guide's own title, a row keeping a
    // `## Reference` heading throws, and any truncation breaks the prefix. The
    // exclusions pin the file boundary — the guide's sections stay in the guide.
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
    // DOCS-04 §3-b: the key is a `##` section of reference/configuration.md, spelled
    // without the optional tag — a map row keeping `### `disciplines` (optional)` finds
    // no such line and throws (§3-d exact equality). `disciplines` is the last key
    // section, so this exercises the end-of-file form on real data. The token-sentence
    // exclusion kills a start latched one section early, inside `## `witness``.
    const { text } = queryDocs({ docsRoot, topic: 'discipline' });

    expect(text.startsWith(DISCIPLINES_HEADING)).toBe(true);
    expect(text).toContain('Each entry is one discipline');
    expect(text).toContain('Adding a discipline is a data edit');
    expect(text).not.toContain('The token must stand alone');
  });

  it('answers covenant with the enforcement section, running to end of file', () => {
    // §3-d end-of-file form on real data: `## What enforcement looks like` closes
    // configuration.md, so an extractor requiring a terminating heading dies here.
    // The fails-closed pin is the section's own last sentence — any truncation loses
    // it — and the IDE-support exclusion kills a started-too-early answer: that is
    // the guide section immediately before it.
    const { text } = queryDocs({ docsRoot, topic: 'covenant' });

    expect(text.startsWith(ENFORCEMENT_HEADING)).toBe(true);
    expect(text).toContain('the system fails closed');
    expect(text).not.toContain('## IDE support');
  });

  it('answers witness with the reference section followed by the troubleshooting section', () => {
    // §3-c's one two-section topic; DOCS-04 moves the first half to the split
    // reference's `## `witness`` section. Each half's landmark is unique to its own
    // file across the two joined here, so returning only one half — or swapping the
    // join order — breaks. Boundary pins: the reference half stops before
    // `## `disciplines``, the troubleshooting half before `## A blocked commit`.
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
      // Mutation caught: a prefix or fuzzy topic matcher. `installation` is the
      // nearest plausible misspelling of a real topic — accepting it silently widens
      // the finite §3-c domain, and the thrown name is what the bin's usage line on
      // stderr is built from.
      expect(() => queryDocs({ docsRoot, topic: 'installation' })).toThrow(/installation/);
    });

    it('throws on an empty topic rather than falling back to the listing', () => {
      // Mutation caught: `if (spec.topic)` where `spec.topic !== undefined` is meant. An
      // empty string is falsy, so that branch answers `pdks docs ""` with the topic
      // listing and exit 0 — but §3-b counts that call as one argument, and an unknown
      // one, which is the exit-2 direction.
      expect(() => queryDocs({ docsRoot, topic: '' })).toThrow();
    });

    it('throws naming the heading when the doc renamed it', () => {
      // §3-d's fail-loud contract at the queryDocs LEVEL, not just extractSection's:
      // review measured that a readSection swallowing the extractor's throw into empty
      // text keeps the extractSection unit fixtures green while `pdks docs` hands back
      // a blank body at exit 0. The rename target is this test's own bundle copy.
      const path = join(docsRoot, 'reference', 'configuration.md');
      const renamed = readFileSync(path, 'utf-8').replace(
        `\n${WITNESS_HEADING}\n`,
        '\n## `witness` (optional)\n',
      );
      writeFileSync(path, renamed);

      expect(() => queryDocs({ docsRoot, topic: 'witness' })).toThrow(/witness/);
    });

    it('throws naming the file when a bundled doc is missing', () => {
      // Mutation caught: a read failure swallowed into an empty answer. A silently
      // incomplete bundle (§3-a's named consumer-side symptom) must surface as the
      // missing path named, not as empty text an AI would read as the document.
      // DOCS-04: config reads the split reference document, so that is the file
      // whose absence must be named.
      rmSync(join(docsRoot, 'reference', 'configuration.md'));

      expect(() => queryDocs({ docsRoot, topic: 'config' })).toThrow(
        /reference\/configuration\.md/,
      );
    });
  });
});
