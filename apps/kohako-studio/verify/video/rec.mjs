// BOXP-441 TD-23: 配備済みWebを実Chromiumで録画し、各frameの時刻とparameter値を対応付ける。
import { chromium, devices } from 'playwright';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const H = process.env.H || 'http://kohako-studio.kohako-studio.svc.cluster.local';
const [,, model, scenario, out, dev] = process.argv; // model: kohako-v25 ; scenario: det|nat|studio ; dev: pc|pixel7
fs.mkdirSync(out + '/frames', { recursive: true });
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const opts = dev === 'pixel7' ? { ...devices['Pixel 7'], deviceScaleFactor: 1 } : { viewport: { width: 1100, height: 820 }, deviceScaleFactor: 1 };
const ctx = await b.newContext(opts);
let token = null;
const LOCAL = 'http://localhost:8765';
if (scenario === 'studio') { token = fs.readFileSync(process.env.TOKEN_FILE, 'utf8').trim();
  // Studio は送信時に crypto.randomUUID 等の secure context 専用 API を使う。クラスタ内 http オリジンでは
  // 送信前に例外で止まるため、ページは localhost(secure context)で開き、全リクエストを実 Service へ転送する。
  await ctx.route(u => u.origin === LOCAL, async r => { const req = r.request(); const u = new URL(req.url()); const headers = { ...req.headers() };
    if (u.pathname.startsWith('/kohako/api/')) headers.authorization = 'Bearer ' + token;
    await r.fulfill({ response: await r.fetch({ url: H + u.pathname + u.search, headers }) }); }); }
// 未配備の候補モデルを同じページ・同じ軌道で比較するため、指定時だけ当該 p2lrt をローカルファイルで差し替える
if (process.env.OVERRIDE_P2LRT) { const body = fs.readFileSync(process.env.OVERRIDE_P2LRT);
  await ctx.route(u => u.pathname.endsWith('/' + model + '.p2lrt'), r => r.fulfill({ status: 200, contentType: 'application/octet-stream', body })); }
