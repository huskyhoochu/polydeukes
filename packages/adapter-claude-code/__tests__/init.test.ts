import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { MECHANISM_NAMES, MECHANISM_SHAPES } from '@polydeukes/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  compileDeclaration,
  judgeDeclaration,
  type World,
} from '../../polydeukes/src/covenant/declaration-engine.ts';
import { loadConfig } from '../../polydeukes/src/load-config.ts';
import { registerHook } from '../src/register-hook.ts';

const DISCOVERY_REL = '.claude/rules/polydeukes.md';
const SKILL_REL = '.claude/skills/discipline-draft/SKILL.md';
const UMBRELLA_SRC = resolve(import.meta.dirname, '../../polydeukes/src');
let projectRoot: string;
beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'pdks-adapter-discovery-'));
});
afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});
function init() {
  return registerHook({
    projectRoot,
    command: { executable: join(projectRoot, 'pdks'), args: [] },
  });
}
function read(rel: string): string {
  return readFileSync(join(projectRoot, rel), 'utf-8');
}
function tupleLiterals(file: string, constName: string): string[] {
  const src = readFileSync(join(UMBRELLA_SRC, file), 'utf-8');
  const match = src.match(new RegExp(`${constName}\\s*=\\s*\\[([^\\]]*)\\]\\s*as const`));
  if (!match) throw new Error(`${constName} tuple not found in ${file}`);
  const members = [...(match[1] as string).matchAll(/'([^']+)'/g)].map((m) => m[1] as string);
  if (members.length === 0) throw new Error(`${constName} tuple in ${file} is empty`);
  return members;
}
describe('the discovery file — literals that must agree with the umbrella', () => {
  it('names every shipped docs topic as a `pdks docs <topic>` form', () => {
    // The topic names are literals in this package; the query surface that answers them is
    // the umbrella's. A template instructing a form that does not exist costs one failed
    // call, after which the agent never asks again — so each umbrella topic must appear as
    // itself, word-boundary, and a rename on either side goes red here.
    init();

    const discovery = read(DISCOVERY_REL);
    const taught = [...discovery.matchAll(/`pdks docs ([a-z]+)`/g)].map((m) => m[1] as string);
    expect([...new Set(taught)].sort()).toEqual(
      [...tupleLiterals('docs-types.ts', 'DOCS_TOPICS')].sort(),
    );
  });

  it('lists every config filename the umbrella discovers in its paths frontmatter', () => {
    // The file loads when a config is in play, and which spellings count as a config is the
    // umbrella loader's list. A filename missing here leaves the file unloaded for projects
    // on that spelling; the frontmatter itself is what keeps the file out of every session.
    init();

    const discovery = read(DISCOVERY_REL);
    expect(discovery.startsWith('---\n')).toBe(true);
    const frontmatter = discovery.split('\n---')[0] ?? '';
    expect(frontmatter).toMatch(/(^|\n)paths:/);
    const listed = [...frontmatter.matchAll(/^ {2}- "([^"]+)"$/gm)].map((m) => m[1] as string);
    expect(listed.sort()).toEqual(
      [...tupleLiterals('load-config.ts', 'CONFIG_FILENAMES'), '.claude/**'].sort(),
    );
  });
});

/** The skill as generated into a fresh tree — the same bytes a consumer receives. */
function generatedSkill(): string {
  init();
  return read(SKILL_REL);
}

/** Every fenced yaml example in the skill body, fence markers stripped. */
function yamlFences(content: string): string[] {
  return [...content.matchAll(/```yaml\n([\s\S]*?)```/g)].map((match) => match[1] as string);
}

/**
 * Validate one example the way a consumer's own tree would — a throwaway root per fence.
 * The fence is written as the whole config document, so a fence that is not one fails
 * loudly here instead of being papered over by test-side wrapping.
 */
