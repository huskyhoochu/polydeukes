import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// The documentation package is built with its own directory as the working directory.
const REPO_ROOT = resolve(process.cwd(), '../..');

const readRepo = (path: string) => readFileSync(join(REPO_ROOT, path), 'utf8');

/** One judged edit from a recipe's conformance fixture, as the landing page shows it. */
export interface LandingCase {
  /** The recipe's directory name. */
  recipe: string;
  /** The verdict word of the first telemetry row. */
  verdict: string;
  /** The exit code the judge returned. */
  exit: number;
  /** The lines the judge printed to stderr. */
  stderr: string[];
  /** The tool the agent called and the file it edited. */
  tool: string;
  path: string;
  /** The edit as changed lines: those only in the old text, then those only in the new. */
  removed: string[];
  added: string[];
}

const readCase = (recipe: string, file: string): LandingCase => {
  const fixture = JSON.parse(readRepo(`conformance/covenant/recipes/${recipe}/${file}`));
  const call = fixture.stdin.toolCalls[0];
  const before: string[] = call.fileChange.pre.split('\n');
  const after: string[] = call.fileChange.post.split('\n');
  return {
    recipe,
    verdict: fixture.expect.rows[0][0],
    exit: fixture.expect.exit,
    stderr: fixture.expect.stderr,
    tool: call.name,
    path: call.fileChange.path,
    removed: before.filter((line) => line && !after.includes(line)),
    added: after.filter((line) => line && !before.includes(line)),
  };
};

/**
 * The four conformance fixtures the landing page shows, read from the repository at build
 * time: two the judge advises on, then two it blocks.
 */
export const cases: LandingCase[] = [
  readCase('dependency-edits-follow-lookups', 'hono-upgrade-without-lookups-advised.json'),
  readCase('comments-stay-short', 'narrating-comment-run-advised.json'),
  readCase('migrations-are-generated', 'edited-migration-blocked.json'),
  readCase('packages-meet-at-the-entry-point', 'deep-import-into-other-package-blocked.json'),
];

/** One install route and the first command the install guide gives for it. */
export interface InstallRoute {
  /** The anchor id of the route's section in the install guide. */
  id: 'homebrew' | 'cargo' | 'npm' | 'pypi';
  /** The command line. */
  command: string;
}

const installGuide = readRepo('docs/how-to/install.md').split('\n');

const firstCommand = (id: InstallRoute['id'], prefix: string): InstallRoute => {
  const anchor = installGuide.indexOf(`<a id="${id}"></a>`);
  const command =
    anchor < 0 ? undefined : installGuide.slice(anchor).find((l) => l.startsWith(prefix));
  if (!command) throw new Error(`docs/how-to/install.md has no "${prefix}" line after #${id}`);
  return { id, command: command.trim() };
};

/** The four install routes in display order, with commands taken from the install guide. */
export const install: InstallRoute[] = [
  firstCommand('homebrew', 'brew install '),
  firstCommand('cargo', 'cargo install '),
  firstCommand('npm', 'npm install '),
  firstCommand('pypi', 'uv tool install '),
];

/**
 * One complete discipline entry, as a reader pastes it into `polydeukes.config.yaml`: the
 * configuration the second case was judged with, read from its conformance fixture.
 */
export const entry: string = JSON.parse(
  readRepo('conformance/covenant/recipes/comments-stay-short/narrating-comment-run-advised.json'),
).tree['polydeukes.config.yaml'].trimEnd();