const page = await ctx.newPage();
const errs = []; page.on('console', m => { if (m.type() === 'error') errs.push(m.text()) }); page.on('pageerror', e => errs.push(String(e)));
const p2 = []; page.on('request', r => { if (r.url().endsWith('.p2lrt')) p2.push(r.url().split('/').pop()) });
const url = (scenario === 'studio' ? LOCAL : H) + (scenario === 'studio' ? '/kohako/studio.html' : '/kohako/live2d.html') + '?model=' + model;
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => (window.__rigPreview?.player) || (window.__studioRig?.player), null, { timeout: 20000 });
await page.waitForTimeout(1500);
const stageSel = scenario === 'studio' ? '#rig' : '#stage';
const setup = await page.evaluate(({ stageSel }) => {
  const pr = (window.__rigPreview || window.__studioRig).player; const ids = pr.parameters;
  const want = ids.filter(x => /Angle|Eye|Mouth|Hair|Body|Breath|Brow/.test(x)); const idx = want.map(w => ids.indexOf(w));
  window.__trace = []; window.__events = []; window.__ids = want;
  const d = pr.draw.bind(pr); pr.draw = () => { d(); const v = pr.parameterValues(); window.__trace.push([performance.timeOrigin + performance.now(), ...idx.map(i => +v[i].toFixed(3))]) };
  window.__ev = (name) => window.__events.push([performance.timeOrigin + performance.now(), name]);
  const st = document.getElementById('state'); new MutationObserver(() => window.__ev('state:' + st.textContent)).observe(st, { childList: true, characterData: true, subtree: true });
  document.querySelector(stageSel).scrollIntoView({ block: 'start' }); window.scrollBy(0, -8); const r = document.querySelector(stageSel).getBoundingClientRect();
  return { ids: want, stage: { x: r.x, y: r.y, w: r.width, h: r.height }, clips: pr.clips, expressions: pr.expressions, dpr: devicePixelRatio, face: document.body.innerText.match(/コハコ v[0-9a-z]+[^\n]*/)?.[0] };
}, { stageSel });
const frames = []; const cdp = await ctx.newCDPSession(page); let n = 0;
cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => { const f = `${String(n++).padStart(5, '0')}.jpg`; fs.writeFileSync(`${out}/frames/${f}`, Buffer.from(data, 'base64')); frames.push({ f, t: metadata.timestamp * 1000 }); try { await cdp.send('Page.screencastFrameAck', { sessionId }) } catch {} });
const vp = page.viewportSize();
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: vp.width, maxHeight: vp.height, everyNthFrame: scenario === 'studio' ? 2 : 1 });
const t0 = Date.now();
await page.evaluate(() => window.__ev('record:start'));
if (scenario === 'det') {
  await page.evaluate(() => { const pr = window.__rigPreview.player; pr.play(null); pr.expression(null); pr.lookAt(0, 0); pr.lipSync = () => {}; pr.behaviors(0); for (const r of pr.parameterRanges()) pr.setParameter(r.id, r.default);
    const T0 = performance.now(); window.__detDone = false; const seg = (t) => t < 3 ? 'X' : t < 6 ? 'Y' : t < 9 ? 'XY' : t < 12 ? 'X+HairBack' : t < 15 ? 'blink+mouth+X' : 'end'; let last = '';
    const f = () => { const t = (performance.now() - T0) / 1000; let X = 0, Y = 0, HB = 0, E = 1, M = 0;
      if (t < 3) X = 30 * Math.sin(2 * Math.PI * t / 3); else if (t < 6) Y = 20 * Math.sin(2 * Math.PI * (t - 3) / 3); else if (t < 9) { const u = (t - 6) / 3; X = 25 * Math.sin(2 * Math.PI * u); Y = 15 * Math.cos(2 * Math.PI * u) - 15 } else if (t < 12) { const u = t - 9; X = 15 * Math.sin(2 * Math.PI * u / 3); HB = Math.sin(2 * Math.PI * u / 1.5) } else if (t < 15) { const u = t - 12; E = (Math.cos(2 * Math.PI * u / 1.5) + 1) / 2; M = (1 - Math.cos(2 * Math.PI * u / 0.75)) / 2; X = 10 * Math.sin(2 * Math.PI * u / 3) }
      const s = seg(t); if (s !== last) { window.__ev('seg:' + s); last = s }
      pr.setParameter('ParamAngleX', X); pr.setParameter('ParamAngleY', Y); pr.setParameter('ParamHairBack', HB); pr.setParameter('ParamEyeLOpen', E); pr.setParameter('ParamEyeROpen', E); pr.setParameter('ParamMouthOpenY', M);
      if (t < 15.5) requestAnimationFrame(f); else window.__detDone = true }; requestAnimationFrame(f) });
  await page.waitForFunction(() => window.__detDone, null, { timeout: 40000 });
} else if (scenario === 'nat') {
  const ap = async (s, ms) => { await page.evaluate(s => { window.__ev('apply:' + s); window.__rigPreview.apply(s) }, s); await page.waitForTimeout(ms) };
  await ap('idle', 4000); await ap('thinking', 6000);
  await page.evaluate(() => { const T = performance.now(); window.__spk = setInterval(() => { const t = (performance.now() - T) / 1000; const syl = Math.abs(Math.sin(t * Math.PI * 6)); const ph = 0.75 + 0.25 * Math.sin(t * Math.PI * 0.9); window.__rigPreview.setMouth(Math.min(1, syl * ph)) }, 30) });
  await ap('speaking', 6000); await page.evaluate(() => { clearInterval(window.__spk); window.__rigPreview.setMouth(0) });
  await ap('failed', 4000); await ap('idle', 3000);
} else if (scenario === 'studio') {
  await page.waitForFunction(() => document.getElementById('connection').textContent === '接続中', null, { timeout: 15000 });
  const sp = page.locator('#speech'); if (await sp.isChecked()) await sp.uncheck();
  await page.waitForTimeout(3000);
  await page.fill('#message', 'こんにちは。今日はどんな一日でしたか？'); await page.evaluate(() => window.__ev('send'));
  await page.click('#send');
  await page.waitForFunction(() => /応答を表示中|失敗|承認待ち|停止/.test(document.getElementById('state').textContent), null, { timeout: 90000 });
  await page.waitForTimeout(3000);
  setup.reply = await page.locator('#reply').textContent();
}
await page.evaluate(() => window.__ev('record:end'));
await page.waitForTimeout(300);
await cdp.send('Page.stopScreencast');
const trace = await page.evaluate(() => ({ trace: window.__trace, events: window.__events }));
await b.close();
const T = frames[0]?.t ?? t0;
fs.writeFileSync(out + '/meta.json', JSON.stringify({ model, scenario, dev, url, p2lrt: p2, face: setup.face, reply: setup.reply, stage: setup.stage, ids: setup.ids, clips: setup.clips, expressions: setup.expressions, viewport: vp, errors: errs, recordedAt: new Date(t0).toISOString(), frames: frames.length, seconds: (frames.at(-1).t - T) / 1000, T }, null, 1));
fs.writeFileSync(out + '/frames.json', JSON.stringify(frames.map(f => ({ f: f.f, t: +(f.t - T).toFixed(1) }))));
fs.writeFileSync(out + '/trace.json', JSON.stringify({ ids: setup.ids, rows: trace.trace.map(r => [+(r[0] - T).toFixed(1), ...r.slice(1)]) }));
fs.writeFileSync(out + '/events.json', JSON.stringify(trace.events.map(e => [+(e[0] - T).toFixed(1), e[1]])));
console.log(JSON.stringify({ model, scenario, dev, p2lrt: p2, frames: frames.length, seconds: +((frames.at(-1).t - T) / 1000).toFixed(1), traceRows: trace.trace.length, events: trace.events.length, errors: errs, face: setup.face, reply: setup.reply }));
