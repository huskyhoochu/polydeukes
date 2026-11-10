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
const tags = (html, name) => html.match(new RegExp(`<${name}\\b[^>]*>`, 'g')) ?? [];
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
