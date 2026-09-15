import type { APIRoute } from 'astro';
import sharp from 'sharp';
import telemetry from '../data/telemetry.json';

/**
 * The social card at the 1200x630 size platforms crop to.
 *
 * It states the figure the page leads with, so a shared link carries the claim rather
 * than a logo. The card is drawn as SVG and rasterised with sharp, because the platforms
 * that render `og:image` do not accept SVG.
 */
const VERDICT_COLOUR: Record<string, string> = {
  blocked: '#e0937a',
  advised: '#8fbf79',
  witnessed: '#7fa8d4',
};

/** Escapes text for inclusion in SVG character data. */
function escapeText(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function card() {
  const rows = telemetry.recent.slice(0, 4).map((r, i) => {
    const y = 452 + i * 40;
    const colour = VERDICT_COLOUR[r.verdict] ?? '#9aa7b4';
    return [
      `<text x="80" y="${y}" class="m" fill="#5f7488">${r.at.slice(11, 19)}</text>`,
      `<text x="210" y="${y}" class="m" fill="${colour}">${escapeText(r.verdict)}</text>`,
      `<text x="350" y="${y}" class="m" fill="#9aa7b4">${escapeText(r.discipline)}</text>`,
    ].join('');
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
  <style>
    .s { font-family: 'IBM Plex Sans', 'Helvetica Neue', Arial, sans-serif; }
    .m { font-family: 'IBM Plex Mono', 'Courier New', monospace; font-size: 21px; }
  </style>
  <rect width="1200" height="630" fill="#0c1117"/>
  <text x="80" y="128" class="s" font-size="30" fill="#9aa7b4">Polydeukes</text>
  <text x="80" y="248" class="s" font-size="72" fill="#e6ecf2">Judge the work,</text>
  <text x="80" y="332" class="s" font-size="72" fill="#e6ecf2">then decide whether to stop it.</text>
  <line x1="80" y1="392" x2="1120" y2="392" stroke="#232c36"/>
  ${rows.join('\n  ')}
  <text x="80" y="596" class="s" font-size="25" fill="#9aa7b4">It stopped the work ${telemetry.stoppedShare}% of the time, across ${telemetry.total.toLocaleString('en-US')} judgments</text>
</svg>`;
}

/**
 * Serves the social card as a PNG at `/og.png`.
 *
 * @returns A 1200x630 image response, cached for an hour.
 */
export const GET: APIRoute = async () => {
  const png = await sharp(Buffer.from(card())).png().toBuffer();
  return new Response(new Uint8Array(png), {
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600' },
  });
};
