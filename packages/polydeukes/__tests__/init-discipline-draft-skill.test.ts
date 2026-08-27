import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// The discipline classification skill is the sixth generated artifact: a procedure the
// agent follows to translate a prose problem statement into a config entry — a judged
// entry at advise, or a `draft: true` entry when no current family can express it. The
// exported constant is the shipped content, so every content assertion below judges the
// same bytes a consumer receives — the pattern the discovery-file tests set with TOPICS.
import { GENERATED_SKILL, initClaudeCode } from '../src/init-claude-code.ts';
import { loadConfig } from '../src/load-config.ts';

/** The new artifact's projectRoot-relative path — the report vocabulary. */
const SKILL_REL = '.claude/skills/discipline-draft/SKILL.md';
/** The five artifacts the installer already generated before the skill joined. */
const PRIOR_ARTIFACTS = [
  '.claude/hooks/covenant-pretooluse.mjs',
  '.claude/settings.json',
  'polydeukes.config.yaml',
  '.gitignore',
  '.claude/rules/polydeukes.md',
];
/** Preflight stub, success side — every run here must get past resolution. */
const resolvesFine = (): void => undefined;

let projectRoot: string;

function read(rel: string): string {
  return readFileSync(join(projectRoot, rel), 'utf-8');
}

/** The happy-path invocation — preflight injected as succeeding. */
function init(): { created: string[]; skipped: string[] } {
  return initClaudeCode({ projectRoot, resolvePolydeukes: resolvesFine });
}

/** Every fenced yaml example in the generated skill body, fence markers stripped. */
function yamlFences(content: string): string[] {
  return [...content.matchAll(/```yaml\n([\s\S]*?)```/g)].map((match) => match[1]);
}

/**
 * Validate one example the way a consumer's own tree would — a throwaway root per fence.
 * The fence is written as the whole config document, so a fence that is not one (an
 * entries-only snippet, or one missing the required `languages:` block) fails loudly here
 * instead of being papered over by test-side wrapping.
 */
