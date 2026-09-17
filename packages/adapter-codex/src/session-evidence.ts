/** Adapter-owned lifecycle evidence for one Codex session. */

import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { CovenantInput } from '@polydeukes/core';
import { isPlainObject } from '@polydeukes/core';

type UserRecord = { kind: 'user'; text: string; timestampMs: number };
type ToolRecord = { kind: 'tool'; name: string; args?: Record<string, unknown> };
type EvidenceRecord = UserRecord | ToolRecord;

/** The stable local path for host evidence, without exposing the host session id as a path. */
export function sessionEvidencePath(repoRoot: string, sessionId: string): string {
  const name = createHash('sha256').update(sessionId).digest('hex');
  return join(repoRoot, '.polydeukes', 'codex-sessions', `${name}.jsonl`);
}

/** Append one lifecycle record in receive order. */
export function appendSessionEvidence(path: string, record: EvidenceRecord): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(record)}\n`);
}

/** Remove only one session's evidence file; an already absent file is a successful cleanup. */
export function removeSessionEvidence(path: string): void {
  rmSync(path, { force: true });
}

function hasOnlyKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  return (
    Object.keys(record).every((key) => keys.includes(key)) && keys.every((key) => key in record)
  );
}

function parseRecord(value: unknown, lineNumber: number): EvidenceRecord {
  if (!isPlainObject(value) || typeof value.kind !== 'string') {
    throw new Error(`session evidence record ${lineNumber} is not an object with a kind`);
  }
  if (
    value.kind === 'user' &&
    hasOnlyKeys(value, ['kind', 'text', 'timestampMs']) &&
    typeof value.text === 'string' &&
    typeof value.timestampMs === 'number' &&
    Number.isFinite(value.timestampMs)
  ) {
    return { kind: 'user', text: value.text, timestampMs: value.timestampMs };
  }
  if (
    value.kind === 'tool' &&
    (hasOnlyKeys(value, ['kind', 'name']) || hasOnlyKeys(value, ['kind', 'name', 'args'])) &&
    typeof value.name === 'string' &&
    (value.args === undefined || isPlainObject(value.args))
  ) {
    return value.args === undefined
      ? { kind: 'tool', name: value.name }
      : { kind: 'tool', name: value.name, args: value.args };
  }
  throw new Error(`session evidence record ${lineNumber} has an invalid ${value.kind} shape`);
}

/** Read and strictly project adapter JSONL into the core session evidence shape. */
export function readSessionEvidence(path: string): NonNullable<CovenantInput['session']> {
  let source: string;
  try {
    source = readFileSync(path, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { evidencePath: path, userMessages: [], toolCalls: [] };
    }
    throw new Error(
      `session evidence JSONL could not be read (${error instanceof Error ? error.message : String(error)})`,
    );
  }

  const records: EvidenceRecord[] = [];
  const lines = source.split('\n');
  for (const [index, line] of lines.entries()) {
    if (line === '' && index === lines.length - 1) continue;
    if (line.trim().length === 0) {
      throw new Error(`session evidence JSONL record ${index + 1} is blank`);
    }
    try {
      records.push(parseRecord(JSON.parse(line), index + 1));
    } catch (error) {
      throw new Error(
        `session evidence JSONL record ${index + 1} is invalid (${error instanceof Error ? error.message : String(error)})`,
      );
    }
  }

  return {
    evidencePath: path,
    userMessages: records
      .filter((record): record is UserRecord => record.kind === 'user')
      .map(({ text, timestampMs }) => ({ text, timestampMs })),
    toolCalls: records
      .filter((record): record is ToolRecord => record.kind === 'tool')
      .map(({ name, args }) => (args === undefined ? { name } : { name, args })),
  };
}
