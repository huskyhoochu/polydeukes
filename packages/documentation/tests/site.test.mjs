import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const origin = 'https://polydeukes.vercel.app';
const landingUrl = `${origin}/`;

const read = (rel) => readFileSync(join(dist, rel), 'utf8');

// Attribute order and self-closing vary in the built HTML, so each tag is
// matched whole and its attributes are read individually.
// A quoted attribute value may hold `>` (a regex inside a copy button's code), so the tag ends outside quotes.
const tags = (html, name) => html.match(new RegExp(`<${name}\\b(?:[^>"]|"[^"]*")*>`, 'g')) ?? [];
const attr = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];

const alternates = (html) =>
  tags(html, 'link')
    .filter((t) => attr(t, 'rel') === 'alternate' && attr(t, 'hreflang') !== undefined)
    .map((t) => ({ hreflang: attr(t, 'hreflang'), href: attr(t, 'href') }));

const distFileForUrl = (href) => {
  const path = new URL(href).pathname;
  return path.endsWith('/') ? `${path.slice(1)}index.html` : path.slice(1);
};

describe('landing page', () => {
  const html = read('index.html');

  it('declares Rust as the programming language of the source code node', () => {
    // Catches a stale structured-data language that contradicts the shipped executable.
    const block = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    assert.ok(block, 'landing has a JSON-LD script');
    const node = JSON.parse(block[1])['@graph'].find((n) => n['@type'] === 'SoftwareSourceCode');
    assert.ok(node, 'graph has a SoftwareSourceCode node');
    assert.equal(node.programmingLanguage, 'Rust');
  });

  it('only annotates alternates that annotate the landing page back', () => {
    // Catches one-way hreflang: a target page that does not point back makes search engines ignore the pair.
    for (const { href } of alternates(html)) {
      const targetFile = distFileForUrl(href);
      assert.ok(existsSync(join(dist, targetFile)), `${targetFile} exists`);
      const back = alternates(read(targetFile)).map((a) => a.href);
      assert.ok(
        back.includes(landingUrl),
        `${href} has an hreflang annotation pointing at ${landingUrl}`,
      );
    }
  });
});

describe('robots.txt', () => {
  it('allows all agents and names a sitemap that exists in the build', () => {
    // Catches a missing robots.txt, or a Sitemap line that points at a file the build does not emit.
    assert.ok(existsSync(join(dist, 'robots.txt')), 'robots.txt exists');
    const lines = read('robots.txt')
      .split(/\r?\n/)
      .map((l) => l.trim());
    assert.ok(lines.includes('User-agent: *'));
    assert.ok(lines.includes('Allow: /'));
    const sitemap = `${origin}/sitemap-index.xml`;
    assert.ok(lines.includes(`Sitemap: ${sitemap}`));
    assert.ok(existsSync(join(dist, new URL(sitemap).pathname.slice(1))), 'sitemap file exists');
  });
});

describe('404 page', () => {
  it('links to the English and Korean documentation roots', () => {
    // Catches a dead-end 404 that gives a lost visitor no way into either language's docs.
    const hrefs = tags(read('404.html'), 'a').map((t) => attr(t, 'href'));
    assert.ok(hrefs.includes('/docs/'), 'links to /docs/');
    assert.ok(hrefs.includes('/ko/docs/'), 'links to /ko/docs/');
  });
});

// Expressive Code stores a block's copy text in `data-code`, with HTML entities for markup
// characters and U+007F in place of each newline.
const decodeCode = (value) =>
  value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replaceAll('\u007f', '\n');

