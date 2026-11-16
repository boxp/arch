// OGP 画像 (public/og.png, 1200x630) を SVG から生成する。
// 実行: npm run og
// フォントは scripts/fonts/ に同梱した Inter (SIL Open Font License) を使う。
import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const profile = JSON.parse(readFileSync(join(root, 'src/content/profile.json'), 'utf8'));
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#0b0f14"/>
  <rect x="0" y="0" width="12" height="630" fill="#7ee787"/>
  <text x="96" y="230" font-family="Inter" font-size="36" fill="#7ee787">${esc(profile.handle)}</text>
  <text x="96" y="330" font-family="Inter" font-size="88" font-weight="700" fill="#e6edf3">${esc(profile.name)}</text>
  <text x="96" y="400" font-family="Inter" font-size="34" fill="#9fb0c0">Software Engineer / Clojure / Kubernetes / Terraform / Cloudflare</text>
  <text x="1104" y="566" text-anchor="end" font-family="Inter" font-size="32" fill="#7ee787">b0xp.io</text>
</svg>`;

const resvg = new Resvg(svg, {
  font: {
    fontFiles: [join(root, 'scripts/fonts/Inter-Regular.ttf'), join(root, 'scripts/fonts/Inter-Bold.ttf')],
    loadSystemFonts: false,
    defaultFontFamily: 'Inter',
  },
});
const png = resvg.render().asPng();
writeFileSync(join(root, 'public/og.png'), png);
console.log(`wrote public/og.png (${png.length} bytes)`);
