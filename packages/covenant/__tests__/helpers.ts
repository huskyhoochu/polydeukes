/**
 * Shared covenant test helpers (COVENANT-10 REVIEW — the COVENANT-06 §8 carry-over's
 * trigger condition fired: a third file duplicated all three). Not a test file itself.
 */

import { readFileSync } from 'node:fs';
import type { CovenantInput } from '@polydeukes/core';

/** A minimal CovenantInput with one tool call carrying the given args. */
export function inputWithArgs(args: Record<string, unknown>): CovenantInput {
  return {
    toolCalls: [{ name: 'some-tool', args }],
    subagentSpawns: [],
    userMessages: [],
  };
}

/**
 * Node `-e` argv for a body that copies its stdin to `outFile` and exits with
 * `exitCode` — proves the body spawned and received the verbatim payload (a missing
 * outFile means the body never ran).
 */
export function echoToFileScript(outFile: string, exitCode = 0): string[] {
  const script = `
    const fs = require('node:fs');
    const chunks = [];
    process.stdin.on('data', (c) => chunks.push(c));
    process.stdin.on('end', () => {
      fs.writeFileSync(process.argv[1], Buffer.concat(chunks).toString('utf-8'));
      process.exit(${exitCode});
    });
  `;
  return ['-e', script, outFile];
}

/** Read the telemetry log and return its non-empty lines. */
export function readTelemetryLines(path: string): string[] {
  return readFileSync(path, 'utf-8')
    .split('\n')
    .filter((l) => l.length > 0);
}
