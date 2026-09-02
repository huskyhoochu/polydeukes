import type { CovenantInput, DisciplineEntry, FileChange } from '@polydeukes/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
// A declare entry's `sources` block names files outside the target. The compiled
// registration carries the bindings (the plan's input), and the declare judgment path adds
// one world key per binding under the merge rule: a named file INSIDE this input's change
// set reads as that change's `post` (create/modify) or as absent (delete), whatever the
// supply layer read from disk; a file outside the change set reads as the supplied value,
// or absent. Absence is the declaration's own `supply` policy's to dispose of. Every world
// also carries `changes`, the observation unit's change set, which a declaration reads as
// a source of its own.
import { type CompileDisciplinesSpec, compileDisciplineRegistrations } from '../src/discipline.ts';
import type { CovenantRegistration } from '../src/dispatch.ts';

// No fixture here drives a shell-derived write, so the injected pre-state reader is never
// consulted; `null` — the file is not there — is the answer that would make a create if one
// ever were.
const readPreState = () => null;

const ROOT = '/repo';
const SHELL_TOOL = 'Bash';
const COMMAND_ARG = 'command';
const ID = 'locale-keys';
const ENTRY = 'has-a';
// Source names and paths are fixture values.
const EN = 'en';
const EN_FILE = 'locales/en.json';
const KO = 'ko';
const KO_FILE = 'locales/ko.json';
const OTHER_FILE = 'docs/readme.md';
const CHANGES = 'changes';

/** Reads `en` through json → flattenKeys and holds when at least one key exists. */
const READS_EN = {
  sources: { [EN]: { file: EN_FILE } },
  supply: { [EN]: 'error' },
  extract: { keys: [{ op: 'source', of: EN }, { op: 'json' }, { op: 'flattenKeys' }] },
  relate: [{ id: ENTRY, relation: { op: 'NonEmpty', of: 'keys' }, message: '{value}' }],
};

/**
 * Dumps the `changes` source through the verdict: `Empty` breaks with every item, so the
 * witness carries the value the world supplied.
 */
const DUMPS_CHANGES = {
  supply: { [CHANGES]: 'error' },
  extract: { all: [{ op: 'source', of: CHANGES }] },
  relate: [{ id: 'dump', relation: { op: 'Empty', of: 'all' }, message: '{value}' }],
};

/** A declare entry; extra head keys ride along. */
function declareEntry(declare: Record<string, unknown>, head: Record<string, unknown> = {}) {
  return { id: ID, ...head, declare } as unknown as DisciplineEntry;
}

function specWith(disciplines: DisciplineEntry[]): CompileDisciplinesSpec {
  return {
    disciplines,
    rootDir: ROOT,
    shellTools: [SHELL_TOOL],
    commandArgs: [COMMAND_ARG],
    readPreState,
  };
}

/** A CovenantInput of the given changes, in order, with an optional world axis. */
function inputOf(
  changes: FileChange[],
  world?: NonNullable<CovenantInput['world']>,
): CovenantInput {
  return {
    toolCalls: changes.map((fileChange, index) => ({
      name: `call-${index}`,
      args: { file_path: fileChange.path },
      fileChange,
    })),
    subagentSpawns: [],
    userMessages: [],
    ...(world !== undefined && { world }),
  };
}

const create = (path: string, post: string): FileChange => ({ kind: 'create', path, post });
const modify = (path: string, pre: string, post: string): FileChange => ({
  kind: 'modify',
  path,
  pre,
  post,
});
const remove = (path: string, pre: string): FileChange => ({ kind: 'delete', path, pre });

/** Compile one entry and return its body registration; a missing one fails loudly. */
function compileBody(entry: DisciplineEntry): CovenantRegistration {
  const reg = compileDisciplineRegistrations(specWith([entry])).find(
    (candidate) => candidate.label === entry.id && candidate.skip === undefined,
  );
  if (reg === undefined) throw new Error(`no body registration compiled for ${entry.id}`);
  return reg;
}

/** Run a registration's body; a skip registration has none and that is the failure. */
async function judgeWith(reg: CovenantRegistration, input: CovenantInput) {
  if (reg.body === undefined) throw new Error(`registration ${reg.label} carries no body`);
  return (await reg.body(input)) as {
    exitCode: number;
    reason?: string;
    witnesses?: readonly {
      id: string;
      witnesses: readonly { key: string; value: unknown }[];
    }[];
  };
}

