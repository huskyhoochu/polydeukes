import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

// The umbrella after this repository moved onto the delegators its adapters generate, checked
// as source text, manifest, and root config: the in-process session path is gone, the
// umbrella depends on no adapter, and its sources carry no agent's tool roster or payload
// keys. Source text ONLY — this file must never rebuild dist: a rebuild while the tree is
// mid-change locks the session behind the fail-closed hook.

const repoRoot = resolve(import.meta.dirname, '../../..');
const umbrellaDir = resolve(import.meta.dirname, '..');
const umbrellaSrc = join(umbrellaDir, 'src');
const claudeAdapterSrc = join(repoRoot, 'packages/adapter-claude-code/src');

/** The umbrella files that carried the in-process session path. */
const OLD_SESSION_PATH_FILES = ['claude-code-hook.ts', 'claude-code.ts'];
/** The adapter that path depended on. */
const CLAUDE_ADAPTER = '@polydeukes/adapter-claude-code';
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

/** The dist the Grok delegator loads; a link of the protected chain once it is wired. */
const GROK_DIST = 'packages/adapter-grok/dist';
/** The links already on the chain: the `pdks` bin and the Claude delegator's dist. */
const EXISTING_CHAIN_DISTS = ['packages/polydeukes/dist', 'packages/adapter-claude-code/dist'];

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
};

const manifest = JSON.parse(readFileSync(join(umbrellaDir, 'package.json'), 'utf-8')) as Manifest;

describe('the old in-process session path is gone', () => {
  it('has neither old session file under the umbrella src', () => {
    // A file left behind is a second session entry that still rewrites Grok names and
    // writes rows beside the adapter's spawn.
    const left = OLD_SESSION_PATH_FILES.filter((name) => existsSync(join(umbrellaSrc, name)));
    expect(left).toEqual([]);
  });

  it('depends on no adapter', () => {
    // The adapter takes the umbrella as a peer; the umbrella depending back on the adapter
    // is the cycle the peer declaration exists to avoid, and the old path's only reason.
    expect(manifest.dependencies ?? {}).not.toHaveProperty(CLAUDE_ADAPTER);
  });

  it('names the adapter in-process entry nowhere under the adapter src or its barrel', () => {
    // A barrel entry with no definition fails the build; a definition with no barrel entry
    // is dead code that still writes a row under the old label. Both fail here by name.
    expect(existsSync(join(claudeAdapterSrc, OLD_ADAPTER_ENTRY_FILE))).toBe(false);
    const found = carriers(claudeAdapterSrc, identifier(OLD_ADAPTER_ENTRY));
    expect(found, `old entry references in adapter src:\n${found.join('\n')}`).toEqual([]);
  });

  it('names the Grok name rewrite nowhere under the umbrella src', () => {
    // The rewrite mapped `search_replace` onto `Edit` and lost the evidence that told a
    // mutation target from a mention; with the Grok delegator on its own adapter, it has
    // no caller.
    const found = carriers(umbrellaSrc, identifier(NAME_REWRITE));
    expect(found, `name-rewrite references in umbrella src:\n${found.join('\n')}`).toEqual([]);
  });
});

describe('the umbrella knows no agent tool roster or payload key', () => {
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
    // still reads a payload the adapter translates before spawning it. `toolName` is not
    // among them: the shell judge names a field of its own evidence record that way, and
    // that field's value comes from the IR's `call.name`, never from an envelope.
    const found = AGENT_PAYLOAD_KEYS.flatMap((key) =>
      carriers(umbrellaSrc, identifier(key)).map((entry) => `${key} in ${entry}`),
    );
    expect(found, `agent payload keys in umbrella src:\n${found.join('\n')}`).toEqual([]);
  });
});

describe('the root config protects every dist a delegator loads', () => {
  it('lists the Grok adapter dist beside the umbrella and Claude adapter dists', () => {
    // A delegator and the dist it loads are two links of one chain: an unprotected Grok
    // dist is a rebuild no judgment sees. The two existing links stay — the list is a
    // minimum, and the rewiring only adds.
    const config = parseYaml(readFileSync(join(repoRoot, 'polydeukes.config.yaml'), 'utf-8')) as {
      protectedPaths?: string[];
    };
    expect(config.protectedPaths ?? []).toEqual(
      expect.arrayContaining([GROK_DIST, ...EXISTING_CHAIN_DISTS]),
    );
  });
});
