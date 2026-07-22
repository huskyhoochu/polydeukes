#!/usr/bin/env node
/**
 * `pdks` / `polydeukes` — the umbrella bin (ADAPTER-git §4.3).
 *
 * A thin argv shim over {@link runCovenantCheck}: `covenant check` is the ONLY
 * recognized invocation (the wider CLI skeleton is a post-release increment). Anything
 * else prints usage and exits 2 — an unknown argument must never pass silently
 * (fail-closed, the same posture as an unjudgeable payload).
 *
 * The real TTY is wired HERE, not in the library: the runner receives an injectable
 * seam, and this shim binds it to /dev/tty. When /dev/tty cannot be opened (git run by
 * CI or by an agent-spawned shell — no controlling terminal), the seam stays absent and
 * the valve is structurally unreachable (AC-3 human-only arming).
 */

import { closeSync, openSync, readSync, writeSync } from 'node:fs';
import { runCovenantCheck } from './covenant-check.js';

/** Bind the TTY prompt seam to /dev/tty, or undefined when no terminal exists. */
function openTtyPrompt(): (() => string | null) | undefined {
  let fd: number;
  try {
    fd = openSync('/dev/tty', 'r+');
  } catch {
    return undefined;
  }
  return () => {
    try {
      writeSync(
        fd,
        'covenant: a staged change matches a protected surface.\n' +
          'type the waiver token to bypass this commit once (enter to refuse): ',
      );
      const buffer = Buffer.alloc(4096);
      const bytes = readSync(fd, buffer, 0, buffer.length, null);
      return buffer
        .subarray(0, Math.max(bytes, 0))
        .toString('utf-8')
        .replace(/\r?\n$/, '');
    } catch {
      return null;
    } finally {
      closeSync(fd);
    }
  };
}

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== 'covenant' || args[1] !== 'check') {
  process.stderr.write('usage: pdks covenant check\n');
  process.exit(2);
}

try {
  const { exitCode } = await runCovenantCheck({
    repoRoot: process.cwd(),
    ttyPrompt: openTtyPrompt(),
  });
  process.exit(exitCode);
} catch (error) {
  // Any failure the runner did not already translate is unjudgeable — block, never
  // crash into node's exit 1 (the session hook's catch-all posture, AC-7).
  process.stderr.write(
    `covenant check failed closed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(2);
}