function spyStderr() {
  return vi.spyOn(process.stderr, 'write').mockReturnValue(true);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('compileDisciplineRegistrations — a declare registration carries its sources bindings', () => {
  it('lists every binding as { name, file } in declaration order', () => {
    // The bindings are the plan's only input: a registration that drops them plans no
    // file, the root supplies nothing, and every `sources` declaration refuses under
    // `error` or skips under `pass`. Order is the plan's order.
    const reg = compileBody(
      declareEntry({
        ...READS_EN,
        sources: { [KO]: { file: KO_FILE }, [EN]: { file: EN_FILE } },
        supply: { [EN]: 'error', [KO]: 'error' },
      }),
    );

    expect(reg.sources).toEqual([
      { name: KO, file: KO_FILE },
      { name: EN, file: EN_FILE },
    ]);
  });

  it('a forbid entry and a declare entry without a sources block carry no binding', () => {
    // A family that names no file must not plan one: an invented binding (`target.path`
    // as a file, say) reads the target twice and keys the supplied value under a name no
    // declaration asked for. Absent and empty both plan nothing.
    const regs = compileDisciplineRegistrations(
      specWith([
        { id: 'no-secrets', forbid: 'SECRET' } as DisciplineEntry,
        declareEntry({ ...READS_EN, sources: undefined, supply: { [EN]: 'pass' } }),
      ]),
    );

    expect(regs.length).toBeGreaterThanOrEqual(2);
    for (const reg of regs) expect(reg.sources ?? []).toEqual([]);
  });
});

describe('the declare body — a named source inside the change set reads as the change', () => {
  it('a modify of the named file reads its post, not the supplied value (post proves the keys exist)', async () => {
    // The session surface's disk is pre-edit: reading the supplied `{}` here refuses a
    // key set the edit is creating, and the two surfaces split on the same edit.
    const reg = compileBody(declareEntry(READS_EN));
    const input = inputOf([modify(EN_FILE, '{}', '{"a":1}')], { files: { [EN_FILE]: '{}' } });

    expect((await judgeWith(reg, input)).exitCode).toBe(0);
  });

  it('the flipped fixture: post empty, supplied full — the judgment breaks on the post', async () => {
    // The control for the test above: a body reading the supplied value passes both
    // fixtures, so only the pair proves which side was read.
    const reg = compileBody(declareEntry(READS_EN));
    const input = inputOf([modify(EN_FILE, '{"a":1}', '{}')], {
      files: { [EN_FILE]: '{"a":1}' },
    });

    const outcome = await judgeWith(reg, input);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.reason).toContain(`discipline '${ID}' broken on ${EN_FILE}`);
  });

  it('a create of the named file reads its post with no world axis at all', async () => {
    // The merge rule is per change kind, not modify-only: a create is in the change set
    // and its post is the source; treating it as "outside" refuses the file's first write.
    const reg = compileBody(declareEntry(READS_EN));

    expect((await judgeWith(reg, inputOf([create(EN_FILE, '{"a":1}')]))).exitCode).toBe(0);
  });

  it('a delete of the named file reads as absent even when the supply layer read a value', async () => {
    // After the delete there is no file; falling back to the supplied (pre-delete) text
    // judges a world that no longer exists and passes a deletion the declaration should
    // have refused.
    spyStderr();
    const reg = compileBody(declareEntry(READS_EN));
    const input = inputOf([remove(EN_FILE, '{"a":1}')], { files: { [EN_FILE]: '{"a":1}' } });

    expect((await judgeWith(reg, input)).exitCode).toBe(2);
  });

  it('the change set governs every world, not only the world whose target is the named file', async () => {
    // Two changes: the first targets another file, the second rewrites the named file to
    // `{}`. The first world must already read the post `{}` (the file is in this input's
    // change set) and break there; a per-world rule ("post only when target === file")
    // reads the supplied `{"a":1}` for the first world and reports the second instead.
    const reg = compileBody(declareEntry(READS_EN));
    const input = inputOf([create(OTHER_FILE, 'x'), modify(EN_FILE, '{"a":1}', '{}')], {
      files: { [EN_FILE]: '{"a":1}' },
    });

    const outcome = await judgeWith(reg, input);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.reason).toContain(`discipline '${ID}' broken on ${OTHER_FILE}`);
  });
});

