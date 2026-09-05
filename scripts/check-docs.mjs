import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
if (args.length !== 0 && (args.length !== 2 || args[0] !== '--root')) {
  console.error('Usage: node scripts/check-docs.mjs [--root directory]');
  process.exit(2);
}
const root = resolve(args[1] ?? join(dirname(fileURLToPath(import.meta.url)), '..'));
const errors = [];
const files = [];
function collect(directory) {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) collect(path);
    else if (entry.isFile() && path.endsWith('.md')) files.push(path);
  }
}
collect(join(root, 'docs'));
for (const name of ['README.md', 'README.ko.md', 'STORY.md', 'STORY.ko.md']) {
  if (existsSync(join(root, name))) files.push(join(root, name));
}
if (existsSync(join(root, 'packages'))) {
  for (const name of readdirSync(join(root, 'packages'))) {
    for (const file of ['README.md', 'README.ko.md']) {
      const path = join(root, 'packages', name, file);
      if (existsSync(path)) files.push(path);
    }
  }
}
if (files.length === 0) errors.push('No public Markdown files found');

function prose(markdown) {
  let fence;
  return markdown
    .replace(/<!--[\s\S]*?-->/g, '')
    .split('\n')
    .map((line) => {
      const marker = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(line);
      if (marker) {
        if (!fence) fence = marker[1];
        else if (
          marker[1][0] === fence[0] &&
          marker[1].length >= fence.length &&
          marker[2].trim() === ''
        )
          fence = undefined;
        return '';
      }
      return fence ? '' : line;
    })
    .join('\n');
}

function stripInlineCode(text) {
  let result = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] !== '`') {
      result += text[i];
      i += 1;
      continue;
    }
    let n = 1;
    while (i + n < text.length && text[i + n] === '`') n += 1;
    let j = i + n;
    let closed = false;
    while (j < text.length) {
      if (text[j] !== '`') {
        j += 1;
        continue;
      }
      let m = 1;
      while (j + m < text.length && text[j + m] === '`') m += 1;
      if (m === n) {
        // A space, not empty: `[label]` and `(url)` on either side must not join into a link.
        result += ' ';
        i = j + m;
        closed = true;
        break;
      }
      j += m;
    }
    if (!closed) {
      result += text.slice(i, i + n);
      i += n;
    }
  }
  return result;
}

function posixRelative(from, to) {
  return relative(from, to).split(sep).join('/');
}

