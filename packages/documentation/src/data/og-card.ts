import { fontData, experimental_getFontFileURL as getFontFileURL } from 'astro:assets';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { create, type Font } from 'fontkitten';
import sharp from 'sharp';
import logoSource from '../assets/logo.svg?raw';
import { chart, PAIRS } from './gemini';
import { cases } from './landing';
import { copy } from './landing-copy';

/**
 * The social card, one per language, drawn as SVG and rasterised with sharp.
 *
 * librsvg ignores embedded `@font-face` and cannot read woff2 through fontconfig, so no text
 * element would use the site's faces. Every glyph is therefore converted to an outline with
 * fontkitten and drawn as a path. Layout is by advance width only, without kerning, which is
 * adequate for a headline of a few lines.
 */

const W = 1200;
const H = 630;
// The site palette (`src/styles/tokens.css`, dark theme).
const SKY = '#1f2232';
const INK = '#eef0fa';
const GRID = '#2c3045';
const ADVISED = '#f5c35f';
const BLOCKED = '#f4847f';

const faces = new Map<string, Promise<Font>>();
const face = (key: string, load: () => Promise<Uint8Array>) => {
  let font = faces.get(key);
  if (!font) {
    font = load().then((bytes) => create(bytes) as Font);
    // A failed load is dropped so the next request retries instead of failing until restart.
    font.catch(() => faces.delete(key));
    faces.set(key, font);
  }
  return font;
};

/**
 * Libre Franklin 800, the site's heading face. The file is found through Astro's Fonts API, so
 * the hashed file name is never written here; the URL it returns is served while the build or
 * the dev server runs.
 */
const libreFranklin = (requestUrl: string) =>
  face('libre-franklin-800', async () => {
    const heading = fontData['--font-display'].find(
      (f) => f.weight === '800' && f.style === 'normal',
    );
    if (!heading) throw new Error('Libre Franklin 800 is not among the configured fonts');
    const response = await fetch(getFontFileURL(heading.src[0].url, requestUrl));
    if (!response.ok) throw new Error(`Libre Franklin 800 fetch returned ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  });

/** Wanted Sans ExtraBold from the npm package, the Korean face (Libre Franklin has no Hangul). */
const wantedSans = () =>
  face('wanted-sans-800', () => {
    const root = createRequire(import.meta.url).resolve('wanted-sans/package.json');
    return readFile(root.replace('package.json', 'fonts/ttf/WantedSans-ExtraBold.ttf'));
  });

const advance = (font: Font, text: string) =>
  font.glyphsForString(text).reduce((sum, g) => sum + g.advanceWidth, 0) / font.unitsPerEm;

/** Glyph outlines for `text` starting at (x, y) on the baseline, as one path element per glyph. */
function outlines(font: Font, text: string, size: number, x: number, y: number) {
  const k = size / font.unitsPerEm;
  let pen = x;
  return font
    .glyphsForString(text)
    .map((g) => {
      const d = g.path.toSVG();
      const at = pen;
      pen += g.advanceWidth * k;
      return d ? `<path transform="translate(${at} ${y}) scale(${k} ${-k})" d="${d}"/>` : '';
    })
    .join('');
}

/** Greedy word wrap into lines no wider than `max` pixels at `size`. */
function wrap(font: Font, text: string, size: number, max: number) {
  const space = advance(font, ' ') * size;
  const lines: string[] = [];
  let line = '';
  let width = 0;
  for (const word of text.split(' ')) {
    const w = advance(font, word) * size;
    if (line && width + space + w > max) {
      lines.push(line);
      line = word;
      width = w;
    } else {
      line = line ? `${line} ${word}` : word;
      width = line === word ? w : width + space + w;
    }
  }
  return [...lines, line];
}

function sky() {
  const w = {
    width: 600,
    height: H,
    raLeft: 8.1,
    raRight: 5.9,
    decTop: 40,
    decBottom: 8,
    faintest: 5.2,
    bulge: 0.7,
  };
  const c = chart(w);
  const star = (name: string) => c.stars.find((s) => s.name === name);
  const pairs = PAIRS.flatMap((p, i) => {
    const code = star(p.code);
    const record = star(p.record);
    return code && record
      ? [{ code, record, color: cases[i]?.verdict === 'blocked' ? BLOCKED : ADVISED }]
      : [];
  });
  const marked = new Set(pairs.flatMap((p) => [p.code.name, p.record.name]));
  return `<g transform="translate(${W - w.width} 0)" clip-path="url(#sky)">
  ${c.grid.map((d) => `<path d="${d}" fill="none" stroke="${GRID}" stroke-width="1"/>`).join('')}
  <g fill="${INK}">${c.field.map((f) => `<circle cx="${f.x}" cy="${f.y}" r="${f.r}" opacity="${f.opacity * 0.6}"/>`).join('')}</g>
  ${c.lines.map((d) => `<path d="${d}" fill="none" stroke="${INK}" stroke-width="1.4" opacity="0.85"/>`).join('')}
  <g fill="${INK}">${c.stars
    .filter((s) => !marked.has(s.name))
    .map((s) => `<circle cx="${s.x}" cy="${s.y}" r="${s.r}"/>`)
    .join('')}</g>
  ${pairs
    .map(
      (p) => `<g color="${p.color}">
    <line x1="${p.code.x}" y1="${p.code.y}" x2="${p.record.x}" y2="${p.record.y}" stroke="${p.color}" stroke-width="1.4" stroke-dasharray="2 5" stroke-linecap="round"/>
    <circle cx="${p.code.x}" cy="${p.code.y}" r="${p.code.r}" fill="${INK}"/>
    <circle cx="${p.record.x}" cy="${p.record.y}" r="${p.record.r + 7}" fill="none" stroke="${p.color}" stroke-width="1.5"/>
    <circle cx="${p.record.x}" cy="${p.record.y}" r="${p.record.r}" fill="${p.color}"/>
  </g>`,
    )
    .join('')}
</g>`;
}

/**
 * Renders the card for one language.
 *
 * @param lang - Which language's hero title to set.
 * @param requestUrl - The request URL, which Astro needs to locate font files in dev.
 * @returns The 1200x630 PNG.
 */
export async function renderCard(lang: 'en' | 'ko', requestUrl: string): Promise<Buffer> {
  const brand = await libreFranklin(requestUrl);
  const headline = lang === 'ko' ? await wantedSans() : brand;
  const left = 64;
  const column = 560;

  const title = copy[lang].heroTitle;
  let size = 76;
  while (size > 40 && wrap(headline, title, size, column).length > 3) size -= 2;
  const lines = wrap(headline, title, size, column);
  const lineHeight = size * 1.14;
  const top = 170 + (396 - lines.length * lineHeight) / 2;

  const logoHeight = 52;
  const logoWidth = (logoHeight * 871.511) / 1024;
  const logoPaths = [...logoSource.matchAll(/<path\b[^>]*\sd="([^"]*)"/g)].map((m) => m[1]);
  const wordSize = 30;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs><clipPath id="sky"><rect width="${W}" height="${H}"/></clipPath></defs>
<rect width="${W}" height="${H}" fill="${SKY}"/>
${sky()}
<g fill="${INK}" fill-rule="evenodd">
  <g transform="translate(${left} 60) scale(${logoHeight / 1024})">${logoPaths.map((d) => `<path d="${d}"/>`).join('')}</g>
  ${outlines(brand, 'Polydeukes', wordSize, left + logoWidth + 18, 60 + logoHeight / 2 + wordSize * 0.36)}
  ${lines.map((line, i) => outlines(headline, line, size, left, top + lineHeight * i + size * 0.8)).join('')}
</g>
</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
