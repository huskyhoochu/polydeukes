import type { CovenantInput, DisciplineEntry } from '@polydeukes/core';
import { describe, expect, it } from 'vitest';
// CONFIG-09 §4.1 / AC-1 — the command family judges the UNION of two units: each line
// (split on /\r?\n/, so a '^' anchor means "start of a line" instead of silently meaning
// "start of the whole string") and the whole string (so a pattern spanning a line
// boundary keeps every match it had before the line unit existed). Both judgment paths
// (judgeDiscipline and the compiled matches closure) must share that unit — if they
// diverge, a violation never spawns or a spawn carries no violation.
import {
  type CompileDisciplinesSpec,
  compileDisciplineRegistrations,
  type DisciplineJudgeOptions,
  judgeDiscipline,
} from '../src/discipline.ts';
import type { CovenantRegistration } from '../src/dispatch.ts';

// ---------------------------------------------------------------------------
// Fixtures. The anchored pattern is live-shaped (the root config's pnpm-only
// spelling): a forbidden spawn matches only at a command position — start of a
// line or after ; & | ( — so a mid-line mention like `echo yarn` stays clean.
// ---------------------------------------------------------------------------

const ROOT = '/repo';

const judgeOpts: DisciplineJudgeOptions = {
  rootDir: ROOT,
  shellTools: ['Bash'],
  commandArgs: ['command'],
};

const anchoredEntry: DisciplineEntry = {
  id: 'anchored-spawn',
  forbidCommand: '(^|[;&|(]\\s*)yarn\\b',
};

// A pattern whose only possible match STRADDLES a line boundary (\s+ has to consume
// the \n) — only the whole-string half of the union can see it.
const straddlingEntry: DisciplineEntry = {
  id: 'straddling',
  forbidCommand: 'setup\\s+yarn',
};

/** Build a CovenantInput carrying a single tool call. */
function inputWithToolCall(name: string, args: Record<string, unknown>): CovenantInput {
  return { toolCalls: [{ name, args }], subagentSpawns: [], userMessages: [] };
}

/** Compile a single entry into its registration (same assembly values as judgeOpts). */
function compileOne(entry: DisciplineEntry): CovenantRegistration {
  const spec: CompileDisciplinesSpec = {
    disciplines: [entry],
    rootDir: ROOT,
    bodyCommand: '/usr/bin/node',
    bodyModulePath: '/repo/discipline-body.js',
    shellTools: ['Bash'],
    commandArgs: ['command'],
  };
  const [reg] = compileDisciplineRegistrations(spec);
  return reg;
}

describe('judgeDiscipline — command family judges per line (CONFIG-09 §4.1)', () => {
  it('breaks when the ^-anchored pattern matches on the SECOND line of a multi-line command', () => {
    // P0 the disarmed-anchor trap (config-and-schema): tested against the whole string,
    // '^' only ever anchors at position 0, so a second-line violation passes with nothing
    // failing loudly. Mutation caught: judging the joined string instead of each line.
    const input = inputWithToolCall('Bash', { command: 'echo setup\nyarn install' });

    const verdict = judgeDiscipline(anchoredEntry, input, judgeOpts);

    expect(verdict.upheld).toBe(false);
    if (verdict.upheld === false) {
      expect(verdict.reason).toContain('anchored-spawn');
    }
  });

  it('still breaks a single-line violation at the start of the string', () => {
    // P0 regression net for the split: the one-line case is the shape every live entry
    // has today. Mutation caught: a line split that drops the first (or only) line, or
    // off-by-one line indexing.
    const input = inputWithToolCall('Bash', { command: 'yarn install' });

    expect(judgeDiscipline(anchoredEntry, input, judgeOpts).upheld).toBe(false);
  });

  it('still breaks a pattern that spans the line boundary (whole-string half of the union)', () => {
    // P0 widening-only invariant (§6): every match the whole-string unit had before the
    // line unit existed is preserved — the live `git branch\b.*\s-D\b` entry relies on
    // `\s` consuming a continuation newline (review F0). Mutation caught: dropping the
    // whole-string half and judging lines only.
    const input = inputWithToolCall('Bash', { command: 'echo setup\nyarn install' });

    const verdict = judgeDiscipline(straddlingEntry, input, judgeOpts);

    expect(verdict.upheld).toBe(false);
    if (verdict.upheld === false) {
      expect(verdict.reason).toContain('straddling');
    }
  });

  it('breaks when the violation sits on the THIRD line (every line is visited)', () => {
    // Coverage-gap fixture: a two-line fixture alone lets a mutant that only inspects
    // lines[0] and lines[1] survive. Mutation caught: partial traversal of the split.
    const input = inputWithToolCall('Bash', { command: 'echo one\necho two\nyarn install' });

    expect(judgeDiscipline(anchoredEntry, input, judgeOpts).upheld).toBe(false);
  });

  it('strips the \\r of a CRLF line ending before judging the line', () => {
    // Coverage-gap fixture (documented-trap mirror): split on '\n' alone leaves a
    // trailing \r on every line, silently disarming an end-of-line-sensitive pattern.
    // The contract is split on /\r?\n/. Mutation caught: split('\n').
    const crlfEndEntry: DisciplineEntry = { id: 'crlf-end', forbidCommand: 'install$' };
    const input = inputWithToolCall('Bash', { command: 'yarn install\r\necho done' });

    expect(judgeDiscipline(crlfEndEntry, input, judgeOpts).upheld).toBe(false);
  });
});

describe('compileDisciplineRegistrations — matches uses the same line unit (CONFIG-09 §4.1)', () => {
  it('matches returns "-" when the anchored pattern hits the second line', () => {
    // P0 routing agreement: if routing still tests the whole string, this input never
    // routes and the judge above never spawns — a violation without a spawn. Mutation
    // caught: buildMatches keeping the whole-string test while the judge splits.
    const reg = compileOne(anchoredEntry);
    const input = inputWithToolCall('Bash', { command: 'echo setup\nyarn install' });

    expect(reg.matches?.(input)).toBe('-');
  });

  it('matches returns "-" when the pattern only matches across the line boundary', () => {
    // P0 the mirror agreement: the judge above breaks this input via the whole-string
    // half, so routing must see it too — a null here would be a violation without a
    // spawn. Mutation caught: the matches closure judging lines only.
    const reg = compileOne(straddlingEntry);
    const input = inputWithToolCall('Bash', { command: 'echo setup\nyarn install' });

    expect(reg.matches?.(input)).toBe('-');
  });
});
