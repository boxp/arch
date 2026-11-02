import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Resolves the current hero key visual at build time.
 *
 * The hero is stored content-addressed under `public/illust/` (written by
 * scripts/make-hero.py from the finished illustration, which is never redrawn):
 *   hitohako-hero-<hash>.jpg         byte-identical original (fallback `src`)
 *   hitohako-hero-<hash>-<w>w.webp   responsive WebP candidates (`srcset`)
 * where <hash> is the first 10 hex chars of the SHA-256 of the original JPEG.
 * Because the URL changes whenever the picture changes, a replaced hero can never
 * be served from a browser / CDN cache of the previous one, and the `<picture>`
 * sources and the `<link rel="preload">` always point at the same revision.
 * Exactly one JPEG and at least one WebP candidate must exist.
 */
export interface Hero {
  /** Original JPEG (fallback src). */
  src: string;
  /** WebP candidates as a `srcset` string, ascending by width. */
  srcset: string;
  width: number;
  height: number;
}

const DIR = join('public', 'illust');
const JPG = /^hitohako-hero-([0-9a-f]{10})\.jpg$/;

export function heroImage(): Hero {
  const files = readdirSync(join(process.cwd(), DIR));
  const jpgs = files.filter((f) => JPG.test(f));
  if (jpgs.length !== 1) {
    throw new Error(
      `Expected exactly one hitohako-hero-<hash>.jpg in ${DIR}, found ${jpgs.length}: ${jpgs.join(', ')}. ` +
        'Regenerate with scripts/make-hero.py.',
    );
  }
  const jpg = jpgs[0];
  const hash = jpg.match(JPG)![1];
  const webp = new RegExp(`^hitohako-hero-${hash}-(\\d+)w\\.webp$`);
  const candidates = files
    .map((f) => ({ file: f, m: f.match(webp) }))
    .filter((c): c is { file: string; m: RegExpMatchArray } => c.m !== null)
    .map((c) => ({ file: c.file, w: Number(c.m[1]) }))
    .sort((a, b) => a.w - b.w);
  if (candidates.length === 0) {
    throw new Error(`No hitohako-hero-${hash}-<w>w.webp next to ${jpg}. Regenerate with scripts/make-hero.py.`);
  }
  const { width, height } = jpegSize(join(DIR, jpg));
  return {
    src: `/illust/${jpg}`,
    srcset: candidates.map((c) => `/illust/${c.file} ${c.w}w`).join(', '),
    width,
    height,
  };
}

/** Reads the intrinsic size of a baseline/progressive JPEG from its SOF marker. */
export function jpegSize(path: string): { width: number; height: number } {
  const buf = readFileSync(join(process.cwd(), path));
  if (buf.readUInt16BE(0) !== 0xffd8) throw new Error(`Not a JPEG: ${path}`);
  let off = 2;
  while (off + 9 <= buf.length) {
    if (buf[off] !== 0xff) throw new Error(`Corrupt JPEG marker in ${path}`);
    const marker = buf[off + 1];
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01 || marker === 0xff) {
      off += marker === 0xff ? 1 : 2;
      continue;
    }
    const len = buf.readUInt16BE(off + 2);
    // SOF0..SOF15 except DHT (C4), JPG (C8) and DAC (CC)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buf.readUInt16BE(off + 5), width: buf.readUInt16BE(off + 7) };
    }
    off += 2 + len;
  }
  throw new Error(`No SOF marker found in ${path}`);
}
