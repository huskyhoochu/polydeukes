import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Source-only architecture checks never rebuild the active session's dist.

const repoRoot = resolve(import.meta.dirname, '../../..');
const umbrellaDir = resolve(import.meta.dirname, '..');
const umbrellaSrc = join(umbrellaDir, 'src');
const ADAPTERS = ['adapter-claude-code', 'adapter-codex', 'adapter-grok'];

/** The umbrella files that carried the in-process session path. */
const OLD_SESSION_PATH_FILES = ['claude-code-hook.ts', 'claude-code.ts'];
/** The adapter's in-process entry the old path called, and the file that defined it. */
const OLD_ADAPTER_ENTRY = 'runAdapterPath';
const OLD_ADAPTER_ENTRY_FILE = 'run-adapter-path.ts';
/** The umbrella's Grok-to-Claude name rewrite the old wiring needed. */
const NAME_REWRITE = 'rewriteGrokToolNames';

/**
 * An agent's tool roster, matched as quoted string literals: a bare word like `Edit` is also
 * an identifier fragment, and the roster only reaches the umbrella as a string.
 */
const AGENT_TOOL_NAMES = [
  'Write',
  'Edit',
  'MultiEdit',
  'NotebookEdit',
  'Bash',
  'search_replace',
  'run_terminal_command',
];
/** An agent's payload keys, matched as whole identifiers. */
const AGENT_PAYLOAD_KEYS = ['tool_name', 'toolInput', 'tool_input', 'transcript_path'];

const stripComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const walkTs = (dir: string): string[] => {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walkTs(path);
    return name.endsWith('.ts') ? [path] : [];
  });
};

/** `file: count` for every source file under `dir` whose comment-stripped text matches `needle`. */
function carriers(dir: string, needle: RegExp): string[] {
  const found: string[] = [];
  for (const file of walkTs(dir)) {
    const count = stripComments(readFileSync(file, 'utf-8')).match(needle)?.length ?? 0;
    if (count > 0) found.push(`${file.slice(dir.length + 1)}: ${count}`);
  }
  return found.sort();
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const quotedLiteral = (name: string): RegExp =>
  new RegExp(`['"\`]${escapeRegExp(name)}['"\`]`, 'g');
const identifier = (name: string): RegExp => new RegExp(`\\b${escapeRegExp(name)}\\b`, 'g');

type Manifest = {
  exports?: Record<string, unknown>;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  bin?: unknown;
};

const manifest = JSON.parse(readFileSync(join(umbrellaDir, 'package.json'), 'utf-8')) as Manifest;

describe('one-way umbrella, adapter and vocabulary ownership', () => {
  it('has neither old session file under the umbrella src', () => {
    // A file left behind is a second session entry that still rewrites Grok names and
    // writes rows beside the adapter's spawn.
    const left = OLD_SESSION_PATH_FILES.filter((name) => existsSync(join(umbrellaSrc, name)));
    expect(left).toEqual([]);
  });

  it('depends on all three adapter leaves, each pointing only to core', () => {
    for (const adapter of ADAPTERS) {
      expect(manifest.dependencies?.[`@polydeukes/${adapter}`]).toBe('workspace:^');
      const leaf = JSON.parse(
        readFileSync(join(repoRoot, 'packages', adapter, 'package.json'), 'utf8'),
      ) as Manifest;
      expect(Object.keys(leaf.dependencies ?? {})).toEqual([]);
      expect(Object.keys(leaf.peerDependencies ?? {})).toEqual(['@polydeukes/core']);
      expect(leaf.devDependencies).toHaveProperty('@polydeukes/core');
      expect(leaf.bin).toBeUndefined();
    }
    const core = JSON.parse(
      readFileSync(join(repoRoot, 'packages/core/package.json'), 'utf8'),
    ) as Manifest;
    const coreEdges = [
      ...Object.keys(core.dependencies ?? {}),
      ...Object.keys(core.peerDependencies ?? {}),
    ];
    expect(
      coreEdges.filter((name) => name === 'polydeukes' || name.startsWith('@polydeukes/adapter-')),
    ).toEqual([]);
  });

  it('keeps process execution, executable resolution, judgment and telemetry out of adapter leaves', () => {
    for (const adapter of ADAPTERS) {
      const src = join(repoRoot, 'packages', adapter, 'src');
      expect(existsSync(join(src, OLD_ADAPTER_ENTRY_FILE))).toBe(false);
      for (const name of [OLD_ADAPTER_ENTRY, 'resolveUmbrellaBin']) {
        expect(carriers(src, identifier(name)), `${adapter}: ${name}`).toEqual([]);
      }
      expect(carriers(src, /\b(?:function|const|let)\s+runHook\b/g), adapter).toEqual([]);
      expect(
        carriers(
          src,
          /\b(?:from|import)\s*(?:\(\s*)?['"](?:node:child_process|polydeukes(?:\/[^'"]*)?|@polydeukes\/(?:sdk-[^'"]+|adapter-[^'"]+))['"]|\b(?:appendRecord|dispatchCovenants|runCovenantCheck)\s*\(/g,
        ),
        adapter,
      ).toEqual([]);
    }
  });

  it('names the Grok name rewrite nowhere under the umbrella src', () => {
    // The rewrite mapped `search_replace` onto `Edit` and lost the evidence that told a
    // mutation target from a mention; with the Grok delegator on its own adapter, it has
    // no caller.
    const found = carriers(umbrellaSrc, identifier(NAME_REWRITE));
    expect(found, `name-rewrite references in umbrella src:\n${found.join('\n')}`).toEqual([]);
  });
});

describe('host translation stays outside the common runtime and judgment', () => {
  // Path strings (`.claude/hooks`, `.grok/hooks`) are outside this check: the scaffolded
  // default protected list names those directories on purpose, whichever agent is installed.

  it('carries none of the agent tool names as a string literal under src, comments stripped', () => {
    // A tool name in the umbrella is a translation the adapter owns having come back; the
    // umbrella judges the IR's `toolCalls` and never the host's roster.
    const found = AGENT_TOOL_NAMES.flatMap((name) =>
      carriers(umbrellaSrc, quotedLiteral(name)).map((entry) => `${name} in ${entry}`),
    );
    expect(found, `agent tool names in umbrella src:\n${found.join('\n')}`).toEqual([]);
  });

  it('carries none of the agent payload keys as an identifier under src, comments stripped', () => {
    // These are spellings a host envelope carries, so one under src means the umbrella
    // still reads a payload the adapter owns. `toolName` is not
    // among them: the shell judge names a field of its own evidence record that way, and
    // that field's value comes from the IR's `call.name`, never from an envelope.
    const found = AGENT_PAYLOAD_KEYS.flatMap((key) =>
      carriers(umbrellaSrc, identifier(key)).map((entry) => `${key} in ${entry}`),
    );
    expect(found, `agent payload keys in umbrella src:\n${found.join('\n')}`).toEqual([]);
  });
});