describe('recipe pages', () => {
  const docsRoot = fileURLToPath(new URL('../../../docs/', import.meta.url));
  const listed = JSON.parse(readFileSync(join(docsRoot, 'catalog.json'), 'utf8')).documents.filter(
    (d) => d.category === 'recipes',
  );
  const recipes = listed.filter((d) => d.id !== 'recipes');
  const pageOf = (doc, lang) =>
    `${lang === 'ko' ? 'ko/docs/' : 'docs/'}${doc[lang].path.replace(/(\.ko)?\.md$/, '').replace(/(^|\/)index$/, '')}`;

  for (const lang of ['en', 'ko']) {
    it(`the list page [${lang}] links every recipe page`, () => {
      // Catches a recipe that was published without a row on the list page, or a link the build rewrote wrongly.
      const list = listed.find((d) => d.id === 'recipes');
      assert.ok(list, 'the catalog has the list page');
      const html = read(`${pageOf(list, lang)}/index.html`);
      const hrefs = tags(html, 'a').map((t) => attr(t, 'href') ?? '');
      for (const recipe of recipes) {
        const target = `/${pageOf(recipe, lang)}/`;
        assert.ok(hrefs.includes(target), `no link to ${target}`);
      }
    });
  }

  it('the catalog lists at least one recipe', () => {
    // Without this the loop below would define no test and the suite would pass over nothing.
    assert.ok(recipes.length > 0);
  });

  for (const recipe of recipes) {
    for (const lang of ['en', 'ko']) {
      const source = recipe[lang].path;
      const page = `${pageOf(recipe, lang)}/index.html`;
      it(`${recipe.id} [${lang}] carries copy buttons and copies its YAML verbatim from the first code block`, () => {
        // Catches a page that drops the copy buttons, or a build that alters the YAML a reader pastes into the config.
        const yaml = readFileSync(join(docsRoot, source), 'utf8').match(
          /^```yaml[^\n]*\n([\s\S]*?)\n```$/m,
        )?.[1];
        assert.ok(yaml, 'the source document has a yaml block');
        assert.ok(existsSync(join(dist, page)), `${page} exists`);
        const buttons = tags(read(page), 'button').filter(
          (t) => attr(t, 'data-copied') !== undefined,
        );
        assert.ok(buttons.length >= 2, `${buttons.length} copy buttons, expected at least 2`);
        assert.equal(decodeCode(attr(buttons[0], 'data-code') ?? ''), yaml);
      });
    }
  }
});

describe('documentation page', () => {
  it('keeps a self canonical and the en, ko and x-default alternates', () => {
    // Catches a site configuration change that drops a documentation page's own canonical or alternates.
    const html = read('docs/how-to/install/index.html');
    const self = `${origin}/docs/how-to/install/`;
    const canonical = tags(html, 'link').find((t) => attr(t, 'rel') === 'canonical');
    assert.equal(attr(canonical, 'href'), self);
    const byLang = Object.fromEntries(alternates(html).map((a) => [a.hreflang, a.href]));
    assert.equal(byLang.en, self);
    assert.equal(byLang.ko, `${origin}/ko/docs/how-to/install/`);
    assert.equal(byLang['x-default'], self);
  });
});

