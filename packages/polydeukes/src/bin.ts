#!/usr/bin/env node
/**
 * `pdks` / `polydeukes` — the umbrella bin.
 *
 * A thin argv shim: each subcommand is matched by direct comparison against a finite
 * table. Anything else prints usage and exits 2 — an unknown argument must never pass
 * silently (fail-closed, the same posture as an unjudgeable payload).
 *
 * `covenant check` reads its observation from stdin and nothing else: the IR JSON by
 * default, a unified diff under `--diff`. No other file descriptor is opened, so the
 * process never asks a human anything.
 */

import { readFileSync, readSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Read stdin to EOF. `readFileSync(0)` returns only what the first read delivers, so a
 * diff larger than the pipe buffer would arrive truncated and translate to a partial
 * observation; this loops until a read answers zero bytes.
 */
function readStdin(): string {
  const chunks: Buffer[] = [];
  const buffer = Buffer.alloc(65536);
  for (;;) {
    let bytes: number;
    try {
      bytes = readSync(0, buffer, 0, buffer.length, null);
    } catch (error) {
      const { code } = error as NodeJS.ErrnoException;
      // A pipe with no writer left answers EOF this way on some platforms; EAGAIN is a
      // non-blocking fd with nothing ready yet, which is not the end of the input.
      if (code === 'EOF') break;
      if (code === 'EAGAIN') continue;
      throw error;
    }
    if (bytes === 0) break;
    chunks.push(Buffer.from(buffer.subarray(0, bytes)));
  }
  return Buffer.concat(chunks).toString('utf-8');
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

if (args.length === 1 && args[0] === 'init') {
  try {
    // Imported inside the try, not above it: ESM imports are eager, so the scaffold stays
    // off `covenant check`'s load path, which a pre-commit hook spawns on every commit. A
    // rejected import outside the try would reach node's unhandled-rejection exit 1, the
    // exact crash this bin refuses to make.
    const { scaffoldProject } = await import('./scaffold-project.ts');
    const { created, skipped } = scaffoldProject(process.cwd());
    for (const path of created) {
      process.stdout.write(`created ${path}\n`);
    }
    for (const path of skipped) {
      process.stdout.write(`skipped ${path} (already present)\n`);
    }
    process.exit(0);
  } catch (error) {
    // A precondition failure leaves zero files; the message names what the user has to do
    // before running this again.
    process.stderr.write(
      `pdks init failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(2);
  }
}

if (args.length === 2 && args[0] === 'init' && args[1] === 'grok') {
  try {
    const { initGrok } = await import('./init-grok.ts');
    const { created, skipped } = initGrok({ projectRoot: process.cwd() });
    for (const path of created) {
      process.stdout.write(`created ${path}\n`);
    }
    for (const path of skipped) {
      process.stdout.write(`skipped ${path} (already present)\n`);
    }
    process.exit(0);
  } catch (error) {
    process.stderr.write(
      `pdks init grok failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(2);
  }
}

if (args[0] === 'docs') {
  try {
    // Imported inside the try for the same reason `init` is: the query core and the
    // markdown behind it have no business on `covenant check`'s load path.
    const { runDocs } = await import('./docs-library.ts');
    // The bundle ships beside this file, so the docs root comes from the module's own
    // location — never from the working directory, which is whatever shell invoked us.
    const docsRoot = join(dirname(fileURLToPath(import.meta.url)), 'docs');
    const manifest = JSON.parse(readFileSync(join(docsRoot, '../../package.json'), 'utf8'));
    if (typeof manifest.version !== 'string') throw new Error('missing package version');
    const { text } = runDocs({ docsRoot, args: args.slice(1), version: manifest.version });
    await emitAndExit(text);
  } catch (error) {
    // stdout stays at zero bytes on this path: what cannot be answered is never answered
    // halfway.
    process.stderr.write(`pdks docs: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(2);
  }
}

if (args.length === 1 && args[0] === 'explain') {
  try {
    // Imported inside the try for the same reason `docs` is: the renderer pulls in both
    // composition roots, and neither belongs on `covenant check`'s load path.
    const { explain } = await import('./explain.ts');
    const { text } = await explain({ repoRoot: process.cwd() });
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
 * Read the `covenant check` flags, or null for any argv outside the finite table: `--diff`
 * at most once, `--enforce` at most once with `advise` or `block`, in either order, and
 * nothing else.
 */
function parseCheckFlags(
  flags: string[],
): { diffMode: boolean; enforce?: 'advise' | 'block' } | null {
  let diffMode = false;
  let enforce: 'advise' | 'block' | undefined;
  for (let i = 0; i < flags.length; i += 1) {
    const flag = flags[i];
    if (flag === '--diff' && !diffMode) {
      diffMode = true;
      continue;
    }
    if (flag === '--enforce' && enforce === undefined) {
      const level = flags[i + 1];
      if (level !== 'advise' && level !== 'block') return null;
      enforce = level;
      i += 1;
      continue;
    }
    return null;
  }
  return { diffMode, enforce };
}

const check = args[0] === 'covenant' && args[1] === 'check' ? parseCheckFlags(args.slice(2)) : null;

if (check === null) {
  process.stderr.write(
    'usage: pdks covenant check [--diff] [--enforce advise|block] | pdks explain | pdks init | pdks init grok | pdks docs [topic | search <query> | show <document-id>]\n',
  );
  process.exit(2);
}
const { diffMode, enforce } = check;

try {
  // Loaded here rather than at the top of the file. This runner statically pulls in the
  // core and the judge, so a top-level import made every subcommand wait on both
  // resolving — and `docs` is the one that has to answer in a tree where they do not,
  // since a package installed but never built is exactly the state `pdks docs install`
  // is asked about. The catch below already answers for whatever this import cannot do,
  // at the same exit 2 it answers everything else with.
  const { runCovenantCheck } = await import('./covenant-check.ts');
  const { covenantInputFromUnifiedDiff } = await import('./diff-ir.ts');
  const text = readStdin();
  const { exitCode } = await runCovenantCheck({
    repoRoot: process.cwd(),
    // A thunk, not a value: the runner settles the telemetry path before calling it, so a
    // translation or parse failure lands as the same one blocked row every other
    // fail-closed branch leaves.
    input: () => (diffMode ? covenantInputFromUnifiedDiff({ text }) : (JSON.parse(text) as never)),
    ...(enforce !== undefined && { enforce }),
  });
  process.exit(exitCode);
} catch (error) {
  // Any failure the runner did not already translate is unjudgeable — block, never
  // crash into node's exit 1.
  process.stderr.write(
    `covenant check failed closed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(2);
}
