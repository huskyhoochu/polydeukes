import type { FileChange } from '@polydeukes/core';
import { describe, expect, it } from 'vitest';
import { parseApplyPatch } from '../src/apply-patch.ts';

// The V4A patch parser: the raw text of an `apply_patch` call in, one `FileChange` per file
// out. Pure — the only way to the disk is the injected reader, and a text the grammar refuses
// answers `{ ok: false }` rather than throwing, so the caller turns it into a fail-closed
// spawn. Grammar fixtures follow the official `apply_patch` grammar (`codex-rs/apply-patch`,
// 2026-09-16). Every path here is written as the patch text carries it; resolving it
// against the call's cwd is the hook's job.

/** Injected fixture values — target paths and their pre-states. */
const NEW_FILE = 'docs/new.md';
const OLD_FILE = 'src/old.ts';
const MOVED_FILE = 'src/moved.ts';
const OLD_STATE = 'alpha\nbeta\ngamma\n';

type Parsed = ReturnType<typeof parseApplyPatch>;

/** A reader over a fixed map: `null` for anything the map does not name. */
function readerOver(files: Record<string, string>): (path: string) => string | null {
  return (path) => (path in files ? (files[path] as string) : null);
}

/** No file exists and the reader records every path it was asked for. */
function absentReader(): { asked: string[]; read: (path: string) => string | null } {
  const asked: string[] = [];
  return {
    asked,
    read: (path) => {
      asked.push(path);
      return null;
    },
  };
}

function changesOf(parsed: Parsed): FileChange[] {
  expect(parsed.ok, parsed.ok ? '' : parsed.reason).toBe(true);
  return parsed.ok ? parsed.value : [];
}

function expectRefused(parsed: Parsed): string {
  expect(parsed.ok).toBe(false);
  return parsed.ok ? '' : parsed.reason;
}

