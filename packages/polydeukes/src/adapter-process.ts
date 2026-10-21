import { spawn } from 'node:child_process';

/** One byte exchange with the current pdks executable. */
export type RunAdapterProcessSpec = {
  command: string;
  args: readonly string[];
  cwd: string;
  stdin: Uint8Array;
  timeoutMs: number;
};

/** Actual process status and captured bytes, with a reason when communication failed. */
export type RunAdapterProcessOutcome = {
  status: number | null;
  stdout: Uint8Array;
  stderr: Uint8Array;
  reason?: string;
};

/** Bound stdin delivery, process lifetime, and both output pipes by one deadline. */
export function runAdapterProcess(spec: RunAdapterProcessSpec): Promise<RunAdapterProcessOutcome> {
  return new Promise((resolve) => {
    const child = spawn(spec.command, spec.args, {
      cwd: spec.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let status: number | null = null;
    let exited = false;
    let expired = false;
    let settled = false;
    let reason: string | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        status,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
        ...(reason && { reason }),
      });
    };
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.stdin.on('error', () => {});
    child.on('error', (error) => {
      reason = error.message;
      finish();
    });
    child.on('exit', (code, signal) => {
      exited = true;
      status = code;
      if (signal && reason === undefined) reason = `process terminated by ${signal}`;
      if (expired) finish();
    });
    child.on('close', finish);
    child.once('spawn', () => {
      timer = setTimeout(() => {
        expired = true;
        reason = 'process communication deadline timed out';
        child.kill('SIGKILL');
        child.stdin.destroy();
        child.stdout.destroy();
        child.stderr.destroy();
        // An exited parent can leave its pipes held open by descendants.
        if (exited) finish();
      }, spec.timeoutMs);
      child.stdin.end(spec.stdin);
    });
  });
}
