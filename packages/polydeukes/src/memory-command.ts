/**
 * `pdks memory ingest | search | show` — the one umbrella module that loads the optional
 * `@polydeukes/memory` package, and only when this command runs, so a tree without it keeps
 * every other command.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type * as Memory from '@polydeukes/memory';
import { CONFIG_FILENAMES, loadConfig } from './load-config.ts';

/** Inputs for one `pdks memory` call: the directory it runs in and the words after `memory`. */
export type RunMemorySpec = { cwd: string; args: string[] };

/** Complete stdout, returned only after every step succeeds. */
export type RunMemoryOutcome = { text: string };

const MEMORY_PACKAGE = '@polydeukes/memory';
/** Where the index lives, relative to the directory the command runs in. */
const DB_REL = '.polydeukes/memory.db';

const USAGE =
  'usage: pdks memory ingest [--rebuild] | pdks memory search <query…> [--json] | pdks memory show <id> [--json]';
const NO_INDEX = `no index at ${DB_REL} — run \`pdks memory ingest\` first`;
const EXAMPLE = ['', 'memory:', '  include:', "    - 'docs/**/*.md'"].join('\n');
const NO_SETTINGS = `memory.include is not declared — add the globs of the markdown files to index to the project config, for example:\n${EXAMPLE}`;
const noConfig = (cwd: string): string =>
  `no config in ${cwd} (${CONFIG_FILENAMES.join(', ')}) — run pdks memory from the directory that holds it, or create one that declares memory.include, for example:\n${EXAMPLE}`;

type Command =
  | { verb: 'ingest'; rebuild: boolean }
  | { verb: 'search'; query: string; json: boolean }
  | { verb: 'show'; id: string; json: boolean };

function parseArgs(args: string[]): Command {
  const [verb, ...rest] = args;
  if (verb === 'ingest' && (rest.length === 0 || (rest.length === 1 && rest[0] === '--rebuild'))) {
    return { verb, rebuild: rest.length === 1 };
  }
  const words = rest.filter((arg) => arg !== '--json');
  const json = words.length < rest.length;
  // Any other flag is refused rather than searched for as a word.
  if (words.some((word) => word.startsWith('--'))) throw new Error(USAGE);
  if (verb === 'search' && words.length > 0) return { verb, query: words.join(' '), json };
  if (verb === 'show' && words.length === 1) return { verb, id: words[0] as string, json };
  throw new Error(USAGE);
}

/**
 * Loads the optional package. Only the package name failing to resolve means it is not
 * installed; a module missing inside an installed copy fails the import below with the same
 * error code, and that message is the one a broken install needs to see.
 */
async function loadMemory(): Promise<typeof Memory> {
  try {
    import.meta.resolve(MEMORY_PACKAGE);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ERR_MODULE_NOT_FOUND') throw error;
    throw new Error(
      `${MEMORY_PACKAGE} is not installed — install it with \`pnpm add -D ${MEMORY_PACKAGE}\``,
    );
  }
  return import('@polydeukes/memory');
}

/** The config's `memory` section; checked before any database is opened. */
function memorySettings(cwd: string): Memory.MemoryConfig {
  if (!CONFIG_FILENAMES.some((name) => existsSync(join(cwd, name)))) throw new Error(noConfig(cwd));
  const settings = loadConfig({ rootDir: cwd }).config.memory;
  if (settings === undefined) throw new Error(NO_SETTINGS);
  return settings;
}

/**
 * Opens, read-only, an index a committed ingest wrote. An index nobody built would answer every
 * query with zero hits, so a missing file and a file no ingest stamped are both refused, and
 * neither is created or given a schema on the way.
 */
function openIndex(memory: typeof Memory, path: string) {
  if (!existsSync(path)) throw new Error(NO_INDEX);
  const db = memory.openMemoryDb({ path, readOnly: true });
  const { ingestedAt } = memory.describeMemoryIndex({ db });
  if (ingestedAt === null) {
    db.close();
    throw new Error(NO_INDEX);
  }
  return { db, ingestedAt };
}

