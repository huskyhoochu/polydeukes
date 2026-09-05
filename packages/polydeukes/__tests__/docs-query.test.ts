import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildDocs, runDocs } from '../src/docs-library.ts';
import { extractSection, queryDocs, TOPICS } from '../src/docs-query.ts';

const realDocs = resolve(import.meta.dirname, '../../../docs');
const md = (...rows: string[]) => `${rows.join('\n')}\n`;

describe('legacy heading extractor', () => {
  it.each(['```', '~~~', '```sh', '  ```yaml'])('ignores fenced headings after %s', (opener) => {
    const marker = opener.trim()[0].repeat(3);
    const closer = opener.startsWith('  ') ? `  ${marker}` : marker;
    const doc = md('## Alpha', opener, '# quoted boundary', closer, 'tail', '## Beta', 'beta');
    const part = extractSection(doc, '## Alpha');
    expect(part).toMatch(/^## Alpha\n/);
    expect(part).toContain('# quoted boundary');
    expect(part).toContain('tail');
    expect(part).not.toContain('## Beta');
  });

  it('never anchors on a target heading inside a fence', () => {
    const quoted = md('```md', '## Reference', 'quoted', '```');
    expect(() => extractSection(quoted, '## Reference')).toThrow();
    const part = extractSection(`${quoted}## Reference\nreal body\n`, '## Reference');
    expect(part).toContain('real body');
    expect(part).not.toContain('quoted');
  });

  it('recognizes headings after an indented fence closes', () => {
    expect(
      extractSection(md('  ```yaml', '  # example', '  ```', '## Beta', 'body'), '## Beta'),
    ).toContain('body');
  });

  it.each([
    '### Sibling',
    '## Parent',
  ])('ends before a same or higher level heading: %s', (next) => {
    const part = extractSection(md('### One', 'one', next, 'outside'), '### One');
    expect(part).toBe('### One\none');
    expect(part).not.toContain('outside');
  });

  it('includes child headings and preserves a final section verbatim', () => {
    const doc = md('## Parent', '  two spaces  ', '### Child', 'body');
    expect(extractSection(doc, '## Parent')).toBe(doc);
    expect(extractSection(`${doc}## Next\nother`, '## Parent')).toBe(doc.trimEnd());
  });

  it.each([
    '## reference',
    '## Reference:',
  ])('does not normalize a different heading: %s', (heading) => {
    expect(() => extractSection(md(heading, 'body'), '## Reference')).toThrow();
  });
});

describe('legacy topic interface over the current real catalog', () => {
  let root: string;
  let docsRoot: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'pdks-topics-'));
    docsRoot = join(root, 'bundle');
    buildDocs({ sourceRoot: realDocs, outputRoot: docsRoot });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('keeps exactly five discoverable topic names', () => {
    expect([...TOPICS].sort()).toEqual(['config', 'covenant', 'discipline', 'install', 'witness']);
    for (const topic of TOPICS) expect(queryDocs({ docsRoot }).text).toContain(topic);
  });

  it.each([
    ['install', 'connect-surfaces'],
    ['config', 'configure-project'],
    ['discipline', 'write-disciplines'],
    ['covenant', 'connect-surfaces'],
    ['witness', 'troubleshooting'],
  ])('%s returns content and a runnable %s follow-up command', (topic, seeAlso) => {
    const { text } = queryDocs({ docsRoot, topic });
    const suffix = `See also: pdks docs show ${seeAlso} --lang en\n`;
    expect(text.endsWith(suffix)).toBe(true);
    expect(text.slice(0, -suffix.length).trim().length).toBeGreaterThan(0);
  });

  it.each([
    ['install', 'tutorials/first-judgment.md'],
    ['config', 'reference/configuration/index.md'],
  ])('%s returns the complete canonical %s verbatim', (topic, path) => {
    expect(
      queryDocs({ docsRoot, topic }).text.startsWith(readFileSync(join(realDocs, path), 'utf8')),
    ).toBe(true);
  });

  it.each([
    ['discipline', 'configuration', 'disciplines'],
    ['covenant', 'concepts', 'enforcement-and-witness'],
  ])('%s uses the stable %s#%s section', (topic, documentId, sectionId) => {
    const raw = runDocs({
      docsRoot,
      args: ['show', documentId, '--section', sectionId],
      version: 'test',
    }).text;
    expect(queryDocs({ docsRoot, topic }).text.startsWith(raw)).toBe(true);
    expect(raw).toMatch(new RegExp(`^<a id="${sectionId}">`));
  });

  it('joins witness configuration and practical recovery in that order', () => {
    const text = queryDocs({ docsRoot, topic: 'witness' }).text;
    expect(text.indexOf('<a id="witness">')).toBe(0);
    expect(text.indexOf('<a id="opening-a-blocked-call">')).toBeGreaterThan(0);
    expect(text).not.toContain('<a id="disciplines">');
    expect(text).not.toContain('<a id="blocked-commit">');
  });

  it.each(['installation', ''])('throws on an unknown or empty topic: %j', (topic) => {
    expect(() => queryDocs({ docsRoot, topic })).toThrow();
  });

  it('rejects a changed bundle rather than silently returning partial text', () => {
    const path = join(docsRoot, 'reference/configuration/index.md');
    writeFileSync(path, readFileSync(path, 'utf8').replace('## `witness`', '## Renamed'));
    expect(() => queryDocs({ docsRoot, topic: 'witness' })).toThrow();
  });

  it('names the missing canonical file', () => {
    rmSync(join(docsRoot, 'reference/configuration/index.md'));
    expect(() => queryDocs({ docsRoot, topic: 'config' })).toThrow(
      /reference\/configuration\/index\.md/,
    );
  });
});
