import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { writeConfigAt } from './helpers.ts';

// Every `pnpm exec pdks memory …` command a skill tells an agent to run, executed on the built
// bin against an index the bin itself wrote. A skill whose wording drifts from the CLI — a verb
// renamed, a flag the parser refuses, a placeholder standing where an argument is required —
// exits non-zero here instead of in the session that follows the skill.

const REPO_ROOT = resolve(import.meta.dirname, '../../..');
const SKILLS_DIR = join(REPO_ROOT, '.claude/skills');
const BIN = resolve(import.meta.dirname, '../dist/bin.js');
const COMMAND = /`(pnpm exec pdks memory [^`]+)`/g;

const TICKET = 'AB-1';
const SECTION_ID = 'notes/duty#unresolved-questions';
const WORD = 'pending';
/**
 * The placeholders the skills write, each with the fixture value that makes the command
 * answer. A placeholder missing here fails the run, so a new one is added knowingly.
 */
const PLACEHOLDERS: Record<string, string> = {
  '<ID>': TICKET,
  '<section id>': SECTION_ID,
  '<area keywords>': WORD,
  '<keywords>': WORD,
  '<identifier>': WORD,
};

function skillCommands(): { skill: string; command: string }[] {
  return readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const text = readFileSync(join(SKILLS_DIR, entry.name, 'SKILL.md'), 'utf-8');
      return [...text.matchAll(COMMAND)].map((match) => ({
        skill: entry.name,
        command: match[1] as string,
      }));
    });
}

function filled(command: string): string {
  return command.replace(/<[^>]+>/g, (placeholder) => {
    const value = PLACEHOLDERS[placeholder];
    if (value === undefined) throw new Error(`no fixture value for ${placeholder} in: ${command}`);
    return value;
  });
}

let projectRoot: string;

function run(command: string) {
  const line = filled(command).replace(/^pnpm exec pdks /, `'${process.execPath}' '${BIN}' `);
  return spawnSync('sh', ['-c', line], { cwd: projectRoot, encoding: 'utf-8' });
}

beforeAll(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'pdks-skill-memory-'));
  mkdirSync(join(projectRoot, 'notes'));
  writeFileSync(
    join(projectRoot, 'notes/duty.md'),
    `---\ntitle: Duty\ntype: note\nissue: ${TICKET}\n---\n## Unresolved questions\n\n- [ ] ${TICKET} ${WORD}\n`,
  );
  writeConfigAt(projectRoot, join(projectRoot, 'roi.log'), {
    memory: {
      include: ['notes/**/*.md'],
      ticket: [{ from: 'frontmatter', key: 'issue' }],
      obligations: [{ line: '^\\s*[-*] \\[ \\]', key: '[A-Z]+-[0-9]+' }],
    },
  });
});

afterAll(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe('the pdks memory commands the skills name', () => {
  const commands = skillCommands();
  // Ingest lines run first: every other verb reads the index an ingest wrote.
  const ordered = [
    ...commands.filter(({ command }) => command.startsWith('pnpm exec pdks memory ingest')),
    ...commands.filter(({ command }) => !command.startsWith('pnpm exec pdks memory ingest')),
  ];

  it('finds at least one command, so the run below is not vacuous', () => {
    expect(commands.length).toBeGreaterThan(0);
  });

  it.each(ordered.map(({ skill, command }) => [skill, command]))(
    '%s: `%s` exits 0 against the index the bin built',
    (_skill, command) => {
      const result = run(command);
      expect(result.stderr).toBe('');
      expect(result.status).toBe(0);
    },
  );
});
