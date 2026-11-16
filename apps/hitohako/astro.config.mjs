// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// SITE_URL is injected by .github/workflows/deploy-hitohako.yml.
// Default to the stage URL so that local builds never claim to be production.
const site = process.env.SITE_URL ?? 'https://hitohako-stage.b0xp.io';

// https://astro.build/config
export default defineConfig({
  site,
  vite: {
    plugins: [tailwindcss()],
  },
});
