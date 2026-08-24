/**
 * `pdks explain` — render both surfaces' assembled registration sets without judging
 * (CLI-01).
 *
 * The answer to "what is judged where, and what silently cannot be" lives in three places
 * today: the registration table inside each composition root, the skip reason the compiler
 * writes to stderr only on a config fault, and the surface placement in prose. This module
 * calls the roots' OWN assembly functions and renders what they return, so it reports the
 * table the judgment uses rather than a second opinion about it (§7 invariant 1).
 *
 * It never dispatches, never writes telemetry or a baseline, and never opens a transcript
 * file — the session assembly receives core's `noopTranscript`, which answers queries with
 * nothing and reads no disk (§7 invariants 2-3). Every failure throws: an answer that
 * cannot be given is never given halfway.
 */

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { resolveGitAdapterSettings } from '@polydeukes/adapter-git';
import type { DisciplineDraft, DisciplineEntry } from '@polydeukes/core';
import { noopTranscript } from '@polydeukes/core';
import type { CovenantRegistration } from '@polydeukes/covenant';
import { assembleSessionRegistrations } from './claude-code-hook.js';
import { assembleCommitRegistrations } from './covenant-check.js';
import { loadConfig } from './load-config.js';

/** `explain` input — the repository whose config is read. */
export type ExplainSpec = {
  repoRoot: string;
};

/** The three meta-covenant labels: registrations that protect the judging chain itself. */
const META_LABELS = new Set(['self-mod', 'shell-mod', 'transcript-mod']);

/** Normalize an optional glob field to an array (absent = empty). */
function toGlobs(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return typeof value === 'string' ? [value] : value;
}

/**
 * The routing scope of a config entry, in its own family's shape: the delta and context
 * families scope by `in`/`except` globs, the path family by its own glob, and the command
 * family by nothing at all — it judges the command line, which no path scopes.
 */
function scopeOf(entry: DisciplineEntry): string {
  if (entry.immutable !== undefined) {
    return `immutable ${toGlobs(entry.immutable).join(', ')}`;
  }
  if (entry.forbidCommand !== undefined) {
    return 'forbidCommand · (no path scope)';
  }
  const family =
    entry.requirePrecedent === undefined
      ? 'forbid'
      : `requirePrecedent ${Object.keys(entry.requirePrecedent).join(', ')}`;
  const inGlobs = toGlobs(entry.in);
  const scope = inGlobs.length === 0 ? 'every file' : `in ${inGlobs.join(', ')}`;
  const exceptGlobs = toGlobs(entry.except);
  const except = exceptGlobs.length === 0 ? '' : ` · except ${exceptGlobs.join(', ')}`;
  return `${family} · ${scope}${except}`;
}

/** One rendered line: the kind column, the label column, then the description. */
function row(kind: string, label: string, width: number, description: string): string {
  return `  ${kind.padEnd(8)} ${label.padEnd(width)} ${description}`;
}

/** The description of a meta-covenant registration — how much surface it covers. */
function metaDescription(registration: CovenantRegistration, surface: string): string {
  if (registration.label === 'transcript-mod') {
    return 'content predicate · conditional: transcript_path';
  }
  return `paths ${registration.protectedPaths.length} (${surface})`;
}

/** Render one surface: its header, its tallies, and one line per registration. */
function renderSurface(spec: {
  header: string;
  registrations: CovenantRegistration[];
  excluded: DisciplineEntry[];
  drafts: DisciplineDraft[];
  disciplines: DisciplineEntry[];
  selfModScope: string;
}): string {
  const lines: string[] = [];
  const width = Math.max(
    ...spec.registrations.map((registration) => registration.label.length),
    ...spec.excluded.map((entry) => entry.id.length),
    ...spec.drafts.map((draft) => draft.id.length),
  );
  let judged = 0;
  let skip = 0;
  let meta = 0;

  for (const registration of spec.registrations) {
    if (META_LABELS.has(registration.label)) {
      meta += 1;
      const scope = registration.label === 'self-mod' ? spec.selfModScope : 'common';
      lines.push(row('meta', registration.label, width, metaDescription(registration, scope)));
      continue;
    }
    if (registration.skip !== undefined) {
      skip += 1;
      lines.push(row('skip', registration.label, width, registration.skip.reason));
      continue;
    }
    judged += 1;
    const entry = spec.disciplines.find((candidate) => candidate.id === registration.label);
    // Only advise is marked (CONFIG-11 §4.5): absence and explicit block both mean block
    // today, so annotating either would invert its meaning the day the default flips.
    const level = entry?.enforce === 'advise' ? ' · enforce: advise' : '';
    const description =
      entry === undefined
        ? ''
        : `${scopeOf(entry)} · why ${entry.why === undefined ? '—' : '✓'}${level}`;
    lines.push(row('judge', registration.label, width, description));
  }

  for (const entry of spec.excluded) {
    lines.push(row('excluded', entry.id, width, 'forbidCommand — no shell axis on this surface'));
  }

  for (const draft of spec.drafts) {
    lines.push(row('draft', draft.id, width, 'unpromoted — no judgment'));
  }

  const tally =
    `  registrations ${meta + judged + skip} · judged ${judged} · skip ${skip} · ` +
    `meta ${meta} · excluded ${spec.excluded.length} · draft ${spec.drafts.length}`;
  return [spec.header, tally, ...lines].join('\n');
}

/**
 * Read the config at `repoRoot`, assemble both surfaces, and render them (CLI-01 §4.2).
 *
 * The session assembly is given a transcript path, so its `transcript-mod` registration and
 * the context family exist here exactly as they do under a normal hook payload — the path is
 * never read, because the injected transcript is the no-op one. Without a transcript the
 * compiler would report every context entry as a skip, which is the COMMIT surface's answer,
 * not the session's.
 */
export function explain(spec: ExplainSpec): { text: string } {
  const { config, configPath } = loadConfig(spec.repoRoot);
  const covenantDist = dirname(createRequire(import.meta.url).resolve('@polydeukes/covenant'));
  const disciplines: DisciplineEntry[] = config.disciplines ?? [];
  const drafts: DisciplineDraft[] = config.drafts ?? [];

  const session = assembleSessionRegistrations({
    config,
    rootDir: spec.repoRoot,
    covenantDist,
    transcriptPath: join(spec.repoRoot, 'transcript.jsonl'),
    transcript: noopTranscript,
  });
  const commit = assembleCommitRegistrations({
    config,
    rootDir: spec.repoRoot,
    covenantDist,
  });
  const gitSettings = resolveGitAdapterSettings(config.adapters?.git);

  const text = [
    `pdks explain — ${configPath}`,
    '',
    renderSurface({
      header: 'surface: session (claude-code hook)',
      registrations: session,
      excluded: [],
      drafts,
      disciplines,
      selfModScope: 'common; includes the config file itself',
    }),
    '',
    renderSurface({
      header: `surface: commit (git pre-commit) · enforce: ${gitSettings.enforce}`,
      registrations: commit,
      excluded: disciplines.filter((entry) => entry.forbidCommand !== undefined),
      drafts,
      disciplines,
      selfModScope: 'common ∪ adapters.git; deduped, includes the config file itself',
    }),
    '',
  ].join('\n');

  return { text };
}
