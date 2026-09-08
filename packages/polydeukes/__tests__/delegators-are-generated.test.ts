/**
 * This repository's hook delegators are the installers' own output.
 *
 * Every judgment we meet is only the shipped artifact being exercised if the files the
 * hosts spawn are byte-identical to what a consumer's `init` writes. A delegator edited by
 * hand — or left pointing at a path an earlier release published — would make this
 * repository's daily verdicts a private arrangement rather than a measurement of the
 * install units.
 *
 * The comparison runs each installer into a temporary tree and diffs the result against
 * the files on disk here. Reading the constants out of the installer source instead would
 * compare against the template rather than the artifact, and the escapes inside a template
 * literal are exactly where those two drift apart.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { initClaudeCode } from '../../adapter-claude-code/src/init.ts';
import { initGrok } from '../../adapter-grok/src/init.ts';

const repoRoot = resolve(import.meta.dirname, '../../..');
/** The Grok host's matcher: this host's own tool names, never a sibling's. */
const GROK_MATCHER = 'write|search_replace|run_terminal_command';
/** The environment variable the Grok host exports for the project root. */
const GROK_ROOT_VAR = 'GROK_WORKSPACE_ROOT';

let generated: string;

beforeAll(() => {
  generated = mkdtempSync(join(tmpdir(), 'pdks-delegator-oracle-'));
  // The scaffold is the umbrella's, and this repository already carries what it writes.
  // Stubbing it keeps the comparison on the two files these installers own.
  const stub = { resolvePolydeukes: () => 'unused', spawnScaffold: () => ({ status: 0 }) };
  initClaudeCode({ projectRoot: generated, ...stub });
  initGrok({ projectRoot: generated, ...stub });
});

afterAll(() => {
  rmSync(generated, { recursive: true, force: true });
});

/** Read one path from both trees, so a diff names the file rather than a buffer. */
function bothSides(relative: string): { here: string; installed: string } {
  return {
    here: readFileSync(join(repoRoot, relative), 'utf-8'),
    installed: readFileSync(join(generated, relative), 'utf-8'),
  };
}

describe('the delegators this repository is judged by', () => {
  it('carries the Claude delegator its own installer writes', () => {
    const { here, installed } = bothSides('.claude/hooks/covenant-pretooluse.mjs');
    expect(here).toBe(installed);
  });

  it('carries the Grok delegator its own installer writes', () => {
    const { here, installed } = bothSides('.grok/hooks/covenant-pretooluse.mjs');
    expect(here).toBe(installed);
  });

  it('registers the Grok hook on this host’s tool names, pointing at its own delegator', () => {
    // A registration naming a sibling's tool names, or spawning a sibling's delegator, is
    // the arrangement the name rewrite existed to patch: the roster would arrive wrong and
    // the evidence would drop out of the calls that carry it.
    const registration = JSON.parse(
      readFileSync(join(repoRoot, '.grok/hooks/covenant-pretooluse.json'), 'utf-8'),
    ) as { hooks: { PreToolUse: { matcher: string; hooks: { command: string }[] }[] } };
    const entry = registration.hooks.PreToolUse[0];
    expect(entry?.matcher).toBe(GROK_MATCHER);
    expect(entry?.hooks[0]?.command).toContain(GROK_ROOT_VAR);
    expect(entry?.hooks[0]?.command).toContain('.grok/hooks/covenant-pretooluse.mjs');
  });
});
