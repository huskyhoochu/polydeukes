import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// The session root's `plan → supply → dispatch` wiring. The hook plans
// the sources the assembled registrations name, reads each one FROM DISK under repoRoot,
// and hands the dispatcher `world: { files }` — and nothing else: one PreToolUse call is
// the whole observation, so the change set is the judge's own derivation from the input,
// never a list the root supplies.
//
// The disk is the pre-edit state on this surface. The root hands the judge that state as
// read; the rule that the judged change's own `post` overrides it belongs to the
// judge, so the root supplying the payload's post here would hide a missing override
// behind a value that happened to coincide.
//
// The dispatcher and the supply verbs are observed through a recording dist on the
// `covenantDist` seam (helpers.ts `recordingDist`); the real judges still run behind it.
import { runClaudeCodeHook } from '../src/claude-code-hook.ts';
import { type RecordedCall, recordingDist, telemetryRows, writeConfigAt } from './helpers.ts';

/** Injected fixture values — the declare entry, the file its source names, the protected entry. */
const DECLARE_ID = 'en-locale-has-keys';
const SOURCE_NAME = 'en';
const EN_FILE = 'locales/en.json';
/** Planned by the recording dist, never written to disk. */
const MISSING_FILE = 'locales/missing.json';
const PROTECTED_ENTRY = 'gate';
/** The umbrella's protected-paths registration label — an observable contract, not a fixture choice. */
const SELF_MOD_LABEL = 'self-mod';
/** What the disk holds when the call is judged, and what the Edit would make of it. */
const DISK_CONTENT = '{"a":1}';
const EDITED_CONTENT = '{"a":1,"b":2}';
const declareEntry = {
  id: DECLARE_ID,
  why: 'the English locale must carry at least one key',
  declare: {
    // World axis with `nonEmpty`: `scoped-valve` is the one name that admits it, and it
    // asks for the valve block below.
    mechanism: 'scoped-valve',
    sources: { [SOURCE_NAME]: { file: EN_FILE } },
    supply: { [SOURCE_NAME]: 'pass' },
    scope: { source: 'target.path', include: ['^locales/'] },
    extract: {
      enKeys: [{ op: 'source', of: SOURCE_NAME }, { op: 'json' }, { op: 'flattenKeys' }],
    },
    relate: [
      {
        id: 'has-keys',
        relation: { op: 'nonEmpty', of: 'enKeys' },
        message: 'the English locale carries no key',
      },
    ],
    witness: {
      extract: {
        override: [
          { op: 'source', of: 'target.path' },
          { op: 'matches', re: '^$' },
        ],
      },
      relate: [{ id: 'valve', relation: { op: 'nonEmpty', of: 'override' }, message: 'w' }],
    },
  },
};

let repoRoot: string;
let telemetryPath: string;
/** The recording dist and its log sit outside the repository, as on the commit surface. */
let outside: string;
let calls: () => RecordedCall[];
let covenantDist: string;

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), 'pdks-session-world-axis-'));
  telemetryPath = join(repoRoot, 'roi.log');
  outside = mkdtempSync(join(tmpdir(), 'pdks-session-world-axis-outside-'));
  ({ distDir: covenantDist, calls } = recordingDist(outside, [EN_FILE, MISSING_FILE]));
  writeConfigAt(repoRoot, telemetryPath, {
    protectedPaths: [PROTECTED_ENTRY],
    disciplines: [declareEntry],
  });
  const target = join(repoRoot, EN_FILE);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, DISK_CONTENT);
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

/** One PreToolUse Edit of the locale — the target IS the planned file. */
function editLocalePayload(): string {
  return JSON.stringify({
    hook_event_name: 'PreToolUse',
    session_id: 's-1',
    cwd: repoRoot,
    tool_name: 'Edit',
    tool_input: {
      file_path: join(repoRoot, EN_FILE),
      old_string: DISK_CONTENT,
      new_string: EDITED_CONTENT,
    },
  });
}

/** The worlds every dispatch of the call received, in dispatch order. */
function dispatchedWorlds(): NonNullable<Extract<RecordedCall, { kind: 'dispatch' }>['world']>[] {
  return calls()
    .filter((call): call is Extract<RecordedCall, { kind: 'dispatch' }> => call.kind === 'dispatch')
    .map((call) => {
      expect(call.hasWorld, 'a dispatch received no world').toBe(true);
      return call.world as NonNullable<typeof call.world>;
    });
}

/** The call must have been judged, not failed closed: exit 0 and no `blocked` row from any label. */
function expectJudged(result: { exitCode: number }): void {
  expect(result.exitCode).toBe(0);
  expect(telemetryRows(telemetryPath).filter(([event]) => event === 'blocked')).toEqual([]);
}