describe('tabbed pages', () => {
  const docsRoot = fileURLToPath(new URL('../../../docs/', import.meta.url));
  const tabbed = JSON.parse(readFileSync(join(docsRoot, 'catalog.json'), 'utf8')).documents.filter(
    (d) => d.tabs,
  );

  // The text of the section that starts at `<a id="name"></a>`, up to the next anchor.
  const section = (markdown, name) => {
    const start = markdown.indexOf(`<a id="${name}"></a>`);
    assert.notEqual(start, -1, `source has an anchor named ${name}`);
    const rest = markdown.slice(start + 1);
    const next = rest.indexOf('<a id="');
    return next === -1 ? rest : rest.slice(0, next);
  };
  const heading = (markdown, name) =>
    section(markdown, name)
      .match(/^### (.+)$/m)?.[1]
      .trim();
  const firstFence = (markdown) => markdown.match(/^```[^\n]*\n([\s\S]*?)\n```$/m)?.[1];

  // Each panel is a div with role="tabpanel"; its HTML runs to the next panel or the end of the group.
  const panels = (html) => {
    const group = html.slice(html.indexOf('<starlight-tabs'), html.indexOf('</starlight-tabs>'));
    const starts = [...group.matchAll(/<div\b[^>]*role="tabpanel"[^>]*>/g)].map((m) => m.index);
    return starts.map((s, i) => group.slice(s, starts[i + 1] ?? group.length));
  };
  const tabLabels = (html) =>
    (html.match(/<a\b[^>]*role="tab"[^>]*>[\s\S]*?<\/a>/g) ?? []).map((t) =>
      t
        .replace(/<[^>]*>/g, '')
        .replace(/\s+/g, ' ')
        .trim(),
    );

  it('the catalog lists the tabs of each tabbed document in order', () => {
    // Every check below derives its expectation from these lists, so a tab dropped from one would go unnoticed.
    assert.deepEqual(Object.fromEntries(tabbed.map((d) => [d.id, d.tabs])), {
      'git-hooks': ['plain-hook', 'lefthook', 'husky', 'pre-commit'],
      install: ['homebrew', 'cargo', 'npm', 'pypi'],
    });
  });

  for (const [doc, lang, prefix] of tabbed.flatMap((d) => [
    [d, 'en', 'docs/'],
    [d, 'ko', 'ko/docs/'],
  ])) {
    const english = readFileSync(join(docsRoot, doc.en.path), 'utf8');
    const source = readFileSync(join(docsRoot, doc[lang].path), 'utf8');
    const page = `${prefix}${doc[lang].path.replace(/(\.ko)?\.md$/, '')}/index.html`;
    // The first anchor after the last tab section names the section that must stay outside the group.
    const following = english
      .slice(english.indexOf(`<a id="${doc.tabs.at(-1)}"></a>`) + 1)
      .match(/<a id="([^"]+)"><\/a>/)?.[1];
    const name = `${doc.id} [${lang}]`;

    it(`${name} renders one tab group whose labels are the section headings in catalog order`, () => {
      // Catches a page with no tab group, a reordered or dropped tab, or a label that is not the source heading.
      const html = read(page);
      assert.equal(html.match(/<starlight-tabs\b(?!-)/g)?.length, 1, 'exactly one tab group');
      assert.equal(
        html.match(/data-sync-key="([^"]*)"/)?.[1],
        doc.id,
        'group syncs on the document id',
      );
      const expected = doc.tabs.map((name) => heading(source, name));
      assert.ok(expected.every(Boolean), 'every tab section has a heading in the source');
      assert.deepEqual(tabLabels(html), expected);
    });

    it(`${name} keeps headings out of the panels and the following section out of the group`, () => {
      // Catches a tab that repeats its label as a heading, or a group that swallows the rest of the page.
      const html = read(page);
      const found = panels(html);
      assert.equal(found.length, doc.tabs.length, 'one panel per tab');
      for (const panel of found) assert.ok(!/<h3\b/.test(panel), 'no section heading in a panel');
      const end = html.indexOf('</starlight-tabs>');
      assert.ok(following, 'the source has a section after the tab sections');
      assert.ok(
        html.indexOf(`id="${following}"`) > end,
        `the ${following} section follows the group`,
      );
    });

    it(`${name} keeps each tab section's anchor ahead of the group`, () => {
      // Catches a link to a route's fragment landing at the top of the page because its id went with the heading.
      const html = read(page);
      const group = html.indexOf('<starlight-tabs');
      for (const name of doc.tabs) {
        const at = html.indexOf(`id="${name}"`);
        assert.ok(at !== -1 && at < group, `id="${name}" precedes the tab group`);
      }
    });

    it(`${name} copies the first code block of each section verbatim from the English source`, () => {
      // Catches a tab whose panel holds another section's code, or code altered by the conversion.
      const found = panels(read(page));
      assert.equal(found.length, doc.tabs.length, 'one panel per tab');
      doc.tabs.forEach((name, i) => {
        const expected = firstFence(section(english, name));
        assert.ok(expected, `${name} has a code block in the English source`);
        const button = tags(found[i], 'button').find((t) => attr(t, 'data-copied') !== undefined);
        assert.ok(button, `panel ${name} has a copy button`);
        assert.equal(decodeCode(attr(button, 'data-code') ?? ''), expected);
      });
    });
  }
});

