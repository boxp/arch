// @ts-check
import { defineConfig, envField } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

// SITE_URL: canonical / OGP / sitemap に使う公開 URL。stage では https://portfolio-stage.b0xp.io を渡す。
// SITE_ENV: production | stage。stage では noindex メタ・robots.txt Disallow・stage バナーを出す。
const site = process.env.SITE_URL ?? 'https://b0xp.io';

// https://astro.build/config
export default defineConfig({
  site,
  trailingSlash: 'never',
  integrations: [sitemap()],
  env: {
    schema: {
      SITE_ENV: envField.enum({
        context: 'server',
        access: 'public',
        values: ['production', 'stage'],
        default: 'production',
      }),
    },
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