function loadFenceAsConfig(fence: string): ReturnType<typeof loadConfig> {
  const root = mkdtempSync(join(tmpdir(), 'pdks-skill-fence-'));
  try {
    writeFileSync(join(root, 'polydeukes.config.yaml'), fence);
    return loadConfig({ rootDir: root });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('discipline classification skill — the embedded config examples are loadable', () => {
  it('validates every fenced yaml example through loadConfig without throwing', () => {
    // A skill instructing a shape loadConfig refuses costs the consumer one failed
    // registration per attempt. The count pin stops the assertion going vacuously green
    // over a body with no examples at all.
    const fences = yamlFences(generatedSkill());

    expect(fences.length).toBeGreaterThan(0);
    for (const fence of fences) {
      expect(() => loadFenceAsConfig(fence), fence).not.toThrow();
    }
  });

  it('carries a draft example that resolves into a validated draft entry', () => {
    // An example whose keys drift from the id/why/draft shape parses as prose but registers
    // nothing. Resolution through loadConfig proves the example IS a draft.
    const draftFences = yamlFences(generatedSkill()).filter((fence) => /draft:\s*true/.test(fence));

    expect(draftFences.length).toBeGreaterThan(0);
    for (const fence of draftFences) {
      const { config } = loadFenceAsConfig(fence);
      expect(config.drafts?.length, fence).toBeGreaterThan(0);
    }
  });

  it('carries a judged example landing at enforce: advise with a declare block', () => {
    const judged = yamlFences(generatedSkill()).filter((fence) =>
      /enforce:\s*advise\b/.test(fence),
    );

    expect(judged.length).toBeGreaterThan(0);
    expect(judged.some((fence) => /\bdeclare\s*:/.test(fence))).toBe(true);
  });

  it('captures every fence pair as yaml — no example escapes validation under another tag', () => {
    // An example fenced as ```yml, or with no tag at all, would ship unvalidated while every
    // assertion here stays green — so the pair count and the extracted count must agree.
    const skill = generatedSkill();
    const markers = skill.match(/```/g) ?? [];

    expect(yamlFences(skill).length).toBe(markers.length / 2);
  });

  it('never writes enforce: block inside any fenced example', () => {
    // Promotion to block is the user's explicit choice; an example carrying it makes the
    // skill promote on the user's behalf.
    for (const fence of yamlFences(generatedSkill())) {
      expect(fence, fence).not.toContain('enforce: block');
    }
  });

  it('carries no languages block in any fenced example and no sentence calling it required', () => {
    // No judgment path reads `languages`, so an example that opens with the block teaches
    // the consumer to declare a profile nothing consumes, and a sentence naming it "the
    // schema's one required block" states a rule the loader does not hold. A fence is a
    // whole document, so a live top-level key sits at column 0; the resolved value beside
    // it is what separates "block removed" from "fence broken", since loadConfig fills the
    // empty record only for a document it accepted.
    const skill = generatedSkill();
    const fences = yamlFences(skill);

    expect(fences.length).toBeGreaterThan(0);
    for (const fence of fences) {
      expect(fence, fence).not.toMatch(/^languages\s*:/m);
      expect(loadFenceAsConfig(fence).config.languages, fence).toEqual({});
    }
    expect(skill).not.toContain("the schema's one required block");
  });
});

describe('discipline classification skill — current declaration capabilities', () => {
  function judgeExample(skill: string, id: string, world: World) {
    // Every list, because which one an example lives in is a function of the channels its
    // declaration binds, and this lookup is about the declaration rather than the surface.
    const entry = yamlFences(skill)
      .flatMap((fence) => {
        const { config } = loadFenceAsConfig(fence);
        return [
          ...(config.disciplines ?? []),
          ...(config.sessionDisciplines ?? []),
          ...(config.changeSetDisciplines ?? []),
        ];
      })
      .find((candidate) => candidate.id === id);
    if (!entry) throw new Error(`missing judged example: ${id}`);
    const compiled = compileDeclaration({
      declaration: { discipline: entry.id, ...entry.declare },
    });
    if ('kind' in compiled)
      throw new Error(`example failed compilation: ${JSON.stringify(compiled)}`);
    return judgeDeclaration({ compiled, world });
  }

  it('documents every mechanism with its admitted axes, relations, and structural conditions', () => {
    const section = generatedSkill().split('### 2.')[1]?.split('### 3.')[0] ?? '';
    const rows = new Map(
      [...section.matchAll(/^\| `([a-z-]+)` \| (.+)$/gm)].map((match) => [match[1], match[2]]),
    );
    expect([...rows.keys()].sort()).toEqual([...MECHANISM_NAMES].sort());
    for (const name of MECHANISM_NAMES) {
      const row = rows.get(name) ?? '';
      const shape = MECHANISM_SHAPES[name];
      if (shape.reserved) expect(row).toMatch(/reserved.*not accepted/i);
      for (const token of [...shape.axes, ...shape.relations])
        expect(row, name).toContain(`\`${token}\``);
      if (shape.requiresWitness) expect(row).toContain('`witness`');
      if (shape.scopeSource) expect(row).toContain(`\`${shape.scopeSource}\``);
    }
  });

  it('preserves the added-only example regex through TypeScript and YAML string decoding', () => {
    const skill = generatedSkill();
    const world = {
      'target.path': 'src/example.test.ts',
      pre: 'it("case", () => {});',
      post: 'it.only("case", () => {});',
    };
    expect(judgeExample(skill, 'no-focused-tests', world).kind).toBe('broken');
    expect(judgeExample(skill, 'no-focused-tests', { ...world, pre: world.post }).kind).toBe(
      'pass',
    );
  });

  it('matches the forbidden command flag but not a longer flag name', () => {
    const skill = generatedSkill();
    expect(judgeExample(skill, 'no-force-push', { command: 'git push --force' }).kind).toBe(
      'broken',
    );
    expect(
      judgeExample(skill, 'no-force-push', { command: 'git push --force-with-lease' }).kind,
    ).toBe('pass');
  });

  it('judges the locale pairing example on equal keys and names an unmatched key', () => {
    const skill = generatedSkill();
    const world = { 'target.path': 'locales/en.json', en: '{"home":"Home"}', ko: '{"home":"홈"}' };
    expect(judgeExample(skill, 'locale-key-parity', world).kind).toBe('pass');
    const verdict = judgeExample(skill, 'locale-key-parity', {
      ...world,
      en: '{"home":"Home","settings":"Settings"}',
    });
    expect(verdict).toMatchObject({
      kind: 'broken',
      breaks: [{ witnesses: [{ key: 'settings' }] }],
    });
  });

  it('judges the vocabulary example against the supplied allowed values', () => {
    const skill = generatedSkill();
    const world = {
      'target.path': 'statuses.json',
      post: '["ready"]',
      allowed: '["ready","done"]',
    };
    expect(judgeExample(skill, 'status-vocabulary', world).kind).toBe('pass');
    expect(
      judgeExample(skill, 'status-vocabulary', { ...world, post: '["queued"]' }),
    ).toMatchObject({
      kind: 'broken',
      breaks: [{ witnesses: [{ value: 'queued' }] }],
    });
  });

  it('distinguishes successful precedent, failed or absent calls, and unavailable history', () => {
    const skill = generatedSkill();
    const world = { 'target.path': 'package.json' };
    const session = { observedAtMs: 1000, userMessages: [], toolCalls: [] as unknown[] };
    const call = {
      index: 0,
      name: 'Bash',
      args: { command: 'npm view example version' },
      succeeded: true,
    };
    expect(
      judgeExample(skill, 'manifest-needs-npm-view', {
        ...world,
        session: { ...session, toolCalls: [call] },
      }).kind,
    ).toBe('pass');
    expect(judgeExample(skill, 'manifest-needs-npm-view', { ...world, session }).kind).toBe(
      'broken',
    );
    expect(
      judgeExample(skill, 'manifest-needs-npm-view', {
        ...world,
        session: { ...session, toolCalls: [{ ...call, succeeded: false }] },
      }).kind,
    ).toBe('broken');
    expect(judgeExample(skill, 'manifest-needs-npm-view', world)).toMatchObject({
      kind: 'not-applicable',
      reason: 'supply-pass',
    });
  });

  it('uses fresh benchmark execution as a draft rather than an already expressible pairing', () => {
    const skill = generatedSkill();
    const drafts = yamlFences(skill).flatMap(
      (fence) => loadFenceAsConfig(fence).config.drafts ?? [],
    );
    expect(drafts.map((entry) => entry.id)).toContain('benchmark-supports-performance-claim');
    expect(drafts.some((entry) => /locale|pairing/.test(entry.id))).toBe(false);
    expect(skill).toContain('pdks docs show write-disciplines');
  });
});

describe('discipline classification skill — vocabulary and commands match the shipped surface', () => {
  it('names the diff-piped judgment command that fires a new pattern for real', () => {
    const skill = generatedSkill();
    expect(skill).toContain('pdks covenant check --diff');
    expect(skill).toContain('git diff HEAD');
  });

  it('names the telemetry log default path and the config key that moves it', () => {
    // The session surface allows an advised call with exit 0 and its reason never reaches
    // the model at call time; the delivery is the agent consulting the log.
    const skill = generatedSkill();
    expect(skill).toContain('.polydeukes/roi.log');
    expect(skill).toContain('telemetry.logPath');
  });

  it('contains no wiki path and no ticket coordinate', () => {
    // The generated body ships to consumers who cannot open the wiki or resolve a ticket ID.
    const skill = generatedSkill();
    expect(skill).not.toContain('_docs');
    expect(skill).not.toMatch(
      /\b(?:CONFIG|COVENANT|DIAG|POSTURE|DISPATCH|ALGEBRA|CLI|DOCS|DIST|CORE|ADAPTER|MEMORY|LEDGER|MEASURE|VERIFY|TEMPLATE|STARLARK|LOCK|EXTRACT|SELF|KNOWLEDGE|SURFACE)-\d+\b/,
    );
  });
});
