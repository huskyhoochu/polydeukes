/**
 * Generates the Starlight content tree from `docs/` and `docs/catalog.json`.
 *
 * `docs/` is the shipped source that `pdks docs` also reads, so nothing here writes
 * to it. Every file is read, transformed in memory, and emitted under
 * `src/content/docs/<locale>/`, which is gitignored and rebuilt on every run.
 */
import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(HERE, '..');
const REPO_ROOT = resolve(PACKAGE_ROOT, '../..');
const DOCS_ROOT = join(REPO_ROOT, 'docs');
const OUT_ROOT = join(PACKAGE_ROOT, 'src/content/docs');

/** Repository browse URL for links that leave `docs/` and have no site page. */
const REPO_BLOB = 'https://github.com/huskyhoochu/polydeukes/blob/main';

/** Where a reader edits the source of a page, which is the original under `docs/`. */
const EDIT_BASE = 'https://github.com/huskyhoochu/polydeukes/edit/main/docs';

const REFERENCE_LABELS = {
  'reference/cli/': { en: 'CLI commands', ko: 'CLI 명령어' },
  'reference/packages/': { en: 'Packages', ko: '패키지' },
};

/** The catalog entry rendered as the documentation index; it is not placed in the sidebar. */
const HOME_ID = 'home';

/** Route prefix for every documentation page; `/` belongs to the landing page. */
const BASE = '/docs';

/**
 * Maps a documentation-root-relative Markdown path to its site path, dropping the
 * `.ko` suffix and the `index`/`README` basename that Starlight routes as a directory.
 */
function toSitePath(docPath, locale) {
  let slug = docPath.replace(/\.ko\.md$/, '').replace(/\.md$/, '');
  if (slug === 'README') return locale === 'en' ? `${BASE}/` : `/${locale}${BASE}/`;
  slug = slug.replace(/\/index$/, '');
  return locale === 'en' ? `${BASE}/${slug}/` : `/${locale}${BASE}/${slug}/`;
}

/**
 * Rewrites one Markdown link target found in a document at `fromPath`.
 *
 * Internal `docs/` targets become site paths in the target file's locale; targets outside
 * `docs/` become repository URLs, since the site publishes no page for them.
 * Fragments are preserved verbatim — section IDs are explicit anchors identical
 * across languages.
 */