describe('session hook — the world is read from disk under repoRoot', () => {
  it('the dispatcher receives the DISK text of a planned file, and no key for a planned file the disk lacks', async () => {
    // Disk and payload disagree on purpose: the disk is the pre-edit state and the Edit
    // carries the post. A root that supplies the payload's post — or resolves the path
    // against cwd rather than repoRoot and reads nothing — leaves the judge a world the
    // spec never promised. The missing file kills a `read` that folds ENOENT into '' or
    // null: an absent key is the only absence the `supply` policy can dispose of.
    const result = await runClaudeCodeHook({
      repoRoot,
      rawPayload: editLocalePayload(),
      telemetryPath,
      covenantDist,
    });

    expectJudged(result);
    expect(dispatchedWorlds().map((world) => world.files)).toEqual([{ [EN_FILE]: DISK_CONTENT }]);
  });

  it('the dispatcher receives NO `changes` — the change set is the judge’s derivation on this surface', async () => {
    // The commit root supplies `changes` because it dispatches one change at a time; the
    // session root has nothing the judge cannot derive, and a supplied list would be the
    // one the judge stops deriving — an embedder handing the same input without a root
    // then sees a different change set than the hook did. The world's keys are pinned so
    // a root copying the commit wiring (`changes: [target]`) is refuted, not just one
    // sending `changes: []`.
    const result = await runClaudeCodeHook({
      repoRoot,
      rawPayload: editLocalePayload(),
      telemetryPath,
      covenantDist,
    });

    expectJudged(result);
    const worlds = dispatchedWorlds();
    expect(worlds).toHaveLength(1);
    expect(worlds[0]?.changes).toBeUndefined();
    expect(worlds[0]?.keys).toEqual(['files', 'channels']);
  });
});

describe('session hook — the plan is made from the assembled registrations', () => {
  it('planSources receives the registrations the call is judged with — the declare entry and the meta-covenant', async () => {
    // Planning before the compiler has run, or from a list that omits the compiled
    // disciplines, supplies nothing to the entry that named a file: under `supply: error`
    // every call it scopes is then refused for a wiring fault dressed as a verdict.
    const result = await runClaudeCodeHook({
      repoRoot,
      rawPayload: editLocalePayload(),
      telemetryPath,
      covenantDist,
    });

    expectJudged(result);
    const plans = calls().filter((call) => call.kind === 'plan');
    expect(plans).toHaveLength(1);
    expect(plans[0]?.labels).toEqual(expect.arrayContaining([DECLARE_ID, SELF_MOD_LABEL]));
  });
});

describe('session hook — a planned path the disk cannot give as text is an absence', () => {
  // Only ENOENT is folded into absence by a `read` that mirrors the pre-state reader;
  // a directory and a binary file are two more shapes the disk can hold under a planned
  // path, and neither is a text a declaration can parse. Both land as "no key" — the
  // `supply` policy disposes of them — while the file beside them is still read.
  const DIR_PATH = 'locales/nested';
  const BINARY_FILE = 'locales/blob.bin';

  it('a planned path that is a directory yields no key, and the call is still judged once', async () => {
    // `readFileSync` on a directory throws EISDIR; a `read` that folds only ENOENT
    // propagates it, and the root fails closed on a path that is merely not a file.
    ({ distDir: covenantDist, calls } = recordingDist(outside, [DIR_PATH, EN_FILE]));
    mkdirSync(join(repoRoot, DIR_PATH), { recursive: true });
    writeFileSync(join(repoRoot, DIR_PATH, 'inner.json'), '{}');

    const result = await runClaudeCodeHook({
      repoRoot,
      rawPayload: editLocalePayload(),
      telemetryPath,
      covenantDist,
    });

    expectJudged(result);
    expect(dispatchedWorlds().map((world) => world.files)).toEqual([{ [EN_FILE]: DISK_CONTENT }]);
  });

  it('a planned path holding NUL bytes yields no key, not a lossy decode', async () => {
    // A utf-8 decode of binary content is a string, so a `read` without the NUL check
    // supplies it as text; `json` then fails to parse and the declaration breaks on a
    // file that was never a locale.
    ({ distDir: covenantDist, calls } = recordingDist(outside, [BINARY_FILE, EN_FILE]));
    writeFileSync(join(repoRoot, BINARY_FILE), Buffer.from('ab\0cd'));

    const result = await runClaudeCodeHook({
      repoRoot,
      rawPayload: editLocalePayload(),
      telemetryPath,
      covenantDist,
    });

    expectJudged(result);
    expect(dispatchedWorlds().map((world) => world.files)).toEqual([{ [EN_FILE]: DISK_CONTENT }]);
  });
});
