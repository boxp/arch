import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pngSize } from './pixel';

/**
 * Resolves the current hero illustration at build time.
 *
 * The hero is stored content-addressed as `public/illust/hitohako-hero-<hash>.{png,webp}`
 * (written by scripts/make-hero.py). Because the URL changes whenever the picture
 * changes, a redrawn hero can never be served from a browser / CDN cache of the
 * previous one, and the `<picture>` sources and the `<link rel="preload">` always
 * point at the same revision. Exactly one PNG + matching WebP must exist.
 */
export interface Hero {
  png: string;
  webp: string;
  width: number;
  height: number;
}

const DIR = join('public', 'illust');
const PATTERN = /^hitohako-hero-[0-9a-f]{10}\.png$/;

export function heroImage(): Hero {
  const pngs = readdirSync(join(process.cwd(), DIR)).filter((f) => PATTERN.test(f));
  if (pngs.length !== 1) {
    throw new Error(
      `Expected exactly one hitohako-hero-<hash>.png in ${DIR}, found ${pngs.length}: ${pngs.join(', ')}. ` +
        'Regenerate with scripts/make-hero.py.',
    );
  }
  const png = pngs[0];
  const webp = png.replace(/\.png$/, '.webp');
  const files = readdirSync(join(process.cwd(), DIR));
  if (!files.includes(webp)) {
    throw new Error(`Missing ${webp} next to ${png}. Regenerate with scripts/make-hero.py.`);
  }
  const { width, height } = pngSize(join('illust', png));
  return { png: `/illust/${png}`, webp: `/illust/${webp}`, width, height };
}
