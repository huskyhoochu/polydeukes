import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runAdapterProcess } from '../src/adapter-process.ts';

let cwd: string;
beforeEach(() => {
  cwd = realpathSync(mkdtempSync(join(tmpdir(), 'pdks-adapter-process-')));
});
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});
function run(source: string, stdin = new Uint8Array(), timeoutMs = 3000) {
  return runAdapterProcess({
    command: process.execPath,
    args: ['-e', source],
    cwd,
    stdin,
    timeoutMs,
  });
}
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe('adapter process byte and completion contract', () => {
  it.each([0, 2, 7])(
    'preserves actual child status %s and captures stdout separately',
    async (status) => {
      // Collapsing an unexpected status to allow would conceal a broken judge.
      const result = await run(
        `process.stdout.write('private output');process.stderr.write('diagnostic');process.exitCode=${status}`,
      );
      expect(result.status).toBe(status);
      expect(text(result.stdout)).toBe('private output');
      expect(text(result.stderr)).toBe('diagnostic');
      expect(result.reason).toBeUndefined();
    },
  );
  it('transports non-UTF-8 bytes without replacement on both output pipes', async () => {
    // Text encoding at the transport seam silently changes the child\'s evidence.
    const bytes = new Uint8Array([0, 255, 128, 10]);
    const result = await run(
      "process.stdin.on('data',b=>{process.stdout.write(b);process.stderr.write(b)})",
      bytes,
    );
    expect(result.status).toBe(0);
    expect(new Uint8Array(result.stdout)).toEqual(bytes);
    expect(new Uint8Array(result.stderr)).toEqual(bytes);
  });
  it('drains concurrent large output while delivering a large stdin', async () => {
    // Sequential pipe handling deadlocks when either output fills before input drains.
    const length = 512 * 1024;
    const result = await run(
      `process.stdout.write(Buffer.alloc(${length},65));process.stderr.write(Buffer.alloc(${length},66));let n=0;process.stdin.on('data',b=>n+=b.length);process.stdin.on('end',()=>{if(n!==${length})process.exitCode=7})`,
      new Uint8Array(length).fill(67),
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toHaveLength(length);
    expect(result.stderr).toHaveLength(length);
    expect(result.stdout[0]).toBe(65);
    expect(result.stderr[length - 1]).toBe(66);
  });
  it('reports spawn failure without inventing a successful status', async () => {
    // A missing judge has written no verdict and cannot be treated as status zero.
    const result = await runAdapterProcess({
      command: join(cwd, 'absent'),
      args: [],
      cwd,
      stdin: new Uint8Array(),
      timeoutMs: 200,
    });
    expect(result.status).toBeNull();
    expect(result.reason).toEqual(expect.any(String));
  });
  it('reports signal death as unavailable instead of a covenant violation', async () => {
    // A killed child did not answer with status two.
    const result = await run("process.kill(process.pid,'SIGTERM')");
    expect(result.status).toBeNull();
    expect(result.reason).toEqual(expect.any(String));
  });
  it.each([
    ['sleeping child', 'setTimeout(()=>{},3000)', 0],
    ['undrained stdin', 'process.stdin.pause();setTimeout(()=>{},3000)', 2 * 1024 * 1024],
    [
      'large simultaneous output',
      'const b=Buffer.alloc(65536);setInterval(()=>{process.stdout.write(b);process.stderr.write(b)},10)',
      0,
    ],
    [
      'descendant-held pipes',
      "require('node:child_process').spawn(process.execPath,['-e','setTimeout(()=>{},1800)'],{stdio:['ignore',1,2]});process.exit(0)",
      0,
    ],
  ])(
    'bounds communication with %s',
    async (_name, source, size) => {
      // Waiting only for exit or stdin completion leaves these concrete pipe states unbounded.
      const started = performance.now();
      const result = await run(source, new Uint8Array(size), 200);
      expect(result.reason).toMatch(/timed?\s*out|deadline/i);
      expect(performance.now() - started).toBeLessThan(5000);
    },
    6000,
  );
});