describe('parseApplyPatch — one hunk, one change', () => {
  it('maps `Add File` to a create whose post is the `+` lines with the prefix stripped', () => {
    // A post that keeps the `+` prefix, or that drops the trailing newline the grammar puts
    // after every line, hands the judge a file the tool will never write.
    const { asked, read } = absentReader();
    const patch = [
      '*** Begin Patch',
      `*** Add File: ${NEW_FILE}`,
      '+# Title',
      '+',
      '+body',
      '*** End Patch',
      '',
    ].join('\n');

    expect(changesOf(parseApplyPatch(patch, read))).toEqual([
      { kind: 'create', path: NEW_FILE, post: '# Title\n\nbody\n' },
    ]);
    expect(asked).toEqual([]);
  });

  it('maps `Delete File` to a delete whose pre comes from the injected reader', () => {
    // A delete without its pre lets a discipline that reads the deleted text see nothing;
    // one whose pre is read from a path other than the named one judges the wrong file.
    const changes = changesOf(
      parseApplyPatch(
        ['*** Begin Patch', `*** Delete File: ${OLD_FILE}`, '*** End Patch', ''].join('\n'),
        readerOver({ [OLD_FILE]: OLD_STATE }),
      ),
    );

    expect(changes).toEqual([{ kind: 'delete', path: OLD_FILE, pre: OLD_STATE }]);
  });

  it('maps `Update File` to a modify whose post is the hunk applied to the pre', () => {
    // A post made of the `+` lines alone (no context, no untouched lines) is the create
    // parser reused for updates; a post equal to pre is a parser that never applied the hunk.
    const patch = [
      '*** Begin Patch',
      `*** Update File: ${OLD_FILE}`,
      '@@',
      ' alpha',
      '-beta',
      '+BETA',
      ' gamma',
      '*** End Patch',
      '',
    ].join('\n');

    expect(changesOf(parseApplyPatch(patch, readerOver({ [OLD_FILE]: OLD_STATE })))).toEqual([
      { kind: 'modify', path: OLD_FILE, pre: OLD_STATE, post: 'alpha\nBETA\ngamma\n' },
    ]);
  });

  it('applies a hunk whose `@@` line carries a context heading', () => {
    // `@@ <heading>` is the grammar's second context form. A parser that accepts only the
    // bare `@@` refuses every hunk the model anchors on a function name.
    const patch = [
      '*** Begin Patch',
      `*** Update File: ${OLD_FILE}`,
      '@@ alpha',
      '-beta',
      '+BETA',
      '*** End Patch',
      '',
    ].join('\n');

    expect(changesOf(parseApplyPatch(patch, readerOver({ [OLD_FILE]: OLD_STATE })))).toEqual([
      { kind: 'modify', path: OLD_FILE, pre: OLD_STATE, post: 'alpha\nBETA\ngamma\n' },
    ]);
  });

  it('refuses an `Update File` whose hunk context does not occur in the pre', () => {
    // The tool refuses this patch. A parser that splices the `+` lines in anyway proves a
    // mutation that will not happen, and the judge rules on a fiction.
    const patch = [
      '*** Begin Patch',
      `*** Update File: ${OLD_FILE}`,
      '@@',
      ' nowhere',
      '-beta',
      '+BETA',
      '*** End Patch',
      '',
    ].join('\n');

    expectRefused(parseApplyPatch(patch, readerOver({ [OLD_FILE]: OLD_STATE })));
  });

  it('refuses an `Update File` whose target the reader does not find', () => {
    // A modify needs a pre. Reading absence as an empty pre turns the update into a create
    // of whatever the `+` lines say, which is not what the tool would do.
    const patch = [
      '*** Begin Patch',
      `*** Update File: ${OLD_FILE}`,
      '@@',
      '-beta',
      '+BETA',
      '*** End Patch',
      '',
    ].join('\n');

    expectRefused(parseApplyPatch(patch, absentReader().read));
  });
  it('refuses a `Delete File` whose target the reader does not find', () => {
    // The tool refuses to delete what is not there. A delete emitted without its `pre`
    // lets a discipline over the deleted text read an absent source and pass on it.
    expectRefused(
      parseApplyPatch(
        ['*** Begin Patch', `*** Delete File: ${OLD_FILE}`, '*** End Patch', ''].join('\n'),
        absentReader().read,
      ),
    );
  });

  it('applies two hunks on one file in sequence, the second over the first’s result', () => {
    // The typical offset bug: the second hunk applied to the ORIGINAL text, so its
    // change lands on lines the first hunk already moved, or is lost when the first
    // hunk's edit sits between them. The two hunks here touch lines on either side of a
    // kept line, and only a parser that carries the first result forward yields this post.
    const patch = [
      '*** Begin Patch',
      `*** Update File: ${OLD_FILE}`,
      '@@',
      '-alpha',
      '+ALPHA',
      '+alpha-two',
      '@@',
      '-gamma',
      '+GAMMA',
      '*** End Patch',
      '',
    ].join('\n');

    expect(changesOf(parseApplyPatch(patch, readerOver({ [OLD_FILE]: OLD_STATE })))).toEqual([
      { kind: 'modify', path: OLD_FILE, pre: OLD_STATE, post: 'ALPHA\nalpha-two\nbeta\nGAMMA\n' },
    ]);
  });

  it('maps an `Add File` with no `+` line to a create of the empty file', () => {
    // Creating an empty file is a legitimate call. Refusing it fails closed on an
    // operation the tool performs, and a block the operator learns to bypass.
    const patch = ['*** Begin Patch', `*** Add File: ${NEW_FILE}`, '*** End Patch', ''].join('\n');

    expect(changesOf(parseApplyPatch(patch, absentReader().read))).toEqual([
      { kind: 'create', path: NEW_FILE, post: '' },
    ]);
  });
});

describe('parseApplyPatch — `Move to` names two paths', () => {
  it('yields the source as a delete and the destination as a create carrying the applied post', () => {
    // One element for a rename leaves one of the two paths unjudged: a file moved OUT of a
    // protected directory passes when only the destination is seen, and one moved INTO it
    // passes when only the source is. The destination's post is the source's text with the
    // hunk applied, not the `+` lines alone.
    const patch = [
      '*** Begin Patch',
      `*** Update File: ${OLD_FILE}`,
      `*** Move to: ${MOVED_FILE}`,
      '@@',
      '-beta',
      '+BETA',
      '*** End Patch',
      '',
    ].join('\n');

    expect(changesOf(parseApplyPatch(patch, readerOver({ [OLD_FILE]: OLD_STATE })))).toEqual([
      { kind: 'delete', path: OLD_FILE, pre: OLD_STATE },
      { kind: 'create', path: MOVED_FILE, post: 'alpha\nBETA\ngamma\n' },
    ]);
  });
  it('yields the same two elements for a move with no hunk, the destination carrying the source text', () => {
    // The grammar makes the change block optional after `Move to`. A parser that requires
    // a hunk refuses a plain rename — a file carried out of a protected directory with no
    // edit is then never judged, because the call fails closed before the spawn and the
    // operator opens the valve for it.
    const patch = [
      '*** Begin Patch',
      `*** Update File: ${OLD_FILE}`,
      `*** Move to: ${MOVED_FILE}`,
      '*** End Patch',
      '',
    ].join('\n');

    expect(changesOf(parseApplyPatch(patch, readerOver({ [OLD_FILE]: OLD_STATE })))).toEqual([
      { kind: 'delete', path: OLD_FILE, pre: OLD_STATE },
      { kind: 'create', path: MOVED_FILE, post: OLD_STATE },
    ]);
  });
});