describe('the declare body — a named source outside the change set reads as supplied', () => {
  it('reads input.world.files[file] when the target is another file', async () => {
    // The whole point of the block: without the merge the source is absent on every
    // world and a parity declaration refuses every edit under `error`.
    const reg = compileBody(declareEntry(READS_EN));
    const input = inputOf([create(OTHER_FILE, 'x')], { files: { [EN_FILE]: '{"a":1}' } });

    expect((await judgeWith(reg, input)).exitCode).toBe(0);
  });

  it('with nothing supplied, supply: error exits 2 and names the source on stderr', async () => {
    // Absence is absence: a fabricated `{}` parses to an empty key set and breaks (1), a
    // fabricated `''` fails to parse — either way the author's policy never ran. `2` is
    // the unjudgeable outcome the advise level does not wave through.
    const reg = compileBody(declareEntry(READS_EN));
    const stderr = spyStderr();

    const outcome = await judgeWith(reg, inputOf([create(OTHER_FILE, 'x')]));

    expect(outcome.exitCode).toBe(2);
    const lines = stderr.mock.calls.map((call) => String(call[0])).filter((s) => s.includes(ID));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(EN);
  });

  it('with nothing supplied, supply: pass exits 0', async () => {
    // The author's escape hatch must reach the named source like any other; a merge that
    // consults the policy only for the four fixed names keeps every such edit refused.
    const reg = compileBody(declareEntry({ ...READS_EN, supply: { [EN]: 'pass' } }));

    expect((await judgeWith(reg, inputOf([create(OTHER_FILE, 'x')]))).exitCode).toBe(0);
  });

  it('a supplied value under another path does not stand in for the named file', async () => {
    // Keys are repo-relative paths, matched exactly: a lookup that takes the first
    // supplied entry, or matches by basename, hands `ko.json` to a declaration reading `en`.
    spyStderr();
    const reg = compileBody(declareEntry(READS_EN));
    const input = inputOf([create(OTHER_FILE, 'x')], { files: { [KO_FILE]: '{"a":1}' } });

    expect((await judgeWith(reg, input)).exitCode).toBe(2);
  });
});

describe('the declare body — the changes source', () => {
  it('reads the whole change set of the input, in input order', async () => {
    // Under today's world the source is absent and the body answers 2; a per-world list
    // answers `[own path]`. The dump relation surfaces the exact value the world carried.
    const reg = compileBody(declareEntry(DUMPS_CHANGES));

    const outcome = await judgeWith(
      reg,
      inputOf([create('docs/a.md', 'x'), create('docs/a.ko.md', 'y')]),
    );

    expect(outcome.exitCode).toBe(1);
    expect(outcome.witnesses?.[0]?.witnesses).toEqual([
      { key: '0', value: ['docs/a.md', 'docs/a.ko.md'] },
    ]);
  });

  it('reads input.world.changes when the root supplied one, in the commit surface shape', async () => {
    // One dispatched change, three staged: the declaration must see the three.
    const reg = compileBody(declareEntry(DUMPS_CHANGES));
    const staged = ['docs/a.md', 'docs/a.ko.md', 'docs/b.md'];

    const outcome = await judgeWith(reg, inputOf([create('docs/a.md', 'x')], { changes: staged }));

    expect(outcome.witnesses?.[0]?.witnesses).toEqual([{ key: '0', value: staged }]);
  });
});

describe('compileDisciplineRegistrations — a binding path is normalized before it is registered', () => {
  // The plan keys the supplied files by the registered path and the merge rule matches it
  // against change paths, which are always bare repo-relative. A `./` an author wrote is
  // one path in two spellings: the file is read under one and looked up under the other.
  const DOTTED_EN_FILE = './locales/en.json';
  const GLOSSARY = 'glossary';
  const DOTTED_GLOSSARY_FILE = 'docs/./glossary.md';
  const GLOSSARY_FILE = 'docs/glossary.md';

  it('strips a leading ./ and an inner /./ segment from the registered binding', () => {
    // A registration copying `file` verbatim plans `./locales/en.json`; the supply layer
    // keys the text under that spelling and the judgment never finds it.
    const reg = compileBody(
      declareEntry({
        ...READS_EN,
        sources: { [EN]: { file: DOTTED_EN_FILE }, [GLOSSARY]: { file: DOTTED_GLOSSARY_FILE } },
        supply: { [EN]: 'error', [GLOSSARY]: 'error' },
      }),
    );

    expect(reg.sources).toEqual([
      { name: EN, file: EN_FILE },
      { name: GLOSSARY, file: GLOSSARY_FILE },
    ]);
  });

  it('a binding written ./locales/en.json reads the post of a modify of locales/en.json', async () => {
    // The judgment must match the normalized binding against the change set: a body that
    // re-reads the declaration's own `sources` block treats the edit as outside the set,
    // looks the dotted spelling up in the supplied files, finds nothing, and refuses under
    // `error` an edit whose post carries the keys.
    const reg = compileBody(
      declareEntry({ ...READS_EN, sources: { [EN]: { file: DOTTED_EN_FILE } } }),
    );
    const input = inputOf([modify(EN_FILE, '{}', '{"a":1}')], { files: { [EN_FILE]: '{}' } });

    expect((await judgeWith(reg, input)).exitCode).toBe(0);
  });
});
