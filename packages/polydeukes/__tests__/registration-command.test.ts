import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { registrationCommand } from '../src/adapter-command.ts';

const VERSION = 'polydeukes@9.9.9';
const DIVERTED = 'polydeukes@0.0.1';
const UNVERSIONED = ['node_modules', 'polydeukes', 'dist', 'bin.js'];
let root: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'pdks-command-')));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** A pnpm package directory, returning its real `dist/bin.js` path. */
function installPackage(version: string): string {
  const dir = join(root, 'node_modules', '.pnpm', version, 'node_modules', 'polydeukes');
  const bin = join(dir, 'dist', 'bin.js');
  mkdirSync(join(dir, 'dist'), { recursive: true });
  writeFileSync(bin, '#!/usr/bin/env node\n');
  return realpathSync(bin);
}

/** Point the unversioned package link at one versioned package directory. */
function linkPackage(version: string): void {
  mkdirSync(join(root, 'node_modules'), { recursive: true });
  symlinkSync(
    join(root, 'node_modules', '.pnpm', version, 'node_modules', 'polydeukes'),
    join(root, 'node_modules', 'polydeukes'),
    'dir',
  );
}

describe('registrationCommand pnpm path selection', () => {
  it('registers the unversioned package path when the running script is the same file', () => {
    // Pinning the versioned .pnpm path breaks the registration on the next version bump;
    // the stable node_modules/polydeukes link is the contract.
    const running = installPackage(VERSION);
    linkPackage(VERSION);
    const command = {
      executable: process.execPath,
      args: [running, 'adapter', 'claude-code', 'init'],
    };

    expect(registrationCommand({ projectRoot: root, command })).toEqual({
      executable: process.execPath,
      args: [join(root, ...UNVERSIONED), 'adapter', 'claude-code', 'init'],
    });
  });

  it('keeps the running script path when the unversioned link points elsewhere', () => {
    // Rewriting to a link that resolves to a different package registers a judge that is
    // not the one this process is running.
    const running = installPackage(VERSION);
    installPackage(DIVERTED);
    linkPackage(DIVERTED);
    const command = { executable: process.execPath, args: [running, 'adapter', 'codex', 'init'] };

    expect(registrationCommand({ projectRoot: root, command })).toEqual(command);
  });

  it('keeps the running script path when no unversioned link exists', () => {
    // A missing link is not a reason to invent a path that does not resolve.
    const running = installPackage(VERSION);
    const command = { executable: process.execPath, args: [running, 'adapter', 'grok', 'init'] };

    expect(registrationCommand({ projectRoot: root, command })).toEqual(command);
  });

  it('keeps the running script path when the unversioned link dangles', () => {
    // A link whose target is missing makes realpath throw; letting that escape init breaks
    // registration before any host is configured, while rewriting to the link invents a
    // path that does not resolve.
    const running = installPackage(VERSION);
    mkdirSync(join(root, 'node_modules'), { recursive: true });
    symlinkSync(
      join(root, 'node_modules', '.pnpm', 'absent', 'node_modules', 'polydeukes'),
      join(root, 'node_modules', 'polydeukes'),
      'dir',
    );
    const command = { executable: process.execPath, args: [running, 'adapter', 'grok', 'init'] };

    expect(registrationCommand({ projectRoot: root, command })).toEqual(command);
  });

  it('keeps a command with no script argument unchanged', () => {
    // A single executable has no running script to compare, so the pnpm rewrite must not
    // touch an argument list it cannot interpret.
    installPackage(VERSION);
    linkPackage(VERSION);
    const command = { executable: join(root, 'bin', 'pdks'), args: [] as string[] };

    expect(registrationCommand({ projectRoot: root, command })).toEqual(command);
  });
});
