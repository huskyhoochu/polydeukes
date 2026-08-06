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
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
    // A reader that goes away mid-write (a killed pager, `grep -q`, a caller closing its
    // capture) makes the stream emit `error` — an EventEmitter event, so it fires outside
    // the frame this try guards and would reach node's default handler: exit 1 and a raw
    // stack trace, the one disposition this bin never produces. The docs answer is not a
    // verdict, so a reader that stopped listening is not something to report; end at the
    // same code an unanswerable query uses.
    process.stdout.on('error', () => process.exit(2));
    // stdout is a pipe whenever this is captured or redirected, and a piped write is
    // asynchronous — exiting on the next line would discard whatever is still buffered.
    // The whole answer IS the deliverable here (a truncated document is one an agent
    // quotes onward as if complete), so the exit waits for the flush. Awaiting rather
    // than exiting from the callback also keeps this branch from falling through into
    // the covenant runner below while the write drains.
    await new Promise<void>((settle) => {
      process.stdout.write(text, () => settle());
    });
    process.exit(0);
  } catch (error) {
    // stdout stays at zero bytes on this path (DOCS-02 §3-b): what cannot be answered is
    // never answered halfway.
    process.stderr.write(`pdks docs: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(2);
  }
}

if (args.length !== 2 || args[0] !== 'covenant' || args[1] !== 'check') {
  process.stderr.write('usage: pdks covenant check | pdks init claude-code | pdks docs [topic]\n');
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