function loadFenceAsConfig(fence: string): ReturnType<typeof loadConfig> {
  const root = mkdtempSync(join(tmpdir(), 'pdks-skill-fence-'));
  try {
    writeFileSync(join(root, 'polydeukes.config.yaml'), fence);
    return loadConfig(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'pdks-init-skill-'));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe('discipline classification skill — registration', () => {
  it('creates the skill on a fresh tree and reports it created alongside the prior five', () => {
    // An installer that forgets to register the new artifact leaves every consumer without
    // a classification entry point while looking fully installed; one that writes the file
    // but drops a prior artifact from the run breaks the layer it was added to. The disk
    // comparison pins that what landed is the shipped constant, not an empty placeholder.
    const result = init();

    expect(existsSync(join(projectRoot, SKILL_REL))).toBe(true);
    expect(read(SKILL_REL)).toBe(GENERATED_SKILL);
    expect([...result.created].sort()).toEqual([...PRIOR_ARTIFACTS, SKILL_REL].sort());
    expect(result.skipped).toEqual([]);
  });

  it('leaves a pre-existing divergent skill file untouched and reports it skipped', () => {
    // The byte-identity case above is satisfiable by a regenerator emitting identical
    // bytes, so this fixture deliberately diverges from generated output — the same shape
    // the hook and config cases pin for their own artifacts.
    const custom = '# consumer-tuned classification procedure\n';
    mkdirSync(join(projectRoot, dirname(SKILL_REL)), { recursive: true });
    writeFileSync(join(projectRoot, SKILL_REL), custom);

    const result = init();

    expect(read(SKILL_REL)).toBe(custom);
    expect(result.skipped).toContain(SKILL_REL);
    expect(result.created).toContain(PRIOR_ARTIFACTS[0]);
  });

  it('writes no skill file when preflight fails', () => {
    // Preflight clearing before the first write is the installer's contract; a skill file
    // left behind by a failed run would look installed on a tree the judge never wired.
    const failing = (): void => {
      throw new Error('polydeukes is not resolvable from this tree');
    };

    expect(() => initClaudeCode({ projectRoot, resolvePolydeukes: failing })).toThrow();
    expect(existsSync(join(projectRoot, SKILL_REL))).toBe(false);
  });
});

describe('discipline classification skill — the embedded config examples are loadable', () => {
  it('validates every fenced yaml example through loadConfig without throwing', () => {
    // A skill instructing a shape loadConfig refuses costs the consumer one failed
    // registration per attempt, after which the entry point is never used again — the
    // exact failure the discovery file was built to prevent one layer up. The count pin
    // stops the assertion going vacuously green over a body with no examples at all.
    const fences = yamlFences(GENERATED_SKILL);

    expect(fences.length).toBeGreaterThan(0);
    for (const fence of fences) {
      expect(() => loadFenceAsConfig(fence), fence).not.toThrow();
    }
  });

  it('carries a draft example that resolves into a validated draft entry', () => {
    // The skill's whole purpose is landing the first rung: an example whose keys drift
    // from the id/why/draft shape — or whose marker is not the literal true — parses as
    // prose but registers nothing, and defineConfig would refuse it on the consumer's own
    // tree. Resolution through loadConfig proves the example IS a draft, not merely text
    // mentioning one.
    const draftFences = yamlFences(GENERATED_SKILL).filter((fence) => /draft:\s*true/.test(fence));

    expect(draftFences.length).toBeGreaterThan(0);
    for (const fence of draftFences) {
      const { config } = loadFenceAsConfig(fence);
      expect(config.drafts?.length, fence).toBeGreaterThan(0);
    }
  });

  it('carries a judged example landing at enforce: advise with a family predicate key', () => {
    // The advise landing is the default destination of the procedure's expressible branch.
    // An example that omits the predicate key registers nothing judgeable; one spelling a
    // different enforce level teaches consumers a posture the skill must never choose for
    // them.
    const judged = yamlFences(GENERATED_SKILL).filter((fence) => /enforce:\s*advise\b/.test(fence));

    expect(judged.length).toBeGreaterThan(0);
    expect(
      judged.some((fence) => /\b(forbid|immutable|forbidCommand|requirePrecedent)\s*:/.test(fence)),
    ).toBe(true);
  });

  it('captures every fence pair as yaml — no example escapes validation under another tag', () => {
    // The extractor above matches ```yaml fences only. An example fenced as ```yml, or with
    // no tag at all, would ship unvalidated while every assertion here stays green — so the
    // pair count and the extracted count must agree. Neither count is line-anchored, so an
    // indented fence moves both numbers rather than slipping past one of them.
    const markers = GENERATED_SKILL.match(/```/g) ?? [];

    expect(yamlFences(GENERATED_SKILL).length).toBe(markers.length / 2);
  });

  it('never writes enforce: block inside any fenced example', () => {
    // Promotion to block is the user's explicit choice; an example carrying it makes the
    // skill promote on the user's behalf — the one thing the procedure must never do.
    // Prose may name the promotion; the copy-pasteable fences may not carry it.
    for (const fence of yamlFences(GENERATED_SKILL)) {
      expect(fence, fence).not.toContain('enforce: block');
    }
  });
});

describe('discipline classification skill — vocabulary matches the shipped surface', () => {
  it('names all four family predicate keys with the shipped spelling', () => {
    // A misspelled key in the lookup table sends every classification to a key defineConfig
    // rejects as unknown. The word boundary keeps `forbid` from being satisfied by the
    // inside of `forbidCommand`.
    for (const key of ['forbid', 'immutable', 'forbidCommand', 'requirePrecedent']) {
      expect(GENERATED_SKILL, key).toMatch(new RegExp(`\\b${key}\\b`));
    }
  });
});

describe('discipline classification skill — publishable to a reader without this repository', () => {
  it('contains no wiki path and no ticket coordinate', () => {
    // The generated body ships to consumers who cannot open _docs or resolve a ticket ID;
    // every such pointer is dangling the moment it leaves this machine. The token-boundary
    // form catches the coordinate shapes a plain substring scan misses.
    expect(GENERATED_SKILL).not.toContain('_docs');
    expect(GENERATED_SKILL).not.toMatch(
      /\b(?:CONFIG|COVENANT|DIAG|POSTURE|DISPATCH|ALGEBRA|CLI|DOCS|DIST|CORE|ADAPTER|MEMORY|LEDGER|MEASURE|VERIFY|TEMPLATE|STARLARK|LOCK|EXTRACT|SELF|KNOWLEDGE)-\d+\b/,
    );
  });
});

describe('discipline classification skill — a registered pattern is proven to fire', () => {
  it('names the worktree judgment command that fires a new pattern for real', () => {
    // The procedure ends with firing the entry once against a scratch violation; a skill
    // spelling that command wrong sends every consumer's proof run to a CLI that exits
    // with usage instead of a judgment.
    expect(GENERATED_SKILL).toContain('pdks covenant check --worktree');
  });
});

describe('discipline classification skill — advised reasons reach the agent through the log', () => {
  it('names the telemetry log default path and the config key that moves it', () => {
    // The session surface allows an advised call with exit 0, and its reason never reaches
    // the model at call time — the delivery is the agent consulting the log at task
    // boundaries. A skill naming the wrong path, or omitting the key that relocates it,
    // sends every consultation to a file that does not exist.
    expect(GENERATED_SKILL).toContain('.polydeukes/roi.log');
    expect(GENERATED_SKILL).toContain('telemetry.logPath');
  });
});
