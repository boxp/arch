// BOXP-441 TD-27: 共通。live2d.html を開き、描画canvasの上に頂点印を重ねる overlay を作る。
import { chromium } from 'playwright';
export const H = process.env.H || 'http://kohako-studio.kohako-studio.svc.cluster.local';
export async function open(model, vp = { width: 760, height: 726 }) {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: vp });
  // 未配備の候補を同じページ・同じ軌道で比べるため、指定時だけ当該 p2lrt をローカルファイルで差し替える
  if (process.env.OVERRIDE_P2LRT) { const fs = await import('node:fs'); const body = fs.readFileSync(process.env.OVERRIDE_P2LRT);
    await ctx.route(u => u.pathname.endsWith('/' + model + '.p2lrt'), r => r.fulfill({ status: 200, contentType: 'application/octet-stream', body })); }
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e)));
  const p2 = []; p.on('request', r => { if (r.url().endsWith('.p2lrt')) p2.push(r.url().split('/').pop()) });
  await p.goto(H + '/kohako/live2d.html?model=' + model, { waitUntil: 'load' });
  await p.waitForFunction(() => window.__rigPreview?.player, null, { timeout: 20000 }); await p.waitForTimeout(800);
  await p.evaluate(() => { const pr = window.__rigPreview.player; const c = pr.canvas;
    // 録画用に描画canvasをページ左上へ大きく固定表示する(モデル自体・描画処理は変更しない)
    const bg = document.createElement('div'); Object.assign(bg.style, { position: 'fixed', left: 0, top: 0, width: '100vw', height: '100vh', background: '#f6eef2', zIndex: 97 }); document.body.appendChild(bg);
    Object.assign(c.style, { position: 'fixed', left: '0px', top: '0px', width: '760px', height: '726px', zIndex: 98, maxWidth: 'none', maxHeight: 'none' }); window.scrollTo(0, 0);
    const o = document.createElement('canvas'); o.id = 'ov'; const r = c.getBoundingClientRect();
    Object.assign(o.style, { position: 'fixed', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px', pointerEvents: 'none', zIndex: 99 });
    o.width = r.width; o.height = r.height; document.body.appendChild(o); window.__ov = o;
    window.__xy = (x, y) => { const L = pr.layout(); return [x * L.scale + L.left, y * L.scale + L.top] };
  });
  return { b, p, errs, p2 };
}
