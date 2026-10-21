import { spawn as spawnChild } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import { delimiter, isAbsolute, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

/** The byte-oriented communication requested of a standalone executable. */
export type SpawnSpec = {
  command: string;
  args: string[];
  cwd: string;
  stdin: Uint8Array;
  timeoutMs?: number;
};
/** Captured process status and undecoded output pipes. */
export type SpawnOutcome = { status: number | null; stdout: Uint8Array; stderr: Uint8Array };
/** Injectable process boundary; implementations enforce the supplied communication deadline. */
export type Spawn = (spec: SpawnSpec) => Promise<SpawnOutcome>;

/** Process settings shared by all four verbs. */
export type ProcessSpec = { executable?: string; timeoutMs?: number; spawn?: Spawn };

function resolveExecutable(executable?: string): string {
  if (executable !== undefined) return resolve(executable);
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    if (!isAbsolute(directory)) continue;
    const candidate = join(directory, 'pdks');
    try {
      if (!statSync(candidate).isFile()) continue;
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {}
  }
  throw new Error('no executable pdks in an absolute PATH directory');
}

function defaultSpawn(spec: SpawnSpec): Promise<SpawnOutcome> {
  return new Promise((fulfill, reject) => {
    const child = spawnChild(spec.command, spec.args, {
      cwd: spec.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    let expired = false;
    let exited = false;
    let settled = false;
    const clear = () => {
      if (timer !== undefined) clearTimeout(timer);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      clear();
      reject(error);
    };
    const timeoutError = () =>
      Object.assign(new Error('process communication deadline timed out'), {
        name: 'TimeoutError',
      });
    const expire = () => {
      expired = true;
      child.kill('SIGKILL');
      child.stdin.destroy();
      child.stdout.destroy();
      child.stderr.destroy();
      // A descendant may retain the pipes after its parent has already been reaped.
      if (exited) fail(timeoutError());
    };
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.stdin.on('error', () => {});
    child.on('error', fail);
    child.on('exit', () => {
      exited = true;
      if (expired) fail(timeoutError());
    });
    child.on('close', (status) => {
      if (settled) return;
      if (expired) {
        fail(timeoutError());
        return;
      }
      settled = true;
      clear();
      fulfill({ status, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) });
    });
    child.once('spawn', () => {
      if (spec.timeoutMs !== undefined) {
        const started = performance.now();
        const duration = spec.timeoutMs;
        const arm = () => {
          const remaining = duration - (performance.now() - started);
          if (remaining <= 0) {
            expire();
            return;
          }
          // Node clamps delays above its signed 32-bit limit to one millisecond.
          timer = setTimeout(arm, Math.min(remaining, 2_147_483_647));
        };
        arm();
      }
      if (!expired) child.stdin.end(spec.stdin);
    });
  });
}

/** Resolve once and exchange bytes with the selected executable. */
export async function runProcess(
  spec: ProcessSpec & { root: string; args: string[]; stdin: () => Uint8Array },
): Promise<SpawnOutcome> {
  if (spec.timeoutMs !== undefined && (!Number.isFinite(spec.timeoutMs) || spec.timeoutMs < 0)) {
    throw new Error('timeoutMs must be finite and nonnegative');
  }
  const command = resolveExecutable(spec.executable);
  const stdin = spec.stdin();
  return (spec.spawn ?? defaultSpawn)({
    command,
    args: spec.args,
    cwd: resolve(spec.root),
    stdin,
    timeoutMs: spec.timeoutMs,
  });
}

/** Describe ordinary execution failures, including injected deadline failures. */
export function failureReason(error: unknown): string {
  if (error instanceof Error && error.name === 'TimeoutError')
    return `process deadline timed out: ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}