describe('parseApplyPatch — several hunks, several changes, in patch order', () => {
  it('returns one element per hunk in the order the patch names them', () => {
    // A parser that stops at the first hunk judges one file of three; one that collects
    // them into a set loses the order the judgment reads them in.
    const patch = [
      '*** Begin Patch',
      `*** Add File: ${NEW_FILE}`,
      '+new',
      `*** Delete File: ${OLD_FILE}`,
      `*** Update File: ${MOVED_FILE}`,
      '@@',
      '-beta',
      '+BETA',
      '*** End Patch',
      '',
    ].join('\n');

    const changes = changesOf(
      parseApplyPatch(patch, readerOver({ [OLD_FILE]: OLD_STATE, [MOVED_FILE]: OLD_STATE })),
    );

    expect(changes.map((change) => [change.kind, change.path])).toEqual([
      ['create', NEW_FILE],
      ['delete', OLD_FILE],
      ['modify', MOVED_FILE],
    ]);
  });
});

describe('parseApplyPatch — what the grammar tolerates', () => {
  it('accepts whitespace around the whole patch and a missing final newline', () => {
    // The reference parser trims the patch text once — `patch.trim().lines()` — and allows
    // `*** End Patch` without LF. Refusing either fails closed on patches the tool itself
    // would apply. It does NOT trim each line: a change line's first character is its
    // operator, and a per-line trim reads a context line carrying marker text as a header.
    const patch = `\n  ${['*** Begin Patch', `*** Add File: ${NEW_FILE}`, '+x', '*** End Patch'].join('\n')}  \n`;

    expect(changesOf(parseApplyPatch(patch, absentReader().read))).toEqual([
      { kind: 'create', path: NEW_FILE, post: 'x\n' },
    ]);
  });

  it('reads a context line carrying marker text as the file content it is', () => {
    // A doc that quotes the patch grammar is an ordinary file to edit. Read as a header,
    // its context line fabricates a deletion of a path the patch never names — and the real
    // hunk loses the lines that followed.
    const target = 'docs/grammar.md';
    const pre = `intro\n*** Delete File: ${OLD_FILE}\noutro\n`;
    const patch = [
      '*** Begin Patch',
      `*** Update File: ${target}`,
      '@@',
      ' intro',
      ` *** Delete File: ${OLD_FILE}`,
      '-outro',
      '+OUTRO',
      '*** End Patch',
      '',
    ].join('\n');

    expect(changesOf(parseApplyPatch(patch, () => pre))).toEqual([
      {
        kind: 'modify',
        path: target,
        pre,
        post: `intro\n*** Delete File: ${OLD_FILE}\nOUTRO\n`,
      },
    ]);
  });

  it('reads a `Move to` below the first body line as content, not as a rename', () => {
    // The grammar puts the rename directive on the line right after the header. Searching
    // the whole body takes a file's own text as a rename the tool never performs, and turns
    // a modify into a delete/create pair no discipline keyed on modify ever sees.
    const target = 'docs/apply-patch.md';
    const pre = `*** Move to: ${NEW_FILE}\nDone\n`;
    const patch = [
      '*** Begin Patch',
      `*** Update File: ${target}`,
      '@@',
      ` *** Move to: ${NEW_FILE}`,
      '-Done',
      '+Finished',
      '*** End Patch',
      '',
    ].join('\n');

    expect(changesOf(parseApplyPatch(patch, () => pre))).toEqual([
      { kind: 'modify', path: target, pre, post: `*** Move to: ${NEW_FILE}\nFinished\n` },
    ]);
  });

  it('applies an update whose first block carries no `@@` header', () => {
    // The grammar makes the context marker optional, so a body may begin with its change
    // lines. Skipping such a body answers a post identical to the pre: the path is still
    // judged, and every discipline reading the content sees an edit that is not there.
    const pre = 'const a = 1;\nconst b = 2;\n';
    const patch = [
      '*** Begin Patch',
      `*** Update File: ${OLD_FILE}`,
      '-const b = 2;',
      '+const b = 999;',
      '*** End Patch',
      '',
    ].join('\n');

    expect(changesOf(parseApplyPatch(patch, () => pre))).toEqual([
      { kind: 'modify', path: OLD_FILE, pre, post: 'const a = 1;\nconst b = 999;\n' },
    ]);
  });

  it('applies an update whose lines carry CRLF', () => {
    // A carriage return belongs to the line ending, not to the text. Kept on the body lines
    // it never matches a pre-state read from disk, so every update on a CRLF checkout is
    // refused and the operator spends a witness token per call.
    const pre = 'alpha\nbeta\n';
    const patch = [
      '*** Begin Patch',
      `*** Update File: ${OLD_FILE}`,
      '@@',
      ' alpha',
      '-beta',
      '+BETA',
      '*** End Patch',
      '',
    ].join('\r\n');

    expect(changesOf(parseApplyPatch(patch, () => pre))).toEqual([
      { kind: 'modify', path: OLD_FILE, pre, post: 'alpha\nBETA\n' },
    ]);
  });

  it('skips an `Environment ID` line between the header and the first hunk', () => {
    // The grammar allows it once after `*** Begin Patch`; a parser reading it as a stray
    // line refuses a well-formed patch.
    const patch = [
      '*** Begin Patch',
      '*** Environment ID: env-1',
      `*** Add File: ${NEW_FILE}`,
      '+x',
      '*** End Patch',
      '',
    ].join('\n');

    expect(changesOf(parseApplyPatch(patch, absentReader().read))).toHaveLength(1);
  });

  it('reads a `+` line that spells a marker as content, never as a second hunk', () => {
    // A parser matching marker text anywhere on a line would see `*** Delete File:` inside
    // added content and emit a delete of a file the patch never touches; the create's own
    // post must keep the line verbatim.
    const patch = [
      '*** Begin Patch',
      `*** Add File: ${NEW_FILE}`,
      `+*** Delete File: ${OLD_FILE}`,
      '*** End Patch',
      '',
    ].join('\n');

    expect(changesOf(parseApplyPatch(patch, absentReader().read))).toEqual([
      { kind: 'create', path: NEW_FILE, post: `*** Delete File: ${OLD_FILE}\n` },
    ]);
  });
});

