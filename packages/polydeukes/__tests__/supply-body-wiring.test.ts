import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runClaudeCodeHook } from '../src/claude-code-hook.ts';
import { type RecordedCall, recordingDist, writeConfigAt } from './helpers.ts';

// The two composition roots wire the supply layer; they implement no reading of their own.
// The observation readers live in the adapters — the commit reader beside the git idiom it
// spawns, the session reader beside that surface's other supply verbs — and the roots
// inject them. A reading implementation left in a root is a second, unmeasured read path
// one surface has and the other cannot see. Source-text oracles, like the engine purity
// suite: the check reads the roots' sources, not their behaviour.

const SRC_DIR = fileURLToPath(new URL('../src/', import.meta.url));

/** One root's source with comments stripped, so a mention in prose cannot satisfy a check. */
function sourceOf(name: string): string {
  return readFileSync(`${SRC_DIR}${name}`, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
}

/** True when the module imports the named symbol from the named package. */
function importsFrom(text: string, symbol: string, pkg: string): boolean {
  const statement = new RegExp(
    `import\\s+(?:type\\s+)?\\{[^}]*\\b${symbol}\\b[^}]*\\}\\s*from\\s*'${pkg.replace('/', '\\/')}'`,
  );
  return statement.test(text);
}

describe('the umbrella carries no reading implementation', () => {
  it('read-source.ts is gone from the umbrella', () => {
    // The disk reader moved to the session adapter; a copy left here is dead at best and
    // a diverging second implementation at worst.
    expect(existsSync(`${SRC_DIR}read-source.ts`)).toBe(false);
  });

  it('covenant-check.ts spawns no git listing of its own', () => {
    // The observation readers are git spawn idioms (`ls-files --stage`, `ls-tree`,
    // `cat-file`); their spelling remaining in the root means the reading did not move,
    // whatever the imports say.
    const text = sourceOf('covenant-check.ts');

    expect(text).not.toContain('ls-files');
    expect(text).not.toContain('ls-tree');
    expect(text).not.toContain('cat-file');
  });
});

describe('the roots wire the adapters’ supply verbs', () => {
  it('covenant-check.ts imports observationSourceReader from the git adapter', () => {
    // Removing the root's own reader without wiring the adapter's leaves `supplySources`
    // with no `read` at all — every declare entry refuses under `error` on every commit.
    expect(
      importsFrom(
        sourceOf('covenant-check.ts'),
        'observationSourceReader',
        '@polydeukes/adapter-git',
      ),
    ).toBe(true);
  });

  it('claude-code-hook.ts imports sessionSourceReader and sessionChannelReader from the session adapter', () => {
    // The channel reader is the session surface's only path onto the spawn sidecar: a
    // root that wires the file reader alone leaves every sidecar declaration judging
    // absence on a session that has the records on disk.
    const text = sourceOf('claude-code-hook.ts');

    expect(importsFrom(text, 'sessionSourceReader', '@polydeukes/adapter-claude-code')).toBe(true);
    expect(importsFrom(text, 'sessionChannelReader', '@polydeukes/adapter-claude-code')).toBe(true);
  });
});

// An import alone is not a wiring, so the channel side is pinned by execution: the hook runs
// against a session whose sidecar holds one spawn record, and the recording dist observes
// what the root handed the dispatcher. A root that builds the channel reader and drops the
// supply result (or forwards `files` alone) leaves every sidecar declaration judging absence
// on a session whose records are on disk.

const SESSION_ID = 's-1';
const SIDECAR = 'sidecar';
const WRITER_META = { agentType: 'tdd-test-writer', toolUseId: 't1' };
const TARGET_FILE = 'lib/a.ts';

let repoRoot: string;
/** The recording dist and its log sit outside the repository the run observes. */
let outside: string;
let calls: () => RecordedCall[];
let covenantDist: string;
let transcriptPath: string;

describe('the session root supplies the channel it read', () => {
  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), 'pdks-supply-body-'));
    outside = mkdtempSync(join(tmpdir(), 'pdks-supply-body-outside-'));
    ({ distDir: covenantDist, calls } = recordingDist(outside, [], [SIDECAR]));
    writeConfigAt(repoRoot, join(repoRoot, 'roi.log'), {});
    transcriptPath = join(outside, `${SESSION_ID}.jsonl`);
    writeFileSync(transcriptPath, '{"type":"user"}\n');
    const subagents = join(outside, SESSION_ID, 'subagents');
    mkdirSync(subagents, { recursive: true });
    writeFileSync(join(subagents, 'agent-001.meta.json'), JSON.stringify(WRITER_META));
    const target = join(repoRoot, TARGET_FILE);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, 'export {};\n');
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it('the dispatch world carries the sidecar records the session had on disk', async () => {
    await runClaudeCodeHook({
      repoRoot,
      covenantDist,
      rawPayload: JSON.stringify({
        hook_event_name: 'PreToolUse',
        session_id: SESSION_ID,
        transcript_path: transcriptPath,
        cwd: repoRoot,
        tool_name: 'Write',
        tool_input: { file_path: join(repoRoot, TARGET_FILE), content: 'export {};\n' },
      }),
    });

    const worlds = calls()
      .filter(
        (call): call is Extract<RecordedCall, { kind: 'dispatch' }> => call.kind === 'dispatch',
      )
      .map((call) => call.world);

    expect(worlds.length).toBeGreaterThan(0);
    for (const world of worlds) {
      expect(world?.channels).toEqual({ [SIDECAR]: JSON.stringify([WRITER_META]) });
    }
  });
});
