#!/usr/bin/env node
// Checks that each recipe document in docs/catalog.json (category "recipes") says the same thing
// in both languages and the same thing as its conformance cases. It runs no judge; the cases are
// run by scripts/verify-covenant-fixtures.mjs.
// Usage: node scripts/verify-recipes.mjs
//
// For each document, with <entry id> read from the `- id:` line of its YAML block, the checks are:
//   - the first fenced block whose info string starts with `yaml` is identical in en and ko and
//     starts with its list key, `disciplines:` or `sessionDisciplines:`, so it is a whole
//     configuration file as written
//   - the first fenced block of the section anchored `agent-prompt` contains the YAML block
//   - conformance/covenant/recipes/<entry id>/*.json exist, and in each the config file
//     tree["polydeukes.config.yaml"] is exactly the YAML block + "\n"
//   - every expect.stderr string of each case occurs in the section anchored `try-it`
// A section starts at `<a id="..."></a>` and ends at the next anchor line or the next heading of
// the same or a higher level. Every failure is printed on its own line; exit 1 if there is any.
// RECIPES_ROOT overrides the repository root.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(
  process.env.RECIPES_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), '..'),
);
const failures = [];
const fail = (message) => failures.push(message);

// Lines of a markdown file, each tagged with whether it sits inside a fenced block (fence lines
// included). A fence closes on the same character with at least the opening length.
function scan(markdown) {
  let fence;
  return markdown.split('\n').map((text) => {
    const marker = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(text);
    if (!fence && marker) {
      fence = marker[1];
      return { text, fenced: true };
    }
    if (
      fence &&
      marker &&
      marker[1][0] === fence[0] &&
      marker[1].length >= fence.length &&
      marker[2].trim() === ''
    ) {
      fence = undefined;
      return { text, fenced: true };
    }
    return { text, fenced: fence !== undefined };
  });
}

// Fenced blocks in `lines` as { info, body, start } in order, where body joins the lines between
// the fences with "\n" and start is the index of the opening fence line.
function blocks(lines) {
  const found = [];
  for (let i = 0; i < lines.length; i++) {
    const open = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(lines[i].text);
    if (!open) continue;
    const body = [];
    let j = i + 1;
    while (j < lines.length) {
      const close = /^\s{0,3}(`{3,}|~{3,})\s*$/.exec(lines[j].text);
      if (close && close[1][0] === open[1][0] && close[1].length >= open[1].length) break;
      body.push(lines[j].text);
      j++;
    }
    found.push({ info: open[2].trim(), body: body.join('\n'), start: i });
    i = j;
  }
  return found;
}

function section(lines, id) {
  const anchor = lines.findIndex(
    (l) => !l.fenced && new RegExp(`^\\s*<a\\s+id=["']${id}["'][^>]*>\\s*</a>\\s*$`).test(l.text),
  );
  if (anchor === -1) return undefined;
  const heading = lines.findIndex((l, i) => i > anchor && !l.fenced && /^#{1,6}\s/.test(l.text));
  if (heading === -1) return [];
  const level = /^(#+)/.exec(lines[heading].text)[1].length;
  let end = lines.length;
  for (let i = heading + 1; i < lines.length; i++) {
    if (lines[i].fenced) continue;
    const next = /^(#+)\s/.exec(lines[i].text);
    if ((next && next[1].length <= level) || /^\s*<a\s+id=/.test(lines[i].text)) {
      end = i;
      break;
    }
  }
  return lines.slice(anchor, end);
}

const catalogPath = join(root, 'docs', 'catalog.json');
const catalog = existsSync(catalogPath) ? JSON.parse(readFileSync(catalogPath, 'utf8')) : {};
const recipes = (catalog.documents ?? []).filter((d) => d.category === 'recipes');
if (recipes.length === 0) {
  console.error('verify-recipes: docs/catalog.json has no document with category "recipes"');
  process.exit(1);
}

for (const doc of recipes) {
  const pages = {};
  for (const lang of ['en', 'ko']) {
    const path = doc[lang]?.path;
    const file = path && join(root, 'docs', ...path.split('/'));
    if (!file || !existsSync(file)) {
      fail(`${doc.id} [${lang}]: document file is missing`);
      continue;
    }
    const lines = scan(readFileSync(file, 'utf8'));
    const yaml = blocks(lines).find((b) => b.info.startsWith('yaml'));
    if (!yaml) {
      fail(`${doc.id} [${lang}]: no fenced yaml block`);
      continue;
    }
    pages[lang] = { lines, yaml };
  }

  const yaml = pages.en?.yaml.body;
  if (pages.en && pages.ko && pages.en.yaml.body !== pages.ko.yaml.body)
    fail(`${doc.id}: the yaml block differs between en and ko`);

  if (yaml && !/^(sessionDisciplines|disciplines):\n/.test(yaml))
    fail(`${doc.id}: the yaml block does not start with disciplines: or sessionDisciplines:`);

  for (const [lang, page] of Object.entries(pages)) {
    const prompt = section(page.lines, 'agent-prompt');
    const block = prompt && blocks(prompt)[0];
    if (!block) fail(`${doc.id} [${lang}]: no code block in the agent-prompt section`);
    else if (!block.body.includes(page.yaml.body))
      fail(`${doc.id} [${lang}]: the agent-prompt block does not contain the yaml block`);
  }

  const entry = yaml && /^\s*-\s+id:\s*["']?([^"'\s]+)/m.exec(yaml)?.[1];
  if (yaml && !entry) fail(`${doc.id}: the yaml block has no "- id:" line`);
  if (!entry) continue;

  const casesDir = join(root, 'conformance', 'covenant', 'recipes', entry);
  const cases = existsSync(casesDir)
    ? readdirSync(casesDir)
        .filter((name) => name.endsWith('.json'))
        .sort()
    : [];
  if (cases.length === 0) fail(`${doc.id}: no conformance case in recipes/${entry}/`);
  for (const name of cases) {
    const spec = JSON.parse(readFileSync(join(casesDir, name), 'utf8'));
    const config = spec.tree?.['polydeukes.config.yaml'];
    if (config !== `${yaml}\n`)
      fail(`${doc.id} ${name}: polydeukes.config.yaml is not the yaml block`);
    for (const [lang, page] of Object.entries(pages)) {
      const tryIt = section(page.lines, 'try-it');
      const text = tryIt?.map((l) => l.text).join('\n');
      if (text === undefined) {
        fail(`${doc.id} [${lang}] ${name}: no try-it section`);
        continue;
      }
      for (const expected of spec.expect?.stderr ?? [])
        if (!text.includes(expected))
          fail(
            `${doc.id} [${lang}] ${name}: try-it section lacks stderr ${JSON.stringify(expected)}`,
          );
    }
  }
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(
  `Recipes check passed: ${recipes.length} document(s), en and ko, with their conformance cases.`,
);
