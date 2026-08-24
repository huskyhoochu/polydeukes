#!/usr/bin/env node
/**
 * `pdks` / `polydeukes` — the umbrella bin (ADAPTER-git §4.3).
 *
 * A thin argv shim: four subcommands, each matched by direct comparison against a finite
 * table. Anything else prints usage and exits 2 — an unknown argument must never pass
 * silently (fail-closed, the same posture as an unjudgeable payload).
 *
 * The real TTY is wired HERE, not in the library: the runner receives an injectable
 * seam, and this shim binds it to /dev/tty. When /dev/tty cannot be opened (git run by
 * CI or by an agent-spawned shell — no controlling terminal), the seam stays absent and
 * the valve is structurally unreachable (AC-3 human-only arming).
 */

import { closeSync, openSync, readSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// Type-only, so the runner itself stays off this file's load path (the lazy import below
// is what actually pulls it in).
import type { CheckDomain } from './covenant-check.js';

/**
 * Bind the TTY prompt seam to /dev/tty, or undefined when no terminal exists. The runner
 * composes the prompt text (it is the side that knows what broke); this shim only writes
 * it and reads the line back.
 */
function openTtyPrompt(): ((prompt: string) => string | null) | undefined {
  let fd: number;
  try {
    fd = openSync('/dev/tty', 'r+');
  } catch {
    return undefined;
  }
  return (prompt) => {
    try {
      writeSync(fd, prompt);
      const buffer = Buffer.alloc(4096);
      const bytes = readSync(fd, buffer, 0, buffer.length, null);
      return buffer
        .subarray(0, Math.max(bytes, 0))
        .toString('utf-8')
        .replace(/\r?\n$/, '');
    } catch {
      return null;
    } finally {
      try {
        closeSync(fd);
      } catch {
        // A second consultation would land on an already-closed fd; an EBADF thrown
        // from this finally would override the `return null` above and escape the
        // seam (PR #41 review). The valve caches its verdict, so this is defensive.
      }
    }
  };
}

/**
 * Write `text` to stdout and end the process — exit 0 once the write drains, exit 2 when
 * the reader went away. A piped write is asynchronous, so the exit waits for the flush; a
 * reader that closes mid-write makes the stream emit `error` outside any try frame, and
 * this handler is what keeps that off node's default exit 1 with a stack trace.
 */
async function emitAndExit(text: string): Promise<never> {
  process.stdout.on('error', () => process.exit(2));
  await new Promise<void>((settle) => {
    process.stdout.write(text, () => settle());
  });
  process.exit(0);
}

const args = process.argv.slice(2);

if (args.length === 2 && args[0] === 'init' && args[1] === 'claude-code') {
  try {
    // Imported inside the try, not above it: ESM imports are eager, so the installer stays
    // off `covenant check`'s load path (lefthook spawns that on every commit and it must not
    // pull the session adapter in — PR #46 review). A rejected import outside the try would
    // reach node's unhandled-rejection exit 1, the exact crash this bin refuses to make.
    const { initClaudeCode } = await import('./init-claude-code.js');
    const { created, skipped } = initClaudeCode({ projectRoot: process.cwd() });
    for (const path of created) {
      process.stdout.write(`created ${path}\n`);
    }
    for (const path of skipped) {
      process.stdout.write(`skipped ${path} (already present)\n`);
    }
    process.exit(0);
  } catch (error) {
    // A precondition failure leaves zero files (DIST-02 §5-d invariant 2); the message
    // names what the user has to do before running this again.
    process.stderr.write(
      `pdks init claude-code failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(2);
  }
}

if (args[0] === 'docs' && args.length <= 2) {
  try {
    // Imported inside the try for the same reason `init` is: the query core and the
    // markdown behind it have no business on `covenant check`'s load path, which lefthook
    // spawns on every commit.
    const { queryDocs } = await import('./docs-query.js');
    // The bundle ships beside this file, so the docs root comes from the module's own
    // location — never from the working directory, which is whatever shell invoked us.
    const docsRoot = join(dirname(fileURLToPath(import.meta.url)), 'docs');
    const { text } = queryDocs({ docsRoot, topic: args[1] });
    await emitAndExit(text);
  } catch (error) {
    // stdout stays at zero bytes on this path (DOCS-02 §3-b): what cannot be answered is
    // never answered halfway.
    process.stderr.write(`pdks docs: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(2);
  }
}

if (args.length === 1 && args[0] === 'explain') {
  try {
    // Imported inside the try for the same reason `docs` is: the renderer pulls in both
    // composition roots, and neither belongs on `covenant check`'s load path, which
    // lefthook spawns on every commit.
    const { explain } = await import('./explain.js');
    const { text } = explain({ repoRoot: process.cwd() });
    await emitAndExit(text);
  } catch (error) {
    // stdout stays at zero bytes on this path: what cannot be answered is never answered
    // halfway.
    process.stderr.write(
      `pdks explain: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(2);
  }
}

/**
 * Read the `covenant check` flags as a domain, or null when the argv is not one of the
 * three recognized forms. Direct comparison over a finite table (DIST-02 §8): no flags is
 * the staged diff, `--worktree` is the working tree, and `--range <base>..<head>` (or
 * `...` for the merge-base reading) is a ref range.
 */
function parseCheckDomain(flags: string[]): CheckDomain | null {
  if (flags.length === 0) return { kind: 'staged' };
  if (flags.length === 1 && flags[0] === '--worktree') return { kind: 'worktree' };
  if (flags.length !== 2 || flags[0] !== '--range') return null;

  const range = flags[1] as string;
  if (range.startsWith('--')) return null;
  const mergeBase = range.includes('...');
  const separator = mergeBase ? '...' : '..';
  const at = range.indexOf(separator);
  if (at === -1) return null;
  const base = range.slice(0, at);
  const head = range.slice(at + separator.length);
  if (base === '' || head === '') return null;
  return { kind: 'range', base, head, ...(mergeBase && { ancestry: 'merge-base' as const }) };
}

const domain =
  args[0] === 'covenant' && args[1] === 'check' ? parseCheckDomain(args.slice(2)) : null;

if (domain === null) {
  process.stderr.write(
    'usage: pdks covenant check [--worktree | --range <base>..<head>] | pdks explain | pdks init claude-code | pdks docs [topic]\n',
  );
  process.exit(2);
}

try {
  // Loaded here rather than at the top of the file. This runner statically pulls in the
  // git adapter, the core, and the judge, so a top-level import made every subcommand
  // wait on all three resolving — and `docs` is the one that has to answer in a tree
  // where they do not, since a package installed but never built is exactly the state
  // `pdks docs install` is asked about. The catch below already answers for whatever
  // this import cannot do, at the same exit 2 it answers everything else with.
  const { runCovenantCheck } = await import('./covenant-check.js');
  const { exitCode } = await runCovenantCheck({
    repoRoot: process.cwd(),
    ttyPrompt: openTtyPrompt(),
    domain,
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
