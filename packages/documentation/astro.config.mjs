// @ts-check
import starlight from '@astrojs/starlight';
import { defineConfig, fontProviders } from 'astro/config';
import sidebar from './src/generated/sidebar.json' with { type: 'json' };

/** The live origin; canonical URLs, the sitemap, and Open Graph tags derive from it. */
const SITE = 'https://polydeukes.vercel.app';

// The sidebar is generated from `docs/catalog.json` by `scripts/sync-docs.mjs`, so a
// document added to the catalog reaches the site without editing this file.
export default defineConfig({
  site: SITE,
  fonts: [
    {
      provider: fontProviders.fontsource(),
      name: 'Space Grotesk',
      cssVariable: '--font-display',
      weights: [400, 550],
      styles: ['normal'],
      subsets: ['latin'],
      fallbacks: ['ui-sans-serif', 'system-ui', 'sans-serif'],
    },
    {
      provider: fontProviders.fontsource(),
      name: 'IBM Plex Sans',
      cssVariable: '--font-text',
      weights: [400, 500, 600],
      styles: ['normal'],
      subsets: ['latin'],
      fallbacks: ['ui-sans-serif', 'system-ui', 'sans-serif'],
    },
    {
      provider: fontProviders.fontsource(),
      name: 'IBM Plex Mono',
      cssVariable: '--font-mono',
      weights: [400, 500],
      styles: ['normal'],
      subsets: ['latin'],
      fallbacks: ['ui-monospace', 'monospace'],
    },
  ],
  integrations: [
    starlight({
      title: 'Polydeukes',
      description:
        'A development discipline framework for building alongside an AI coding partner.',
      defaultLocale: 'root',
      locales: {
        root: { label: 'English', lang: 'en' },
        ko: { label: '한국어', lang: 'ko' },
      },
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/huskyhoochu/polydeukes',
        },
      ],
      head: [
        { tag: 'meta', attrs: { property: 'og:image', content: `${SITE}/og.png` } },
        { tag: 'meta', attrs: { property: 'og:image:width', content: '1200' } },
        { tag: 'meta', attrs: { property: 'og:image:height', content: '630' } },
        {
          tag: 'meta',
          attrs: {
            property: 'og:image:alt',
            content:
              'The Polydeukes headline above four real verdict rows from its own telemetry log.',
          },
        },
        { tag: 'meta', attrs: { name: 'twitter:card', content: 'summary_large_image' } },
        { tag: 'meta', attrs: { name: 'twitter:image', content: `${SITE}/og.png` } },
      ],
      lastUpdated: true,
      editLink: { baseUrl: 'https://github.com/huskyhoochu/polydeukes/edit/main/docs/' },
      components: { Head: './src/components/Head.astro' },
      sidebar,
      customCss: ['./src/styles/custom.css'],
    }),
  ],
});
