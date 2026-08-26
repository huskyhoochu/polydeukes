import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The core is agent-, tool-, and language-neutral: concrete tool names, vendor names,
// agent payload field names, and test-runner names are VALUES an adapter or the config
// supplies, never part of the core's own vocabulary. This file enforces that as a grep
// over the source tree.
//
// The tool-call query seam is where the invariant is easiest to breach: the core may ask
// which calls happened and whether one succeeded, but only the QUERY vocabulary crosses
// — never the literals an agent spells its answers in.
//
// Scope is `src/` only, by design: `__tests__/` legitimately carries these literals (this
// very file does) and imports vitest. That split is why this package's vitest.config.ts
// keeps tests outside src/.

const SRC_DIR = fileURLToPath(new URL('../src', import.meta.url));

/**
 * Each banned literal as a matcher. Word boundaries and case sensitivity are
 * deliberate, not decorative:
 *
 * - `Edit`/`Write`/`MultiEdit` are AGENT TOOL NAMES, so they are matched
 *   case-sensitively with word boundaries. Without both, ordinary vocabulary
 *   would false-positive: `appendFileSync`/"write" in prose, "edit" in a comment
 *   about edits. The core describes edits constantly; it must never name the tool.
 * - `claude`/`anthropic` are matched case-insensitively — a vendor name is banned
 *   in every casing. The package's own `@polydeukes/*` scope contains neither.
 * - snake_case JSONL field names need no boundary: they cannot occur by accident.
 * - `go test` carries a space, so it is bounded to avoid matching e.g. "go tests".
 */
const BANNED_LITERALS: readonly { label: string; pattern: RegExp }[] = [
  // agent payload / JSONL field names
  { label: 'tool_use', pattern: /tool_use/ },
  { label: 'tool_result', pattern: /tool_result/ },
  { label: 'is_error', pattern: /is_error/ },
  { label: 'subagent_type', pattern: /subagent_type/ },
  { label: 'tool_name', pattern: /tool_name/ },
  { label: 'tool_input', pattern: /tool_input/ },
  { label: 'transcript_path', pattern: /transcript_path/ },
  { label: 'session_id', pattern: /session_id/ },
  { label: 'parentUuid', pattern: /parentUuid/ },
  // vendor names
  { label: 'claude', pattern: /claude/i },
  { label: 'anthropic', pattern: /anthropic/i },
  // agent tool names
  { label: 'Edit', pattern: /\bEdit\b/ },
  { label: 'Write', pattern: /\bWrite\b/ },
  { label: 'MultiEdit', pattern: /\bMultiEdit\b/ },
  { label: 'NotebookEdit', pattern: /\bNotebookEdit\b/ },
  { label: 'Bash', pattern: /\bBash\b/ },
  // language test-runner literals
  { label: 'vitest', pattern: /\bvitest\b/i },
  { label: 'pytest', pattern: /\bpytest\b/i },
  { label: 'go test', pattern: /\bgo test\b/i },
];

/** Every .ts file under the core's source tree, recursively. */
function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sourceFiles(path));
    else if (entry.name.endsWith('.ts')) found.push(path);
  }
  return found;
}

/** `file:line: text` for every line matching the pattern, across the whole source tree. */
function findViolations(pattern: RegExp): string[] {
  const violations: string[] = [];
  for (const path of sourceFiles(SRC_DIR)) {
    const lines = readFileSync(path, 'utf-8').split('\n');
    lines.forEach((line, index) => {
      if (pattern.test(line)) violations.push(`${path}:${index + 1}: ${line.trim()}`);
    });
  }
  return violations;
}

describe('core source carries no agent, tool, or language literals (grep gate)', () => {
  it('scans a non-empty source tree — the gate cannot pass vacuously', () => {
    // A gate that silently scans zero files always passes. If the source directory moves
    // or the recursive walk drops every file, every assertion below becomes a no-op fence.
    expect(sourceFiles(SRC_DIR).length).toBeGreaterThan(0);
  });

  it.each(
    BANNED_LITERALS.map((entry) => [entry.label, entry.pattern] as const),
  )('has zero occurrences of %s', (_label, pattern) => {
    // Asserting against the violation list rather than a count makes the failure message
    // name file, line, and offending text, so a leak is located and not merely reported.
    expect(findViolations(pattern)).toEqual([]);
  });
});
