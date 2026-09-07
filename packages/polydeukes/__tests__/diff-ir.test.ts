import { chmodSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { CovenantInput } from '@polydeukes/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// The unified-diff translator: one pure function from `git diff` text (or any producer's
// unified diff) to the covenant input IR. One toolCall per file block in input order; the
// tool names are the two the commit surface has always dispatched under. `modify` carries
// hunk lines, never the whole file: `pre` is every `-` line, `post` every `+` line, context
// and the no-newline marker are dropped. Anything outside the accepted grammar throws.
import { covenantInputFromUnifiedDiff, STAGED_DELETE, STAGED_WRITE } from '../src/diff-ir.ts';
import { type CheckRepo, createCheckRepo } from './helpers.ts';

const EMPTY_IR: CovenantInput = { toolCalls: [], subagentSpawns: [], userMessages: [] };

/** The IR the translator answers with the given toolCalls and nothing else. */
function ir(toolCalls: CovenantInput['toolCalls']): CovenantInput {
  return { toolCalls, subagentSpawns: [], userMessages: [] };
}

function translate(text: string): CovenantInput {
  return covenantInputFromUnifiedDiff({ text });
}

describe('the six block shapes of the grammar', () => {
  it('creation: /dev/null → b/P is staged-write with create evidence carrying every + line', () => {
    // A translator that reads the path from the `---` side names `/dev/null`; one that
    // keeps the `+` prefix or the hunk header in `post` hands the judge a line no file has.
    const text = [
      'diff --git a/created.txt b/created.txt',
      'new file mode 100644',
      'index 0000000..814f4a4',
      '--- /dev/null',
      '+++ b/created.txt',
      '@@ -0,0 +1,2 @@',
      '+one',
      '+two',
      '',
    ].join('\n');

    expect(translate(text)).toEqual(
      ir([
        {
          name: STAGED_WRITE,
          args: { file_path: 'created.txt' },
          fileChange: { kind: 'create', path: 'created.txt', post: 'one\ntwo' },
        },
      ]),
    );
  });

  it('deletion: a/P → /dev/null is staged-delete with delete evidence carrying every - line as pre', () => {
    // The mirror of creation. A translator keyed on `+++` alone names `/dev/null` here;
    // one that emits `create` for every block with hunks judges a deletion as an addition.
    const text = [
      'diff --git a/old.txt b/old.txt',
      'deleted file mode 100644',
      'index 4cb29ea..0000000',
      '--- a/old.txt',
      '+++ /dev/null',
      '@@ -1,3 +0,0 @@',
      '-one',
      '-two',
      '-three',
      '',
    ].join('\n');

    expect(translate(text)).toEqual(
      ir([
        {
          name: STAGED_DELETE,
          args: { file_path: 'old.txt' },
          fileChange: { kind: 'delete', path: 'old.txt', pre: 'one\ntwo\nthree' },
        },
      ]),
    );
  });

  it('modification: pre is the - lines and post the + lines across every hunk; context and the no-newline marker are dropped', () => {
    // Two hunks, so a translator that keeps only the first hunk loses `late`. A context
    // line kept on either side puts `keep` into a set the discipline compares; a
    // no-newline marker kept lands a backslash line in `post`; a translator that refuses
    // the marker as an unknown hunk line throws on every file without a trailing newline.
    const text = [
      'diff --git a/f.txt b/f.txt',
      'index 1111111..2222222 100644',
      '--- a/f.txt',
      '+++ b/f.txt',
      '@@ -1,3 +1,3 @@',
      ' keep',
      '-old',
      '+new',
      ' tail',
      '@@ -20,2 +20,2 @@',
      ' more',
      '-early',
      '+late',
      '\\ No newline at end of file',
      '',
    ].join('\n');

    expect(translate(text)).toEqual(
      ir([
        {
          name: STAGED_WRITE,
          args: { file_path: 'f.txt' },
          fileChange: { kind: 'modify', path: 'f.txt', pre: 'old\nearly', post: 'new\nlate' },
        },
      ]),
    );
  });

  it('a removed line whose own text begins with -- stays a removed line, not a new file header', () => {
    // An SQL comment `-- note` removed shows up as `--- note` inside the hunk. A
    // translator that recognises `---` anywhere as a header start sees a pair with no
    // `+++` and throws on a legitimate diff; one that starts a new block silently drops
    // the line from `pre`.
    const text = [
      '--- a/q.sql',
      '+++ b/q.sql',
      '@@ -1,2 +1,1 @@',
      '-- note',
      ' select 1;',
      '',
    ].join('\n');

    expect(translate(text).toolCalls[0]?.fileChange).toEqual({
      kind: 'modify',
      path: 'q.sql',
      pre: '- note',
      post: '',
    });
  });

  it('an added line whose own text begins with ++ stays an added line, not a new file header', () => {
    // The mirror of the `-- note` case: a C++ increment `++ note` added shows up as
    // `+++ note` inside the hunk. A translator that recognises `+++` anywhere as a header
    // opens a block with no `---` and throws, or drops the line from `post`.
    const text = ['--- a/q.cc', '+++ b/q.cc', '@@ -1,1 +1,2 @@', ' int i;', '++ note', ''].join(
      '\n',
    );

    expect(translate(text).toolCalls[0]?.fileChange).toEqual({
      kind: 'modify',
      path: 'q.cc',
      pre: '',
      post: '+ note',
    });
  });

  it('a mode-only block (no ---/+++ and no hunk) is staged-write with modify evidence at pre = post = empty', () => {
    // The path comes from the `diff --git` header alone. A translator that requires the
    // `---`/`+++` pair throws on every chmod; one that emits no evidence keeps the path
    // out of `world.changes`.
    const text = ['diff --git a/mode.sh b/mode.sh', 'old mode 100644', 'new mode 100755', ''].join(
      '\n',
    );

    expect(translate(text)).toEqual(
      ir([
        {
          name: STAGED_WRITE,
          args: { file_path: 'mode.sh' },
          fileChange: { kind: 'modify', path: 'mode.sh', pre: '', post: '' },
        },
      ]),
    );
  });

  it('a pure rename is staged-delete of the old path (no pre) followed by staged-write of the new path at empty pre/post', () => {
    // Two calls, old first. One call under the new path alone lets a protected path leave
    // the tree unjudged; `delete` with a `pre` key invents a baseline the diff never
    // carried; `create` on the new side turns every moved file into a wholesale addition.
    const text = [
      'diff --git a/old.txt b/new.txt',
      'similarity index 100%',
      'rename from old.txt',
      'rename to new.txt',
      '',
    ].join('\n');

    const input = translate(text);

    expect(input).toEqual(
      ir([
        {
          name: STAGED_DELETE,
          args: { file_path: 'old.txt' },
          fileChange: { kind: 'delete', path: 'old.txt' },
        },
        {
          name: STAGED_WRITE,
          args: { file_path: 'new.txt' },
          fileChange: { kind: 'modify', path: 'new.txt', pre: '', post: '' },
        },
      ]),
    );
    expect('pre' in (input.toolCalls[0]?.fileChange ?? {})).toBe(false);
  });

  it('a rename with hunks puts the hunk lines on the new path and nothing on the old', () => {
    // The `---`/`+++` pair names two different paths; a translator that reads the
    // change's path from `---` files the hunk under the old name.
    const text = [
      'diff --git a/old.txt b/new.txt',
      'similarity index 71%',
      'rename from old.txt',
      'rename to new.txt',
      'index 4cb29ea..ddc897f 100644',
      '--- a/old.txt',
      '+++ b/new.txt',
      '@@ -1,3 +1,3 @@',
      ' one',
      '-two',
      '+TWO',
      ' three',
      '',
    ].join('\n');

    expect(translate(text).toolCalls).toEqual([
      {
        name: STAGED_DELETE,
        args: { file_path: 'old.txt' },
        fileChange: { kind: 'delete', path: 'old.txt' },
      },
      {
        name: STAGED_WRITE,
        args: { file_path: 'new.txt' },
        fileChange: { kind: 'modify', path: 'new.txt', pre: 'two', post: 'TWO' },
      },
    ]);
  });

  it('a binary modification ("Binary files … differ") is staged-write with no fileChange', () => {
    // The path still routes the protected-path judgment; evidence would be fabricated.
    const text = [
      'diff --git a/img.bin b/img.bin',
      'index d0463d4..d2ffac3 100644',
      'Binary files a/img.bin and b/img.bin differ',
      '',
    ].join('\n');

    const input = translate(text);

    expect(input).toEqual(ir([{ name: STAGED_WRITE, args: { file_path: 'img.bin' } }]));
    expect('fileChange' in (input.toolCalls[0] ?? {})).toBe(false);
  });

  it('a binary deletion ("deleted file mode" + Binary files … /dev/null differ) is staged-delete with no fileChange', () => {
    // A translator that reads binary blocks as writes unconditionally dispatches a
    // deletion under the write tool name.
    const text = [
      'diff --git a/img.bin b/img.bin',
      'deleted file mode 100644',
      'index d0463d4..0000000',
      'Binary files a/img.bin and /dev/null differ',
      '',
    ].join('\n');

    expect(translate(text)).toEqual(ir([{ name: STAGED_DELETE, args: { file_path: 'img.bin' } }]));
  });

  it('a "GIT binary patch" block is staged-write with no fileChange and its literal lines are never hunk lines', () => {
    // `git diff --binary` output. The base85 payload lines start with letters; a translator
    // that enters hunk mode on them throws, and one that keeps them as `post` supplies
    // base85 as source text.
    const text = [
      'diff --git a/img.bin b/img.bin',
      'index d0463d4..d2ffac3 100644',
      'GIT binary patch',
      'literal 7',
      'Oc$~|-Vq{@!0000L',
      '',
      'literal 7',
      'Oc$~|-Vq{@!0000K',
      '',
      '',
    ].join('\n');

    expect(translate(text)).toEqual(ir([{ name: STAGED_WRITE, args: { file_path: 'img.bin' } }]));
  });
});

describe('headers and paths', () => {
  it('a header-less ---/+++ block (plain diff -u) is accepted and its timestamps are cut at the tab', () => {
    // `diff -u` writes `--- a/f.txt<TAB>2026-…`. A translator keyed on `diff --git` sees
    // nothing; one that keeps the tab names a path no tree has.
    const text = [
      '--- a/f.txt\t2026-01-01 00:00:00.000000000 +0900',
      '+++ b/f.txt\t2026-01-02 00:00:00.000000000 +0900',
      '@@ -1 +1 @@',
      '-x',
      '+y',
      '',
    ].join('\n');

    expect(translate(text).toolCalls).toEqual([
      {
        name: STAGED_WRITE,
        args: { file_path: 'f.txt' },
        fileChange: { kind: 'modify', path: 'f.txt', pre: 'x', post: 'y' },
      },
    ]);
  });

  it('strips exactly one a/ or b/ prefix, so a repository directory literally named a/ survives', () => {
    // A translator stripping every leading `a/` turns `a/x.txt` into `x.txt`.
    const text = ['--- a/a/x.txt', '+++ b/a/x.txt', '@@ -1 +1 @@', '-x', '+y', ''].join('\n');

    expect(translate(text).toolCalls[0]?.args).toEqual({ file_path: 'a/x.txt' });
  });

  it('--no-prefix output passes through as-is', () => {
    // Nothing to strip; a translator that always drops the first path segment loses the
    // top-level directory of every file.
    const text = [
      'diff --git src/f.txt src/f.txt',
      'index 1111111..2222222 100644',
      '--- src/f.txt',
      '+++ src/f.txt',
      '@@ -1 +1 @@',
      '-x',
      '+y',
      '',
    ].join('\n');

    expect(translate(text).toolCalls[0]?.args).toEqual({ file_path: 'src/f.txt' });
  });

  it('a quoted path is C-unescaped: octal bytes decode as UTF-8 and \\t is a real tab, the trailing tab git appends after the quote is cut', () => {
    // git quotes a path with a space or a non-ASCII byte and writes each such byte as
    // `\ooo`; it also appends a tab after the closing quote. A translator that cuts at the
    // first tab before unquoting loses everything after `\t` inside the quotes; one that
    // does not decode octal names a path whose bytes are backslashes and digits.
    const spaced = [
      'diff --git "a/\\354\\225\\210\\353\\205\\225 tab.txt" "b/\\354\\225\\210\\353\\205\\225 tab.txt"',
      'index 587be6b..975fbec 100644',
      '--- "a/\\354\\225\\210\\353\\205\\225 tab.txt"\t',
      '+++ "b/\\354\\225\\210\\353\\205\\225 tab.txt"\t',
      '@@ -1 +1 @@',
      '-x',
      '+y',
      '',
    ].join('\n');
    const tabbed = ['--- "a/p\\tq"', '+++ "b/p\\tq"', '@@ -1 +1 @@', '-x', '+y', ''].join('\n');

    expect(translate(spaced).toolCalls[0]?.args).toEqual({
      file_path: '\uC548\uB155 tab.txt',
    });
    expect(translate(tabbed).toolCalls[0]?.args).toEqual({ file_path: 'p\tq' });
  });

  it('two blocks translate to two toolCalls in input order', () => {
    // A translator that stops after the first block leaves the second file unjudged.
    const text = [
      'diff --git a/gone.txt b/gone.txt',
      'deleted file mode 100644',
      '--- a/gone.txt',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-bye',
      'diff --git a/born.txt b/born.txt',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/born.txt',
      '@@ -0,0 +1 @@',
      '+hi',
      '',
    ].join('\n');

    expect(translate(text).toolCalls.map((call) => [call.name, call.args?.file_path])).toEqual([
      [STAGED_DELETE, 'gone.txt'],
      [STAGED_WRITE, 'born.txt'],
    ]);
  });
});

describe("the producer's configuration must not shrink the observation", () => {
  it('text with no recognizable block is rejected, not translated to an empty observation', () => {
    // A `color.ui=always` diff wraps every line in SGR escapes, so no header or hunk
    // prefix matches. Returning zero toolCalls would judge such a commit as "nothing
    // staged" — exit 0 with no rows — for a commit that may touch every protected path.
    const colored =
      '\u001b[1mdiff --git a/f.txt b/f.txt\u001b[m\n\u001b[1m--- a/f.txt\u001b[m\n\u001b[1m+++ b/f.txt\u001b[m\n\u001b[36m@@ -1 +1 @@\u001b[m\n\u001b[32m+x\u001b[m\n';
    expect(() => translate(colored)).toThrow(/no file block recognized/);
    expect(() => translate('fatal: not a git repository\n')).toThrow(/no file block recognized/);
  });

  it('blank input (whitespace only) is still the empty observation', () => {
    expect(translate('\n\n').toolCalls).toEqual([]);
  });

  it('a deleted EMPTY file — deleted file mode, no ---/+++, no hunk — is staged-delete with delete evidence', () => {
    // git prints no `---`/`+++` pair for an empty file, so the mode line is the only sign
    // of the deletion; a translator keyed on `+++ /dev/null` alone dispatches `git rm` of
    // an empty gate file under the WRITE name and the delete registration never routes.
    const text =
      'diff --git a/empty.txt b/empty.txt\ndeleted file mode 100644\nindex e69de29..0000000\n';
    expect(translate(text).toolCalls).toEqual([
      {
        name: STAGED_DELETE,
        args: { file_path: 'empty.txt' },
        fileChange: { kind: 'delete', path: 'empty.txt', pre: '' },
      },
    ]);
  });

  it('a created EMPTY file — new file mode, no ---/+++, no hunk — is staged-write with create evidence', () => {
    const text =
      'diff --git a/empty.txt b/empty.txt\nnew file mode 100644\nindex 0000000..e69de29\n';
    expect(translate(text).toolCalls).toEqual([
      {
        name: STAGED_WRITE,
        args: { file_path: 'empty.txt' },
        fileChange: { kind: 'create', path: 'empty.txt', post: '' },
      },
    ]);
  });

  it('a quoted rename path is unescaped on both sides', () => {
    // git quotes a non-ASCII path after `rename from` / `rename to` exactly as it does on
    // `---`/`+++`; a translator that slices the prefix off raw hands the judge a path made
    // of octal escapes and quote characters, which no protectedPaths entry can match.
    const text =
      'diff --git "a/\\354\\225\\210.txt" "b/\\353\\260\\224.txt"\nsimilarity index 100%\nrename from "\\354\\225\\210.txt"\nrename to "\\353\\260\\224.txt"\n';
    const [oldCall, newCall] = translate(text).toolCalls;
    expect(oldCall?.args).toEqual({ file_path: '\uC548.txt' });
    expect(newCall?.args).toEqual({ file_path: '\uBC14.txt' });
  });

  it('a hunk whose body outruns its declared counts throws instead of dropping lines', () => {
    // `@@ -1,0 +1,2 @@` leaves no room for a context line; consuming it from both counters
    // exhausts the new side one line early and the final `+bb` silently vanishes.
    const text = '--- a/f.txt\n+++ b/f.txt\n@@ -1,0 +1,2 @@\n+aa\n ctx\n+bb\n';
    expect(() => translate(text)).toThrow(/unknown hunk line/);
  });
});

describe('rejected shapes throw', () => {
  it('a combined (diff --cc) block throws', () => {
    // Merge-conflict diffs carry `@@@` hunks with two-column prefixes; a translator that
    // reads them as ordinary hunks treats `- main` as a removed line and `++merged` as an
    // added one and judges a merge nobody staged as a plain edit.
    const text = [
      'diff --cc old.txt',
      'index 1111111,2222222..3333333',
      '--- a/old.txt',
      '+++ b/old.txt',
      '@@@ -1,3 -1,3 +1,3 @@@',
      '- main',
      ' -side',
      '++merged',
      '  two',
      '',
    ].join('\n');

    expect(() => translate(text)).toThrow();
  });

  it('a --- line with no +++ partner throws', () => {
    // A block with only one side has no path to name; passing it as an empty observation
    // lets a truncated diff through unjudged.
    const text = ['--- a/f.txt', '@@ -1 +1 @@', '-x', '+y', ''].join('\n');

    expect(() => translate(text)).toThrow();
  });

  it('a +++ line with no --- partner throws', () => {
    // The mirror of the case above: a translator that starts a block on `+++` alone
    // names a path with no old side and judges the hunk as a creation.
    const text = ['+++ b/f.txt', '@@ -1 +1 @@', '-x', '+y', ''].join('\n');

    expect(() => translate(text)).toThrow();
  });

  it('a hunk line starting with none of space, +, -, backslash throws', () => {
    // Text that is not a diff, or a diff with a corrupted line, must not translate to a
    // partial observation.
    const text = ['--- a/f.txt', '+++ b/f.txt', '@@ -1 +1 @@', '-x', 'y', ''].join('\n');

    expect(() => translate(text)).toThrow();
  });
});

describe('the empty observation and the keys the IR never carries', () => {
  it('zero bytes translate to the empty IR, not a throw', () => {
    // `git diff --cached` prints nothing when nothing is staged; a throw here blocks every
    // empty commit attempt.
    expect(translate('')).toEqual(EMPTY_IR);
  });

  it('the IR carries no actor key — a diff proves no author', () => {
    // A translator that fills `actor: {}` claims the main session made the change, and
    // every actor-scoped declaration then judges a subject the diff never named.
    const text = ['--- /dev/null', '+++ b/f.txt', '@@ -0,0 +1 @@', '+x', ''].join('\n');

    const input = translate(text);

    expect('actor' in input).toBe(false);
    expect('actor' in translate('')).toBe(false);
  });

  it('the translator module never imports the judge', () => {
    // Judgment has one home. The source text is the oracle: an import of the covenant
    // package here would let the translator decide instead of describe.
    const source = readFileSync(resolve(import.meta.dirname, '../src/diff-ir.ts'), 'utf-8');

    expect(source).not.toContain('@polydeukes/covenant');
  });
});

describe('a real producer: git diff --cached from a throwaway repository', () => {
  let repo: CheckRepo;

  beforeEach(() => {
    repo = createCheckRepo('pdks-diff-ir-');
    repo.git('config', 'core.filemode', 'true');
  });

  afterEach(() => {
    repo.cleanup();
  });

  it('rename, binary edit, mode change, creation, and a quoted non-ASCII path translate as the grammar says', () => {
    // The hand-written fixtures above pin each shape; this one pins that git's actual
    // spelling of those shapes (header order, the tab after a quoted path, `similarity
    // index`) is what the translator reads.
    const { repoRoot, git, write } = repo;
    const quoted = '\uC548\uB155 tab.txt';
    write('old.txt', 'one\ntwo\nthree\n');
    writeFileSync(join(repoRoot, 'img.bin'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));
    write('mode.sh', 'a\nb\n');
    write(quoted, 'x\n');
    git('add', '-A');
    git('commit', '--quiet', '-m', 'base');
    git('mv', 'old.txt', 'new.txt');
    write('new.txt', 'one\nTWO\nthree\n');
    writeFileSync(join(repoRoot, 'img.bin'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x02]));
    chmodSync(join(repoRoot, 'mode.sh'), 0o755);
    write(quoted, 'y\n');
    write('created.txt', 'one\ntwo\n');
    git('add', '-A');

    const input = translate(git('diff', '--cached'));

    // Compared as a set: which blocks git emits is the contract, the order it sorts them
    // in is not.
    const byNameAndPath = (a: { name: string; args?: unknown }, b: typeof a): number =>
      `${a.name} ${String((a.args as { file_path: string }).file_path)}`.localeCompare(
        `${b.name} ${String((b.args as { file_path: string }).file_path)}`,
      );
    const expected: CovenantInput['toolCalls'] = [
      {
        name: STAGED_WRITE,
        args: { file_path: 'created.txt' },
        fileChange: { kind: 'create', path: 'created.txt', post: 'one\ntwo' },
      },
      { name: STAGED_WRITE, args: { file_path: 'img.bin' } },
      {
        name: STAGED_WRITE,
        args: { file_path: 'mode.sh' },
        fileChange: { kind: 'modify', path: 'mode.sh', pre: '', post: '' },
      },
      {
        name: STAGED_DELETE,
        args: { file_path: 'old.txt' },
        fileChange: { kind: 'delete', path: 'old.txt' },
      },
      {
        name: STAGED_WRITE,
        args: { file_path: 'new.txt' },
        fileChange: { kind: 'modify', path: 'new.txt', pre: 'two', post: 'TWO' },
      },
      {
        name: STAGED_WRITE,
        args: { file_path: quoted },
        fileChange: { kind: 'modify', path: quoted, pre: 'x', post: 'y' },
      },
    ];
    expect(input.toolCalls).toHaveLength(expected.length);
    expect([...input.toolCalls].sort(byNameAndPath)).toEqual([...expected].sort(byNameAndPath));
    expect(input.subagentSpawns).toEqual([]);
    expect(input.userMessages).toEqual([]);
    const binary = input.toolCalls.find((call) => call.args?.file_path === 'img.bin');
    expect(binary !== undefined && 'fileChange' in binary).toBe(false);
  });

  it('a staged symlink translates as a write of the link path whose post is the target path', () => {
    // git stores a symlink as a blob holding the target path (mode 120000); the diff shows
    // `+target`. A translator that special-cases the mode line and drops the block leaves
    // a link into a protected directory unjudged.
    const { repoRoot, git } = repo;
    symlinkSync('secret.txt', join(repoRoot, 'link'));
    git('add', 'link');

    expect(translate(git('diff', '--cached')).toolCalls).toEqual([
      {
        name: STAGED_WRITE,
        args: { file_path: 'link' },
        fileChange: { kind: 'create', path: 'link', post: 'secret.txt' },
      },
    ]);
  });
});
