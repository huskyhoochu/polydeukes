import type { APIRoute } from 'astro';
import { renderCard } from '../../data/og-card';

/**
 * Serves the Korean social card as a PNG at `/ko/og.png`.
 *
 * @returns A 1200x630 image response, cached for an hour.
 */
export const GET: APIRoute = async ({ request }) => {
  const png = await renderCard('ko', request.url);
  return new Response(new Uint8Array(png), {
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600' },
  });
};