describe('parseApplyPatch — what the grammar refuses', () => {
  it.each([
    ['no `*** Begin Patch` header', [`*** Add File: ${NEW_FILE}`, '+x', '*** End Patch']],
    ['no `*** End Patch` footer', ['*** Begin Patch', `*** Add File: ${NEW_FILE}`, '+x']],
    ['no hunk at all', ['*** Begin Patch', '*** End Patch']],
    [
      'a `+` line before any hunk header',
      ['*** Begin Patch', '+x', `*** Add File: ${NEW_FILE}`, '+y', '*** End Patch'],
    ],
    [
      'an `Add File` body line without the `+` prefix',
      ['*** Begin Patch', `*** Add File: ${NEW_FILE}`, 'x', '*** End Patch'],
    ],
    ['a hunk header naming no path', ['*** Begin Patch', '*** Add File:', '+x', '*** End Patch']],
    [
      'a header that is not one of the three hunk kinds',
      ['*** Begin Patch', `*** Rename File: ${NEW_FILE}`, '*** End Patch'],
    ],
    ['empty text', ['']],
  ])('%s → { ok: false } with a reason, never a throw', (_title, lines) => {
    // Each of these is a text the tool refuses or a text that names no provable change. A
    // parser that answers `ok: true` with zero changes on any of them hands the judge an
    // IR with nothing to judge — an unrouted pass. The no-hunk case is the degenerate
    // form: a well-formed envelope around no file.
    const { asked, read } = absentReader();

    const reason = expectRefused(parseApplyPatch(lines.join('\n'), read));

    expect(reason.length).toBeGreaterThan(0);
    expect(asked).toEqual([]);
  });

  it('lets a reader’s throw through unchanged — the caller translates it', () => {
    // The reader distinguishes absence from a refused read by throwing; the parser must let
    // that reach the caller unchanged, so the hook can fail closed on it with its own line.
    const patch = ['*** Begin Patch', `*** Delete File: ${OLD_FILE}`, '*** End Patch', ''].join(
      '\n',
    );
    const refused = new Error('EACCES: permission denied');

    expect(() =>
      parseApplyPatch(patch, () => {
        throw refused;
      }),
    ).toThrow(refused);
  });
});