const texts = new Map(files.map((file) => [file, prose(readFileSync(file, 'utf8'))]));
const anchors = new Map();
const explicitAnchors = new Map();
for (const [file, text] of texts) {
  const ids = new Set();
  const explicit = new Set();
  for (const match of text.matchAll(/<a\s+id=["']([^"']+)["'][^>]*>/g)) {
    if (explicit.has(match[1]))
      errors.push(`${posixRelative(root, file)}: duplicate explicit anchor ${match[1]}`);
    explicit.add(match[1]);
    ids.add(match[1]);
  }
  const used = new Map();
  for (const match of text.matchAll(/^#{1,6}\s+(.+)$/gm)) {
    const heading = match[1].replace(/\s+#+\s*$/, '').replace(/<[^>]*>/g, '');
    const slug = heading
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu, '')
      .replace(/\s/g, '-');
    const count = used.get(slug) ?? 0;
    ids.add(count ? `${slug}-${count}` : slug);
    used.set(slug, count + 1);
  }
  anchors.set(file, ids);
  explicitAnchors.set(file, explicit);
  const sibling = file.endsWith('.ko.md')
    ? file.replace(/\.ko\.md$/, '.md')
    : file.replace(/\.md$/, '.ko.md');
  if (!existsSync(sibling))
    errors.push(
      `${posixRelative(root, file)}: missing language pair ${posixRelative(root, sibling)}`,
    );
}
// Declared limit: CommonMark autolinks, images, and HTML hrefs are not extracted.
for (const [file, text] of texts) {
  const linkable = stripInlineCode(text);
  const destinations = [
    ...[...linkable.matchAll(/(?<!!)\[(?:[^\]]*)\]\(([^\s)]+)(?:\s+["'][^\n]*?["'])?\)/g)].map(
      (match) => match[1],
    ),
    ...[...linkable.matchAll(/^\s{0,3}\[[^\]]+\]:\s*(\S+)/gm)].map((match) => match[1]),
  ];
  for (const raw of destinations) {
    const destination = raw.replace(/^<|>$/g, '');
    if (/^[a-z][a-z0-9+.-]*:/i.test(destination) || destination.startsWith('//')) continue;
    const [pathname, fragment] = destination.split('#', 2);
    const target = pathname ? resolve(dirname(file), decodeURIComponent(pathname)) : file;
    const distance = relative(root, target);
    if (distance === '..' || distance.startsWith(`..${sep}`) || isAbsolute(distance)) {
      errors.push(`${posixRelative(root, file)}: link escapes repository: ${raw}`);
    } else if (!existsSync(target)) {
      errors.push(`${posixRelative(root, file)}: missing target: ${raw}`);
    } else if (fragment && target.endsWith('.md') && statSync(target).isFile()) {
      if (!anchors.get(target)?.has(decodeURIComponent(fragment)))
        errors.push(`${posixRelative(root, file)}: missing anchor: ${raw}`);
    }
  }
}

const catalogPath = join(root, 'docs', 'catalog.json');
if (existsSync(catalogPath)) {
  let catalog;
  try {
    catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
  } catch {
    catalog = null;
    errors.push('docs/catalog.json: unreadable JSON');
  }
  if (catalog && typeof catalog === 'object') {
    const docsRoot = join(root, 'docs');
    const listed = new Set();
    const documents = Array.isArray(catalog.documents) ? catalog.documents : [];
    const redirects = Array.isArray(catalog.redirects) ? catalog.redirects : [];
    for (const document of documents) {
      for (const language of ['en', 'ko']) {
        const path = document?.[language]?.path;
        if (typeof path !== 'string' || path === '') continue;
        listed.add(path);
        if (!existsSync(join(docsRoot, ...path.split('/'))))
          errors.push(`docs/catalog.json: missing document path ${path}`);
      }
    }
    for (const redirect of redirects) {
      if (typeof redirect?.path === 'string' && redirect.path !== '') listed.add(redirect.path);
      const target = redirect?.target;
      if (typeof target !== 'string' || target === '') continue;
      if (!existsSync(join(docsRoot, ...target.split('/'))))
        errors.push(`docs/catalog.json: missing redirect target ${target}`);
    }
    for (const file of files) {
      const distance = relative(docsRoot, file);
      if (distance === '..' || distance.startsWith(`..${sep}`) || isAbsolute(distance)) continue;
      const path = distance.split(sep).join('/');
      if (!listed.has(path))
        errors.push(`${posixRelative(root, file)}: not in catalog documents or redirects`);
    }
    const documentsById = new Map(
      documents
        .filter((document) => document && typeof document.id === 'string')
        .map((document) => [document.id, document]),
    );
    for (const [topicId, topic] of Object.entries(catalog.topics ?? {})) {
      if (!topic || !Array.isArray(topic.references)) continue;
      for (const reference of topic.references) {
        const sectionId = reference?.sectionId;
        if (typeof sectionId !== 'string' || sectionId === '') continue;
        const document = documentsById.get(reference.documentId);
        if (!document) {
          errors.push(
            `docs/catalog.json: topic ${topicId} sectionId ${sectionId} names unknown document ${reference.documentId}`,
          );
          continue;
        }
        for (const language of ['en', 'ko']) {
          const path = document[language]?.path;
          if (typeof path !== 'string' || path === '') continue;
          const absolute = join(docsRoot, ...path.split('/'));
          if (!explicitAnchors.get(absolute)?.has(sectionId))
            errors.push(
              `docs/catalog.json: topic ${topicId} sectionId ${sectionId} is not an explicit anchor in ${path}`,
            );
        }
      }
    }
  }
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(
    `Documentation check passed: ${files.length} files, bilingual pairs and local links/anchors.`,
  );
}