describe('sidebar', () => {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const catalog = JSON.parse(readFileSync(join(root, 'docs/catalog.json'), 'utf8'));
  const sidebar = JSON.parse(
    readFileSync(join(root, 'packages/documentation/src/generated/sidebar.json'), 'utf8'),
  );
  const categories = catalog.categories ?? [];

  // Mirrors the English route of a source path.
  const linkOf = (path) => {
    const slug = path.replace(/\.md$/, '').replace(/(^|\/)index$/, '');
    return slug === 'README' ? '/docs/' : `/docs/${slug}/`;
  };
  const links = (items) => items.flatMap((i) => (i.items ? links(i.items) : [i.link]));
  const idsIn = (category) =>
    catalog.documents
      .filter((d) => d.category === category)
      .sort((a, b) => a.order - b.order)
      .map((d) => d.id);

  it('has one top-level group per catalog category, in order, with the Korean label', () => {
    // Catches a sidebar that keeps hardcoded labels or order instead of reading the catalog.
    assert.ok(categories.length > 0, 'the catalog has categories');
    assert.deepEqual(
      sidebar.map((g) => g.label),
      categories.map((c) => c.en),
    );
    assert.deepEqual(
      sidebar.map((g) => g.translations?.ko),
      categories.map((c) => c.ko),
    );
  });

  it('lists the catalog documents of each category sorted by order', () => {
    // Catches a document placed in the wrong group, or a group ordered other than by `order`.
    assert.ok(categories.length > 0, 'the catalog has categories');
    for (const [i, category] of categories.entries()) {
      const expected = catalog.documents
        .filter((d) => d.category === category.id)
        .sort((a, b) => a.order - b.order)
        .map((d) => linkOf(d.en.path));
      const listed = links(sidebar[i]?.items ?? []);
      // A reference subgroup sits at its first member's position, so its members leave catalog order.
      if (category.id === 'reference') assert.deepEqual(listed.toSorted(), expected.toSorted());
      else assert.deepEqual(listed, expected, category.id);
    }
  });

  it('places the task-oriented documents in the named categories', () => {
    // Catches a catalog edited wrongly, which would make the comparison above agree with itself.
    assert.deepEqual(
      categories.map((c) => c.id),
      ['start', 'recipes', 'choose', 'help', 'reference', 'reading'],
    );
    assert.deepEqual(
      categories.map((c) => c.en),
      ['Get started', 'Recipes', 'Choose a tool', 'Help', 'Reference', 'Further reading'],
    );
    assert.deepEqual(idsIn('start'), [
      'install',
      'first-judgment',
      'connect-surfaces',
      'configure-project',
    ]);
    assert.deepEqual(idsIn('choose'), ['when-to-use']);
    assert.deepEqual(idsIn('help'), [
      'troubleshooting',
      'write-disciplines',
      'git-hooks',
      'use-memory',
      'migrate-to-rust',
      'contributing-docs',
    ]);
    assert.deepEqual(idsIn('reading'), ['concepts', 'why-polydeukes']);
  });

  it('the documentation home sections are the catalog categories, in order, in both languages', () => {
    // Catches a category renamed or reordered in the catalog while the home page keeps its old sections.
    for (const [file, lang] of [
      ['docs/README.md', 'en'],
      ['docs/README.ko.md', 'ko'],
    ]) {
      const sections = readFileSync(join(root, file), 'utf8')
        .split('\n')
        .filter((line) => line.startsWith('## '))
        .map((line) => line.slice(3).trim());
      assert.deepEqual(
        sections,
        categories.map((c) => c[lang]),
        file,
      );
    }
  });

  it('renders the six Korean category names as sidebar group labels, in order', () => {
    // Catches a rendered sidebar that kept old labels even though sidebar.json is correct.
    const html = read('ko/docs/how-to/install/index.html');
    const labels = [
      ...html.matchAll(
        /<summary\b[^>]*><span class="group-label[^"]*"><span class="large[^"]*">([^<]*)<\/span>/g,
      ),
    ].map((m) => m[1]);
    const expected = categories.map((c) => c.ko);
    assert.equal(expected.length, 6);
    assert.deepEqual(
      labels.filter((l) => expected.includes(l)),
      expected,
    );
  });
});

