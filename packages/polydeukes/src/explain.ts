/**
 * `pdks explain` — render both surfaces' assembled registration sets without judging.
 *
 * This module calls the composition roots' OWN assembly functions and renders what they
 * return, so it reports the table the judgment uses rather than a second opinion about it.
 *
 * It never dispatches, never writes telemetry or a baseline, and never opens a transcript
 * file — the session assembly receives core's `noopTranscript`, which answers queries with
 * nothing and reads no disk. Every failure throws: an answer that cannot be given is never
 * given halfway.
 */

import { join } from 'node:path';
import { resolveGitAdapterSettings } from '@polydeukes/adapter-git';
import type { DisciplineDraft, DisciplineEntry } from '@polydeukes/core';
import { AXIS_NAMES, deriveShape, noopTranscript, RELATION_NAMES } from '@polydeukes/core';
import type { CovenantRegistration } from '@polydeukes/covenant';
import { assembleSessionRegistrations } from './claude-code-hook.js';
import { assembleCommitRegistrations } from './covenant-check.js';
import { loadCovenantModule, resolveCovenantDist } from './covenant-module.js';
import { loadConfig } from './load-config.js';

/** `explain` input — the repository whose config is read. */
export type ExplainSpec = {
  repoRoot: string;
};

/** The three meta-covenant labels: registrations that protect the judging chain itself. */
const META_LABELS = new Set(['self-mod', 'shell-mod', 'transcript-mod']);

/**
 * The description of a declaration entry: its catalogue coordinate (the mechanism, the axes
 * its sources derive, and the relations its entries decide), then what it routes on, how
 * large its two regex lists are, how many sources it names and how many of those carry
 * each non-file kind, whether it carries a valve, and whether the author left a `why`. An
 * absent scope block admits every world.
 *
 * The axes are derived, never read off the declaration: `loadConfig` has already run the
 * declaration through the validator, so the shape here is the one the catalogue admitted.
 */
function declareDescription(entry: DisciplineEntry, enforce: string): string {
  const declare = entry.declare as NonNullable<DisciplineEntry['declare']>;
  const shape = deriveShape(declare);
  const axes = AXIS_NAMES.filter((axis) => shape.axes.has(axis)).join(',');
  const relations = RELATION_NAMES.filter((relation) => shape.relations.has(relation)).join(',');
  const relate = declare.relate.map((relateEntry) => relateEntry.id).join(', ');
  const scope = declare.scope === undefined ? 'scope every world' : `scope ${declare.scope.source}`;
  const include = declare.scope?.include?.length ?? 0;
  const exclude = declare.scope?.exclude?.length ?? 0;
  const bindings = Object.values(declare.sources ?? {});
  // A file binding is the unmarked kind, so only the two the surface has to supply are
  // counted out; a kind nothing binds is left off rather than printed as a zero.
  const kinds = (['sidecar', 'transcript'] as const)
    .map((kind) => ({ kind, count: bindings.filter((binding) => kind in binding).length }))
    .filter(({ count }) => count > 0)
    .map(({ kind, count }) => `${kind} ${count}`);
  const counted = kinds.length === 0 ? '' : ` (${kinds.join(', ')})`;
  const sources = `sources ${bindings.length}${counted}`;
  const valve = declare.witness === undefined ? '—' : '✓';
  const why = entry.why === undefined ? '—' : '✓';
  return (
    `${declare.mechanism} · ${axes} · ${relations} ${relate} · ${scope} · ` +
    `include ${include} · exclude ${exclude} · ${sources} · valve ${valve} · why ${why}${enforce}`
  );
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
  drafts: DisciplineDraft[];
  disciplines: DisciplineEntry[];
  selfModScope: string;
}): string {
  const lines: string[] = [];
  const width = Math.max(
    ...spec.registrations.map((registration) => registration.label.length),
    ...spec.drafts.map((draft) => draft.id.length),
  );
  let declare = 0;
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
    // Every non-meta body registration is one config entry's declaration; a label the config
    // does not carry is an assembly the renderer was never told about.
    const entry = spec.disciplines.find((candidate) => candidate.id === registration.label);
    if (entry === undefined) {
      throw new Error(`explain: registration '${registration.label}' matches no config entry`);
    }
    // The DECLARED level is rendered, never the effective one: an omission stays unmarked
    // so the default and an author's explicit choice of it never read alike, and the
    // surface header states what the omission resolves to.
    const level = entry.enforce === undefined ? '' : ` · enforce: ${entry.enforce}`;
    declare += 1;
    lines.push(row('declare', registration.label, width, declareDescription(entry, level)));
  }

  for (const draft of spec.drafts) {
    lines.push(row('draft', draft.id, width, 'unpromoted — no judgment'));
  }

  const tally =
    `  registrations ${meta + declare + skip} · ` +
    `declare ${declare} · skip ${skip} · meta ${meta} · draft ${spec.drafts.length}`;
  return [spec.header, tally, ...lines].join('\n');
}

/**
 * Read the config at `repoRoot`, assemble both surfaces, and render them.
 *
 * The session assembly is given a transcript path, so its `transcript-mod` registration
 * exists here exactly as it does under a normal hook payload — the path is never read,
 * because the injected transcript is the no-op one.
 */
export async function explain(spec: ExplainSpec): Promise<{ text: string }> {
  const { config, configPath } = loadConfig({ rootDir: spec.repoRoot });
  // Resolved and imported exactly as the two runners do, so what this renders is the table
  // that would judge: a dist those runners would refuse cannot be rendered as if it worked.
  // The load names the missing module and the recovery command.
  const covenant = await loadCovenantModule(resolveCovenantDist());
  const disciplines: DisciplineEntry[] = config.disciplines ?? [];
  const drafts: DisciplineDraft[] = config.drafts ?? [];

  const session = assembleSessionRegistrations({
    config,
    rootDir: spec.repoRoot,
    covenant,
    transcriptPath: join(spec.repoRoot, 'transcript.jsonl'),
    transcript: noopTranscript,
  });
  const commit = assembleCommitRegistrations({
    config,
    rootDir: spec.repoRoot,
    covenant,
  });
  const gitSettings = resolveGitAdapterSettings({ namespace: config.adapters?.git });

  const text = [
    `pdks explain — ${configPath}`,
    '',
    renderSurface({
      header:
        'surface: session (claude-code hook) · disciplines: advise unless enforce: block · meta: block',
      registrations: session,
      drafts,
      disciplines,
      selfModScope: 'common; includes the config file itself',
    }),
    '',
    renderSurface({
      header: `surface: commit (git pre-commit) · enforce: ${gitSettings.enforce} · disciplines: advise unless enforce: block`,
      registrations: commit,
      drafts,
      disciplines,
      selfModScope: 'common ∪ adapters.git; deduped, includes the config file itself',
    }),
    '',
  ].join('\n');

  return { text };
}