/** A body without the blank lines that separated it from its heading. */
const trimBody = (body: string): string => body.replace(/^(?:[ \t]*\n)+/, '').trimEnd();

/**
 * The preamble row's body keeps the document's H1 line. When that line is the title the
 * rendered `# <title>` heading already shows, it is dropped; any other body is shown as stored.
 */
function shownBody(docTitle: string, sectionTitle: string, body: string): string {
  const trimmed = trimBody(body);
  if (sectionTitle !== '') return trimmed;
  const [first = '', ...rest] = trimmed.split('\n');
  const h1 = first.match(/^#[ \t]+(.*?)[ \t#]*$/);
  return h1?.[1] === docTitle ? trimBody(rest.join('\n')) : trimmed;
}

/** `<document title> › <section title>`, or the document title alone for the preamble row. */
const titleOf = (docTitle: string, sectionTitle: string): string =>
  sectionTitle === '' ? docTitle : `${docTitle} › ${sectionTitle}`;

function renderResult(hit: Memory.MemorySearchResult): string {
  const status = hit.stale ? `${hit.status}, stale` : hit.status;
  return [hit.id, hit.matchPath, status, hit.trust, titleOf(hit.docTitle, hit.sectionTitle)].join(
    '  ',
  );
}

function renderDocument(document: Memory.MemoryDocument): string {
  // The preamble row has no title: it is the text before the first H2.
  // A preamble holding only the title H1 renders to nothing and leaves no empty block.
  const blocks = document.sections
    .map((section) =>
      [
        section.title === '' ? '' : `## ${section.title}`,
        shownBody(document.title, section.title, section.body),
      ]
        .filter((part) => part !== '')
        .join('\n\n'),
    )
    .filter((block) => block !== '');
  return `${[`# ${document.title}`, ...blocks].join('\n\n')}\n`;
}

function renderSection(section: Memory.MemoryShownSection): string {
  const body = shownBody(section.docTitle, section.sectionTitle, section.body);
  return `# ${titleOf(section.docTitle, section.sectionTitle)}\n\n${body}\n`;
}

/**
 * Runs one `pdks memory` command against `<cwd>/.polydeukes/memory.db`.
 *
 * @throws Error whose message is the one stderr line the caller prints: usage, a missing
 * package, a missing `memory` section, a missing index, or an unknown id.
 */
export async function runMemory({ cwd, args }: RunMemorySpec): Promise<RunMemoryOutcome> {
  const command = parseArgs(args);
  const memory = await loadMemory();
  const path = join(cwd, DB_REL);

  if (command.verb === 'ingest') {
    const config = memorySettings(cwd);
    const db = memory.openMemoryDb({ path });
    try {
      memory.ingestMemory({ db, root: cwd, config, rebuild: command.rebuild });
      const { documents } = memory.describeMemoryIndex({ db });
      return {
        text: `indexed ${documents} document${documents === 1 ? '' : 's'} into ${DB_REL}\n`,
      };
    } finally {
      db.close();
    }
  }

  if (command.verb === 'search') {
    const config = memorySettings(cwd);
    const { db, ingestedAt } = openIndex(memory, path);
    try {
      const results = memory.searchMemory({ db, query: command.query, config });
      if (command.json) return { text: `${JSON.stringify({ ingestedAt, results })}\n` };
      return {
        text: `${[`# ingested at ${ingestedAt}`, ...results.map(renderResult)].join('\n')}\n`,
      };
    } finally {
      db.close();
    }
  }

  // `show` reads the index alone: the stored rows already carry what the settings derived.
  const { db } = openIndex(memory, path);
  try {
    const shown = memory.showMemory({ db, id: command.id });
    if (shown === undefined) throw new Error(`unknown memory id: ${command.id}`);
    if (command.json) return { text: `${JSON.stringify(shown)}\n` };
    return { text: 'sections' in shown ? renderDocument(shown) : renderSection(shown) };
  } finally {
    db.close();
  }
}
