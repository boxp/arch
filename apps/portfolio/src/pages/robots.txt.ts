import type { APIRoute } from 'astro';
import { isStage } from '../lib/site';

// stage では全クローラーを Disallow する（検索エンジンへの表示抑制であり、アクセス制限ではない）。
export const GET: APIRoute = ({ site }) => {
  const body = isStage
    ? ['User-agent: *', 'Disallow: /', ''].join('\n')
    : ['User-agent: *', 'Allow: /', '', `Sitemap: ${new URL('/sitemap-index.xml', site)}`, ''].join('\n');
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