function rewriteLink(target, fromPath) {
  if (/^(https?:|mailto:|#)/.test(target)) return target;

  const [path, fragment] = target.split('#');
  const suffix = fragment ? `#${fragment}` : '';
  const resolved = resolve(join(DOCS_ROOT, dirname(fromPath)), path);
  const insideDocs = relative(DOCS_ROOT, resolved);

  if (insideDocs.startsWith('..')) {
    const fromRepo = relative(REPO_ROOT, resolved);
    return `${REPO_BLOB}/${fromRepo}${suffix}`;
  }
  if (!insideDocs.endsWith('.md')) return `${REPO_BLOB}/docs/${insideDocs}${suffix}`;
  const locale = insideDocs.endsWith('.ko.md') ? 'ko' : 'en';
  return `${toSitePath(insideDocs, locale)}${suffix}`;
}

/**
 * The author date of the last commit that touched a documentation source file, as
 * YYYY-MM-DD. Starlight derives `lastUpdated` from git history, which the generated copy
 * does not have, so the date is read from the original here and written as frontmatter.
 */
async function lastCommitDate(docPath) {
  try {
    const { stdout } = await run('git', ['log', '-1', '--format=%as', '--', docPath], {
      cwd: DOCS_ROOT,
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/** Escapes a catalog string for a double-quoted YAML frontmatter scalar. */
function yamlString(value) {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Strips the H1 and the language-switch line, then rewrites relative links outside fenced code.
 * Starlight renders the title from frontmatter and supplies its own locale picker,
 * so both would otherwise appear twice.
 */
function transform(markdown, docPath) {
  const prefix = markdown.match(/^\s*(?:<!--[\s\S]*?-->\s*)*/)[0];
  let body = prefix + markdown.slice(prefix.length).replace(/^#[ \t]+[^\n]*(?:\n|$)/, '');
  for (const switchLine of [
    /^[ \t]*\*\*English\*\* · \[한국어\]\([^\s)]+\.ko\.md\)[ \t]*\r?$(?:\n)?/m,
    /^[ \t]*\[English\]\([^\s)]+\.md\) · \*\*한국어\*\*[ \t]*\r?$(?:\n)?/m,
    /^[ \t]*\*\*한국어\*\* · \[English\]\([^\s)]+\.md\)[ \t]*\r?$(?:\n)?/m,
  ]) {
    body = body.replace(switchLine, '');
  }
  body = body.replace(
    /(^ {0,3}(([`~])\3{2,})[^\n]*\n[\s\S]*?^ {0,3}\2\3*[ \t]*\r?$)|\]\(([^)\s]+)\)/gm,
    (match, fenced, _fence, _char, target) => {
      return fenced ? match : `](${rewriteLink(target, docPath)})`;
    },
  );
  return body.trimStart();
}

/**
 * Wraps the sections named in `doc.tabs` in one Starlight tab group. A section runs from its
 * `<a id="NAME"></a>` line to the next anchor line, the listed sections must be adjacent and in
 * the listed order, and each tab is labelled with the heading that opens its section, which is
 * removed from the tab content. The anchor lines are kept, ahead of the group, so each fragment
 * still lands at the tab group.
 */
function wrapTabs(body, doc, docPath) {
  const anchors = [...body.matchAll(/^<a id="[^"]*"><\/a>[ \t]*\r?$/gm)].map((m) => m.index);
  const sections = doc.tabs.map((name) => {
    const start = body.search(new RegExp(`^<a id="${name}"></a>`, 'm'));
    if (start === -1) throw new Error(`${docPath}: no anchor "${name}" for the tab group`);
    const end = anchors.find((position) => position > start) ?? body.length;
    return { name, start, end };
  });
  sections.forEach((section, i) => {
    if (i > 0 && sections[i - 1].end !== section.start) {
      throw new Error(
        `${docPath}: anchor "${section.name}" does not follow "${sections[i - 1].name}"`,
      );
    }
  });

  const items = sections.map(({ name, start, end }) => {
    const text = body.slice(start, end).replace(/^[^\n]*\n/, '');
    const heading = text.match(/^\s*#{1,6}[ \t]+(.+?)[ \t]*(?:\r?\n|$)/);
    if (!heading) throw new Error(`${docPath}: section "${name}" has no heading for its tab`);
    const content = text
      .slice(heading[0].length)
      .replace(/^\s*\n/, '')
      .trimEnd();
    return `<TabItem label={${JSON.stringify(heading[1])}}>\n\n${content}\n\n</TabItem>\n`;
  });
  const anchorLines = sections.map(({ start }) =>
    body.slice(start, body.indexOf('\n', start)).trim(),
  );
  const first = sections[0].start;
  const last = sections[sections.length - 1].end;
  return [
    "import { Tabs, TabItem } from '@astrojs/starlight/components';\n\n",
    body.slice(0, first),
    `${anchorLines.join('\n')}\n\n`,
    `<Tabs syncKey="${doc.id}">\n`,
    items.join('\n'),
    '</Tabs>\n\n',
    body.slice(last),
  ].join('');
}

/** Writes one translated document with catalog-sourced frontmatter. */
async function emit(doc, locale, translation) {
  const source = await readFile(join(DOCS_ROOT, translation.path), 'utf8');
  const transformed = transform(source, translation.path);
  const body = doc.tabs ? wrapTabs(transformed, doc, translation.path) : transformed;
  const extension = doc.tabs ? '.mdx' : '.md';
  const slug = translation.path
    .replace(/\.ko\.md$/, '.md')
    .replace(/^README\.md$/, 'index.md')
    .replace(/\.md$/, extension);
  const outPath =
    locale === 'en' ? join(OUT_ROOT, 'docs', slug) : join(OUT_ROOT, locale, 'docs', slug);
  const updated = await lastCommitDate(translation.path);
  // Astro derives a route from the file path with github-slugger, which drops the dots in
  // names like `v0.7`; the sidebar and rewritten links keep them, so the route is set here.
  const route = toSitePath(translation.path, locale).replace(/^\/|\/$/g, '');
  const frontmatter = [
    '---',
    `title: ${yamlString(translation.title)}`,
    `slug: ${yamlString(route)}`,
    `description: ${yamlString(translation.summary)}`,
    ...(updated ? [`lastUpdated: ${updated}`] : []),
    `editUrl: ${yamlString(`${EDIT_BASE}/${translation.path}`)}`,
    ...(doc.id === HOME_ID ? ['template: doc'] : []),
    '---',
    '',
  ].join('\n');

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, frontmatter + body, 'utf8');
}

/**
 * Builds one sidebar from documents, one group per catalog category in the catalog's
 * category order. Reference subgroups occupy their first member's position, and Starlight
 * resolves Korean labels through `translations`.
 */
function buildSidebar(documents, categories) {
  const groups = new Map();
  const referenceGroups = new Map();
  for (const doc of documents) {
    if (doc.id === HOME_ID) continue;
    if (!categories.some(({ id }) => id === doc.category)) {
      throw new Error(`${doc.id}: category "${doc.category}" is not in catalog categories`);
    }
    if (!doc.en) continue;
    if (!groups.has(doc.category)) groups.set(doc.category, []);
    const item = {
      label: doc.en.title,
      ...(doc.ko
        ? {
            translations: {
              ko: doc.ko.title,
            },
          }
        : {}),
      link: toSitePath(doc.en.path, 'en'),
    };
    const referencePath =
      doc.category === 'reference'
        ? Object.keys(REFERENCE_LABELS).find((path) => doc.en.path.startsWith(path))
        : undefined;
    if (referencePath) {
      if (!referenceGroups.has(referencePath)) {
        const labels = REFERENCE_LABELS[referencePath];
        const group = { label: labels.en, translations: { ko: labels.ko }, items: [] };
        referenceGroups.set(referencePath, group);
        groups.get(doc.category).push(group);
      }
      referenceGroups.get(referencePath).items.push(item);
    } else {
      groups.get(doc.category).push(item);
    }
  }

  return categories
    .filter(({ id }) => groups.has(id))
    .map(({ id, en, ko }) => ({ label: en, translations: { ko }, items: groups.get(id) }));
}

const catalog = JSON.parse(await readFile(join(DOCS_ROOT, 'catalog.json'), 'utf8'));
const documents = [...catalog.documents].sort((a, b) => a.order - b.order);

await rm(OUT_ROOT, { recursive: true, force: true });
for (const doc of documents) {
  for (const locale of ['en', 'ko']) {
    if (doc[locale]) await emit(doc, locale, doc[locale]);
  }
}

const sidebar = buildSidebar(documents, catalog.categories);
await mkdir(join(PACKAGE_ROOT, 'src/generated'), { recursive: true });
await writeFile(
  join(PACKAGE_ROOT, 'src/generated/sidebar.json'),
  `${JSON.stringify(sidebar, null, 2)}\n`,
  'utf8',
);

const counted = documents.filter((doc) => doc.ko).length;
console.log(`synced ${documents.length} documents (${counted} bilingual) from docs/`);
