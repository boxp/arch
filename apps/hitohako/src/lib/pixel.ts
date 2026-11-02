import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Reads the intrinsic size of a PNG under `public/` at build time (IHDR chunk),
 * so pixel art can be integer-scaled without hardcoding dimensions.
 * Resolved from the project root (process.cwd()) because the bundled module's
 * import.meta.url points into dist/ during `astro build`.
 */
export function pngSize(publicPath: string): { width: number; height: number } {
  const buf = readFileSync(join(process.cwd(), 'public', publicPath));
  if (buf.length < 24 || buf.toString('ascii', 1, 4) !== 'PNG') {
    throw new Error(`Not a PNG: ${publicPath}`);
  }
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}
