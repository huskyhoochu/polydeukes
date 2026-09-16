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

/** Catalog categories in sidebar order, with the label shown per locale. */
const CATEGORY_LABELS = {
  tutorial: { en: 'Tutorial', ko: '튜토리얼' },
  'how-to': { en: 'How-to guides', ko: '실행 안내' },
  concepts: { en: 'Concepts', ko: '개념' },
  reference: { en: 'Reference', ko: '참조' },
  explanation: { en: 'Explanation', ko: '설명' },
  history: { en: 'Development log', ko: '개발 기록' },
};
const CATEGORY_ORDER = Object.keys(CATEGORY_LABELS);

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
 * Internal `docs/` targets become site paths in the same locale; targets outside
 * `docs/` become repository URLs, since the site publishes no page for them.
 * Fragments are preserved verbatim — section IDs are explicit anchors identical
 * across languages.
 */
function rewriteLink(target, fromPath, locale) {
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
  return `${toSitePath(insideDocs, locale)}${suffix}`;
}

/**
 * Returns the catalog title, or the document's own H1 when the catalog entry holds the
 * file's leading HTML comment instead. The build-in-public entries carry that comment
 * rather than a title; recovering the H1 keeps the site correct without editing
 * `docs/catalog.json`, which `pdks docs` also reads.
 */
function resolveTitle(translation, markdown) {
  if (!translation.title.trimStart().startsWith('<!--')) return translation.title;
  const h1 = markdown.match(/^#\s+(.+)$/m);
  return h1 ? h1[1].trim() : translation.path;
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
 * Strips the H1 and the language-switch line, then rewrites every relative link.
 * Starlight renders the title from frontmatter and supplies its own locale picker,
 * so both would otherwise appear twice.
 */
function transform(markdown, docPath, locale) {
  let body = markdown.replace(/^#[^\n]*\n/, '');
  body = body.replace(/^\s*(\*\*English\*\*|\[English\])[^\n]*\n/m, '');
  body = body.replace(/\]\(([^)\s]+)\)/g, (_match, target) => {
    return `](${rewriteLink(target, docPath, locale)})`;
  });
  return body.trimStart();
}

/** Writes one translated document with catalog-sourced frontmatter. */
async function emit(doc, locale, translation, titles) {
  const source = await readFile(join(DOCS_ROOT, translation.path), 'utf8');
  const title = resolveTitle(translation, source);
  titles.set(`${doc.id}:${locale}`, title);
  const body = transform(source, translation.path, locale);
  const slug = translation.path.replace(/\.ko\.md$/, '.md').replace(/^README\.md$/, 'index.md');
  const outPath =
    locale === 'en' ? join(OUT_ROOT, 'docs', slug) : join(OUT_ROOT, locale, 'docs', slug);
  const updated = await lastCommitDate(translation.path);
  // Astro derives a route from the file path with github-slugger, which drops the dots in
  // names like `v0.7`; the sidebar and rewritten links keep them, so the route is set here.
  const route = toSitePath(translation.path, locale).replace(/^\/|\/$/g, '');
  const frontmatter = [
    '---',
    `title: ${yamlString(title)}`,
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
 * Shortens a build-in-public title for the navigation column. The full title stays on the
 * page; only the sidebar label is trimmed to the post number and its subject.
 */
function sidebarLabel(title) {
  const post = title.match(/#(\d+)[\s,—-]+(.*)$/);
  if (!post) return title;
  const [, n, subject] = post;
  const short = subject.length > 46 ? `${subject.slice(0, 45).trimEnd()}…` : subject;
  return `#${n} ${short}`;
}

/**
 * Builds one sidebar from the catalog's `category` grouping and `order`, carrying the
 * Korean labels as Starlight `translations` rather than as a second sidebar. Starlight
 * resolves the locale itself; a per-locale sidebar would only ever render the default.
 */
function buildSidebar(documents, titles) {
  const groups = new Map();
  for (const doc of documents) {
    if (doc.id === HOME_ID) continue;
    if (!doc.en) continue;
    if (!groups.has(doc.category)) groups.set(doc.category, []);
    groups.get(doc.category).push({
      label: sidebarLabel(titles.get(`${doc.id}:en`) ?? doc.en.title),
      ...(doc.ko
        ? {
            translations: {
              ko: sidebarLabel(titles.get(`${doc.id}:ko`) ?? doc.ko.title),
            },
          }
        : {}),
      link: toSitePath(doc.en.path, 'en'),
      order: doc.order,
    });
  }

  return CATEGORY_ORDER.filter((category) => groups.has(category)).map((category) => ({
    label: CATEGORY_LABELS[category].en,
    translations: { ko: CATEGORY_LABELS[category].ko },
    items: groups
      .get(category)
      .sort((a, b) => a.order - b.order)
      .map(({ order, ...item }) => item),
  }));
}

const catalog = JSON.parse(await readFile(join(DOCS_ROOT, 'catalog.json'), 'utf8'));
const documents = [...catalog.documents].sort((a, b) => a.order - b.order);

await rm(OUT_ROOT, { recursive: true, force: true });
const titles = new Map();
for (const doc of documents) {
  for (const locale of ['en', 'ko']) {
    if (doc[locale]) await emit(doc, locale, doc[locale], titles);
  }
}

const sidebar = buildSidebar(documents, titles);
await mkdir(join(PACKAGE_ROOT, 'src/generated'), { recursive: true });
await writeFile(
  join(PACKAGE_ROOT, 'src/generated/sidebar.json'),
  `${JSON.stringify(sidebar, null, 2)}\n`,
  'utf8',
);

const counted = documents.filter((doc) => doc.ko).length;
console.log(`synced ${documents.length} documents (${counted} bilingual) from docs/`);
