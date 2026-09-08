import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// The judge lives inside the umbrella dist, so "unbuilt" is one state: no `dist/` at all.
// Both entry points must refuse from that state — the hook delegator through its own
// catch, the bin through the spawn itself. The tree is built in OS tmp from the repo's
// manifest and hook file, so the REAL dist is never touched and no build ever runs here.

const repoRoot = resolve(import.meta.dirname, '../../..');
const HOOK_REL = join('.claude', 'hooks', 'covenant-pretooluse.mjs');
const UMBRELLA_MANIFEST = join(repoRoot, 'packages', 'polydeukes', 'package.json');
/** The delegator's own catch — the only line that can answer when the package will not load. */
const FAIL_CLOSED_MESSAGE = 'covenant hook failed closed';
/** The lefthook line's arguments, so the spawn is the one a commit would make. */
const CHECK_ARGS = ['covenant', 'check', '--diff'];

let treeRoot: string;

beforeEach(() => {
  treeRoot = mkdtempSync(join(tmpdir(), 'pdks-dist-absent-'));
  const installed = join(treeRoot, 'node_modules', 'polydeukes');
  mkdirSync(installed, { recursive: true });
  writeFileSync(join(installed, 'package.json'), readFileSync(UMBRELLA_MANIFEST));
  mkdirSync(join(treeRoot, '.claude', 'hooks'), { recursive: true });
  writeFileSync(join(treeRoot, HOOK_REL), readFileSync(join(repoRoot, HOOK_REL)));
});

afterEach(() => {
  rmSync(treeRoot, { recursive: true, force: true });
});

describe('a tree whose umbrella has no dist', () => {
  // The delegator resolves its adapter from its own location, so the manifest is found
  // and the target is not. A catch that exits 0, or one that lets the rejection escape
  // (node's exit 1, no message), lets every session call through an unbuilt clone — the
  // one state a fail-closed hook exists for.
  it('the hook delegator exits 2 with its fail-closed message', () => {
    const result = spawnSync(process.execPath, [join(treeRoot, HOOK_REL)], {
      cwd: treeRoot,
      input: '{}',
      encoding: 'utf-8',
    });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain(FAIL_CLOSED_MESSAGE);
  });

  // The lefthook line spawns the bin by path; with no dist there is no script, and the
  // spawn's own failure is the refusal. A stub left at `dist/bin.js` that exits 0 would
  // let a commit pass unjudged.
  it('the bin spawn exits non-zero', () => {
    const result = spawnSync(
      process.execPath,
      [join(treeRoot, 'node_modules', 'polydeukes', 'dist', 'bin.js'), ...CHECK_ARGS],
      { cwd: treeRoot, input: '', encoding: 'utf-8' },
    );

    expect(result.status).not.toBe(0);
  });
});
