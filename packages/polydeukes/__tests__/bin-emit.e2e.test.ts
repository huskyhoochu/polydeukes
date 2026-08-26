// The shared emit-and-exit helper behind `docs` and `explain` on the built bin: a reader
// that closes before the text is drained (`| head -c 1`) must land exit 2 with no stack
// trace, for both subcommands alike.
import { type ChildProcess, execSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { writeConfigAt } from './helpers';

const repoRoot = resolve(import.meta.dirname, '../../..');
const BIN = resolve(import.meta.dirname, '../dist/bin.js');

/** A Node stack frame on stderr: `    at fn (file.js:12:3)`. */
const STACK_FRAME = /at .*\.js:\d+/;

let projectRoot: string;
let logDir: string;

beforeAll(() => {
  execSync('pnpm turbo run build', { cwd: repoRoot, stdio: 'pipe' });
}, 120_000);

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'pdks-bin-emit-e2e-'));
  logDir = mkdtempSync(join(tmpdir(), 'pdks-bin-emit-e2e-log-'));
  writeConfigAt(projectRoot, join(logDir, 'roi.log'), {});
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
  rmSync(logDir, { recursive: true, force: true });
});

type ClosedReaderResult = { exitCode: number | null; stderr: string; firstByteSeen: boolean };

/**
 * Spawn the bin, take ONE byte of stdout, then destroy the read side so the next write
 * meets EPIPE — the `| head -c 1` shape without a shell (sh has no PIPESTATUS to report
 * the bin's own exit).
 */
function spawnWithClosedReader(...args: string[]): Promise<ClosedReaderResult> {
  return new Promise((resolvePromise, reject) => {
    const child: ChildProcess = spawn(process.execPath, [BIN, ...args], {
      cwd: projectRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    let firstByteSeen = false;
    child.stderr?.setEncoding('utf-8');
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.stdout?.once('data', () => {
      firstByteSeen = true;
      child.stdout?.destroy();
    });
    child.on('error', reject);
    child.on('close', (exitCode) => resolvePromise({ exitCode, stderr, firstByteSeen }));
  });
}

describe('pdks docs / explain — a reader that closes after one byte', () => {
  it.each([
    ['docs', ['docs']],
    ['explain', ['explain']],
  ])('%s exits 0 or 2 and prints no stack trace when stdout is destroyed mid-write', async (_name, args) => {
    // Without the `stdout.on('error')` handler, EPIPE surfaces as an uncaught exception —
    // exit 1 with a stack trace. Whether the closed reader is met before the text drains
    // depends on the pipe buffer, so the exit is pinned to the two documented outcomes
    // (0 = drained, 2 = write error) and never 1; the trace absence is exact.
    const result = await spawnWithClosedReader(...args);

    expect(result.firstByteSeen).toBe(true);
    expect([0, 2]).toContain(result.exitCode);
    expect(result.stderr).not.toMatch(STACK_FRAME);
  });
});