describe('Korean pages', () => {
  const docsRoot = fileURLToPath(new URL('../../../docs/', import.meta.url));
  const translated = JSON.parse(
    readFileSync(join(docsRoot, 'catalog.json'), 'utf8'),
  ).documents.filter((d) => d.ko);

  it('render without a language-switch line', () => {
    // Catches a switch line in a form the converter does not strip, which leaves an English link beside the site's own picker.
    assert.ok(translated.length > 0);
    const kept = translated
      .map((d) => d.ko.path.replace(/\.ko\.md$/, '').replace(/(^|\/)(README|index)$/, ''))
      .map((slug) => (slug ? `ko/docs/${slug}/index.html` : 'ko/docs/index.html'))
      .filter((page) => read(page).includes('>English</a>'));
    assert.deepEqual(kept, []);
  });
});

describe('rebuilt landing pages', () => {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const landings = [
    {
      lang: 'en',
      file: 'index.html',
      url: `${origin}/`,
      other: '/ko/',
      otherLang: 'ko',
      prefix: '',
    },
    {
      lang: 'ko',
      file: 'ko/index.html',
      url: `${origin}/ko/`,
      other: '/',
      otherLang: 'en',
      prefix: '/ko',
    },
  ];
  const sectionIds = ['hero', 'cases', 'name', 'recipes', 'install', 'choose', 'further'];

  // Reads a built page, failing with a message instead of a thrown ENOENT when it is missing.
  const page = (rel) => {
    assert.ok(existsSync(join(dist, rel)), `dist/${rel} exists`);
    return read(rel);
  };
  const text = (html) =>
    decodeCode(html.replace(/<(script|style)\b[\s\S]*?<\/\1>/g, '').replace(/<[^>]*>/g, ''))
      .replace(/\s+/g, ' ')
      .trim();
  const mainOf = (html) => {
    const main = html.match(/<main\b[\s\S]*?<\/main>/)?.[0];
    assert.ok(main, 'page has a <main> element');
    return main;
  };
  // Each section runs from its own tag to the next section's tag (or the end of <main>).
  const sections = (html) => {
    const main = mainOf(html);
    const starts = [...main.matchAll(/<section\b(?:[^>"]|"[^"]*")*>/g)].map((m) => ({
      id: attr(m[0], 'id'),
      at: m.index,
    }));
    return starts.map((s, i) => ({ id: s.id, html: main.slice(s.at, starts[i + 1]?.at) }));
  };
  const sectionHtml = (html, id) => {
    const found = sections(html).find((s) => s.id === id);
    assert.ok(found, `page has a <section id="${id}">`);
    return found.html;
  };
  const headerOf = (html) => {
    const header = html.match(/<header\b[\s\S]*?<\/header>/)?.[0];
    assert.ok(header, 'page has a <header> element');
    return header;
  };

  for (const { lang, file, url, other, otherLang, prefix } of landings) {
    it(`[${lang}] sets its own html lang, canonical and the shared hreflang alternates`, () => {
      // Catches a Korean landing that reuses the English canonical or lang, or alternates that differ between the pair.
      const html = page(file);
      assert.equal(
        html.match(/<html\b[^>]*>/)?.[0] && attr(html.match(/<html\b[^>]*>/)[0], 'lang'),
        lang,
      );
      const canonical = tags(html, 'link').find((t) => attr(t, 'rel') === 'canonical');
      assert.ok(canonical, 'has a canonical link');
      assert.equal(attr(canonical, 'href'), url);
      const byLang = Object.fromEntries(alternates(html).map((a) => [a.hreflang, a.href]));
      assert.deepEqual(byLang, {
        en: `${origin}/`,
        ko: `${origin}/ko/`,
        'x-default': `${origin}/`,
      });
      assert.equal(alternates(html).length, 3);
    });

    it(`[${lang}] has the seven sections in order inside main`, () => {
      // Catches a missing, renamed or reordered section, which breaks in-page navigation.
      assert.deepEqual(
        sections(page(file)).map((s) => s.id),
        sectionIds,
      );
    });

    it(`[${lang}] links to the other language with its hreflang`, () => {
      // Catches a language switch without hreflang or pointing at the wrong page.
      const link = tags(page(file), 'a').find(
        (t) => attr(t, 'href') === other && attr(t, 'hreflang') === otherLang,
      );
      assert.ok(link, `an <a href="${other}" hreflang="${otherLang}"> exists`);
    });

    for (const caseFile of [
      'conformance/covenant/recipes/dependency-edits-follow-lookups/hono-upgrade-without-lookups-advised.json',
      'conformance/covenant/recipes/comments-stay-short/narrating-comment-run-advised.json',
      'conformance/covenant/recipes/migrations-are-generated/edited-migration-blocked.json',
      'conformance/covenant/recipes/packages-meet-at-the-entry-point/deep-import-into-other-package-blocked.json',
    ]) {
      it(`[${lang}] shows the real stderr of ${caseFile.split('/').at(-1)} in the cases section`, () => {
        // Catches case output that was retyped and drifted from what the judge prints.
        const { stderr } = JSON.parse(readFileSync(join(root, caseFile), 'utf8')).expect;
        assert.ok(stderr.length > 0, 'the case has stderr lines');
        const shown = text(sectionHtml(page(file), 'cases'));
        for (const line of stderr) {
          assert.ok(
            shown.includes(line.replace(/\s+/g, ' ').trim()),
            `cases section lacks: ${line}`,
          );
        }
      });
    }

    it(`[${lang}] links the three featured recipes`, () => {
      // Catches a recipe card linking to the English page from the Korean landing, or to a moved page.
      const hrefs = tags(sectionHtml(page(file), 'recipes'), 'a').map((t) => attr(t, 'href'));
      for (const slug of [
        'document-read-before-edit',
        'few-test-runs-per-edit',
        'tests-are-the-writers',
      ]) {
        const target = `${prefix}/docs/recipes/${slug}/`;
        assert.ok(hrefs.includes(target), `no link to ${target}`);
      }
    });

    it(`[${lang}] shows the first brew install line of the install guide as code`, () => {
      // Catches an install command that drifted from the install guide.
      const command = readFileSync(join(root, 'docs/how-to/install.md'), 'utf8')
        .split('\n')
        .find((l) => l.startsWith('brew install '));
      assert.ok(command, 'the install guide has a brew install line');
      const codes = (
        sectionHtml(page(file), 'install').match(/<code\b[^>]*>[\s\S]*?<\/code>/g) ?? []
      ).map(text);
      assert.ok(codes.includes(command.trim()), `no <code> reads exactly: ${command}`);
    });

    it(`[${lang}] resolves every internal link to a built file`, () => {
      // Catches a landing link to a page the build does not emit.
      const missing = tags(page(file), 'a')
        .map((t) => attr(t, 'href'))
        .filter((h) => h?.startsWith('/') && !h.startsWith('//'))
        .map((h) => h.replace(/[#?].*$/, ''))
        .map((p) => (p.endsWith('/') ? `${p.slice(1)}index.html` : p.slice(1)))
        .filter((p) => !existsSync(join(dist, p)));
      assert.deepEqual(missing, []);
    });
  }

  describe('logo', () => {
    const paths = (svg) => [...svg.matchAll(/<path\b[^>]*\sd="([^"]*)"/g)].map((m) => m[1]);
    const logo = paths(
      readFileSync(join(root, 'packages/documentation/src/assets/logo.svg'), 'utf8'),
    );

    for (const file of ['index.html', 'ko/index.html', 'docs/how-to/install/index.html']) {
      it(`draws the logo paths in the first header of ${file}`, () => {
        // Catches a header still showing an old mark.
        const header = headerOf(page(file));
        assert.ok(logo.length > 0, 'the logo source has paths');
        for (const d of logo) assert.ok(header.includes(d), 'header lacks a logo path');
      });
    }

    it('the favicon consists of exactly the logo paths', () => {
      // Catches a favicon that still draws the old mark or only half of the new one.
      const favicon = paths(
        readFileSync(join(root, 'packages/documentation/public/favicon.svg'), 'utf8'),
      );
      assert.ok(logo.length > 0, 'the logo source has paths');
      assert.deepEqual([...favicon].sort(), [...logo].sort());
    });
  });
});
