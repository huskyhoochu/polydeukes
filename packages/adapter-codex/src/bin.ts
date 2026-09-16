#!/usr/bin/env node
/**
 * `pdks-codex` — this adapter's bin.
 *
 * A thin argv shim over one subcommand. Anything else prints usage and exits 2: an unknown
 * argument must never be read as `init`, because a typo would then install into whatever
 * directory the user happened to be in.
 */

import { initCodex } from './init.ts';

const args = process.argv.slice(2);

if (args.length === 1 && args[0] === 'init') {
  try {
    const { created, skipped } = initCodex({ projectRoot: process.cwd() });
    for (const path of created) {
      process.stdout.write(`created ${path}\n`);
    }
    for (const path of skipped) {
      process.stdout.write(`skipped ${path} (already present)\n`);
    }
    // The host runs a hook only after a human has approved its definition, and no file this
    // installer writes can do that step.
    process.stdout.write(
      'next: run /hooks in Codex and approve the covenant PreToolUse hook — until then it is skipped\n',
    );
    process.exit(0);
  } catch (error) {
    // A precondition failure leaves zero files; the message names what the user has to do
    // before running this again.
    process.stderr.write(
      `pdks-codex init failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(2);
  }
}

process.stderr.write('usage: pdks-codex init\n');
process.exit(2);
