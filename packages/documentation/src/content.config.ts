import { defineCollection } from 'astro:content';
import { docsLoader, i18nLoader } from '@astrojs/starlight/loaders';
import { docsSchema, i18nSchema } from '@astrojs/starlight/schema';

/**
 * Content collections for the documentation site.
 *
 * Astro requires these to be declared explicitly; without this file Starlight finds no
 * documents and every `/docs` route returns 404. The `i18n` collection stays declared
 * even though Starlight supplies its own Korean UI strings, because Starlight queries it
 * regardless and warns on every build when it is absent. Its directory holds a single
 * empty override file to keep the collection non-empty.
 */
export const collections = {
  docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }),
  i18n: defineCollection({ loader: i18nLoader(), schema: i18nSchema() }),
};
