// BOXP-441 TD-27: 顔だけ駆動(A)/顔固定で髪・待機要素だけ駆動(B)/通常動作(C) を同じ画角で録画し、
// 最終描画時点の parameter 値と、顔ランドマーク・後ろ髪の根元/中間/肩/毛先の頂点位置を毎frame記録する。
// 画面には: 実際の頂点=塗り丸、顔(根元)または体(肩・毛先)に剛体追従した場合の期待位置=白抜き丸、を重ねる。
import { open } from './lib.mjs'; import fs from 'node:fs';
const [,, model, cond, out] = process.argv; fs.mkdirSync(out + '/frames', { recursive: true });
const { b, p, errs, p2 } = await open(model, { width: 760, height: 726 });
const setup = await p.evaluate((cond) => {
  const pr = window.__rigPreview.player; const ids = pr.meshIds; const M = (id) => ids.indexOf(id);
  pr.stop(); pr.play(null); pr.expression(null); pr.lookAt(0, 0); pr.behaviors(0); for (const r of pr.parameterRanges()) pr.setParameter(r.id, r.default);
  pr.resetSimulation(); for (let i = 0; i < 400; i++) pr.update(1 / 60);
  const RH = pr.meshVertices(M('ArtMeshBackHair')).slice(), RF = pr.meshVertices(M('ArtMeshFace')).slice(), RT = pr.meshVertices(M('ArtMeshTopwear')).slice();
  const RIL = pr.meshVertices(M('ArtMeshIridesL')).slice(), RIR = pr.meshVertices(M('ArtMeshIridesR')).slice();
  // 2D 相似変換(回転+拡縮+平行移動)の最小二乗当てはめ: rest の点列 a -> 現在 b
  const fit = (a, b, sel) => { let n = 0, ax = 0, ay = 0, bx = 0, by = 0; for (const k of sel) { ax += a[k]; ay += a[k + 1]; bx += b[k]; by += b[k + 1]; n++ } ax /= n; ay /= n; bx /= n; by /= n;
    let sxx = 0, sxy = 0, saa = 0; for (const k of sel) { const x = a[k] - ax, y = a[k + 1] - ay, u = b[k] - bx, v = b[k + 1] - by; sxx += x * u + y * v; sxy += x * v - y * u; saa += x * x + y * y }
    const c = sxx / saa, s = sxy / saa; return (x, y) => [bx + c * (x - ax) - s * (y - ay), by + s * (x - ax) + c * (y - ay)] };
  const allF = []; for (let k = 0; k < RF.length; k += 2) allF.push(k);
  window.__fit = fit;
  const near = (v, x, y) => { let bi = 0, bd = 1e9; for (let k = 0; k < v.length; k += 2) { const d = (v[k] - x) ** 2 + (v[k + 1] - y) ** 2; if (d < bd) { bd = d; bi = k } } return bi };
  const cen = (v) => { let x = 0, y = 0, n = 0; for (let k = 0; k < v.length; k += 2) { x += v[k]; y += v[k + 1]; n++ } return [x / n, y / n] };
  const chinK = (() => { let bi = 0; for (let k = 1; k < RF.length; k += 2) if (RF[k] > RF[bi + 1]) bi = k - 1; return bi })();
  const T = { Lroot: [265, 185], Lmid: [245, 330], Lsho: [215, 430], Ltip: [180, 590], Rroot: [545, 185], Rmid: [560, 330], Rsho: [590, 430], Rtip: [635, 590] };
  const hk = Object.fromEntries(Object.entries(T).map(([n, [x, y]]) => [n, near(RH, x, y)]));
  // 体(Topwear)の参照点: 各髪ランドマークに最も近い Topwear 頂点
  // 顔の横に見える髪の位置(静止時): v36 までは体層(Topwear)、v37 では後ろ髪層に属する。両方の頂点を記録する
  const V = { SL: [290, 280], SR: [532, 280], CR: [560, 120] };
  const vk = Object.fromEntries(Object.entries(V).map(([n, [x, y]]) => [n, { t: near(RT, x, y), h: near(RH, x, y) }]));
  const tsel = Object.fromEntries(Object.entries(hk).map(([n, k]) => { const a = []; for (let j = 0; j < RT.length; j += 2) if ((RT[j] - RH[k]) ** 2 + (RT[j + 1] - RH[k + 1]) ** 2 < 70 * 70) a.push(j); return [n, a] }));
  const tk = tsel;
  const want = ['ParamAngleX', 'ParamAngleY', 'ParamAngleZ', 'ParamBodyAngleX', 'ParamBodyAngleY', 'ParamBodyAngleZ', 'ParamBreath', 'ParamHairBack', 'ParamHairFront', 'ParamEyeBallX'];
  const pi = want.map(w => pr.parameters.indexOf(w));
  window.__log = []; window.__ev = []; const T0 = performance.now();
  const meas = () => {
    const H = pr.meshVertices(M('ArtMeshBackHair')), F = pr.meshVertices(M('ArtMeshFace')), Tw = pr.meshVertices(M('ArtMeshTopwear'));
    const eL = cen(pr.meshVertices(M('ArtMeshIridesL'))), eR = cen(pr.meshVertices(M('ArtMeshIridesR'))), eL0 = cen(RIL), eR0 = cen(RIR);
    const face = [((eL[0] - eL0[0]) + (eR[0] - eR0[0])) / 2, ((eL[1] - eL0[1]) + (eR[1] - eR0[1])) / 2];
    const Tf = fit(RF, F, allF);
    const lm = {}; for (const [n, k] of Object.entries(hk)) { const Tb = fit(RT, Tw, tsel[n]); const ef = Tf(RH[k], RH[k + 1]), eb = Tb(RH[k], RH[k + 1]);
      const ex = /root|mid/.test(n) ? ef : eb; // 根元・中間は顔(頭)、肩・毛先は体に剛体追従した位置を期待位置とする
      lm[n] = { at: [H[k], H[k + 1]], ef, eb, rel: [H[k] - ex[0], H[k + 1] - ex[1]], rf: [H[k] - ef[0], H[k + 1] - ef[1]], rb: [H[k] - eb[0], H[k + 1] - eb[1]] } }
    const vis = {}; for (const [n, o] of Object.entries(vk)) { const et = Tf(RT[o.t], RT[o.t + 1]), eh = Tf(RH[o.h], RH[o.h + 1]);
      vis[n] = { top: [Tw[o.t] - et[0], Tw[o.t + 1] - et[1]], back: [H[o.h] - eh[0], H[o.h + 1] - eh[1]] } }
    const v = pr.parameterValues();
    return { vis, face, eL, eR, nb: Object.fromEntries(Object.entries(tsel).map(([n,a])=>[n,a.length])), chin: [F[chinK], F[chinK + 1]], lm, p: pi.map(i => +v[i].toFixed(3)) } };
  const g = window.__ov.getContext('2d'); const xy = window.__xy;
  const col = { root: '#00e000', mid: '#00b0ff', sho: '#ff00ff', tip: '#ffb000' };
  const draw = (m, t) => { g.clearRect(0, 0, 1e4, 1e4); g.lineWidth = 2;
    for (const e of [m.eL, m.eR, m.chin]) { const [x, y] = xy(...e); g.fillStyle = '#f00'; g.beginPath(); g.arc(x, y, 4, 0, 7); g.fill() }
    for (const [n, L] of Object.entries(m.lm)) { const c = col[n.slice(1)]; const [x, y] = xy(...L.at); const [ex, ey] = xy(L.at[0] - L.rel[0], L.at[1] - L.rel[1]);
      g.strokeStyle = '#fff'; g.beginPath(); g.arc(ex, ey, 6, 0, 7); g.stroke(); g.strokeStyle = '#000'; g.lineWidth = 1; g.beginPath(); g.arc(ex, ey, 7.5, 0, 7); g.stroke(); g.lineWidth = 2;
      g.fillStyle = c; g.beginPath(); g.arc(x, y, 4.5, 0, 7); g.fill(); g.strokeStyle = c; g.beginPath(); g.moveTo(ex, ey); g.lineTo(x, y); g.stroke() }
    g.fillStyle = 'rgba(0,0,0,.7)'; g.fillRect(0, 0, 300, 36); g.fillStyle = '#fff'; g.font = 'bold 13px monospace';
    g.fillText(`${window.__cond} t=${t.toFixed(2)}s ${window.__seg || ''}`, 4, 14);
    g.fillText(`X${m.p[0].toFixed(0)} Y${m.p[1].toFixed(0)} Z${m.p[2].toFixed(0)} BX${m.p[3].toFixed(0)} BZ${m.p[5].toFixed(0)} Br${m.p[6].toFixed(2)} HB${m.p[7].toFixed(2)}`, 4, 30) };
  window.__cond = cond;
  const d = pr.draw.bind(pr); pr.draw = () => { d(); const t = (performance.now() - T0) / 1000; const m = meas(); window.__log.push({ t: +t.toFixed(3), seg: window.__seg || 'pre', ...m }); draw(m, t) };
  window.__T0 = T0;
  if (cond === 'C') { pr.behaviors(1 | 2 | 4); pr.start() }
  return { hk, tk, rest: Object.fromEntries(Object.entries(hk).map(([n, k]) => [n, [RH[k], RH[k + 1]]])), params: want };
}, cond);
const cdp = await p.context().newCDPSession(p); const frames = []; let n = 0;
cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => { const f = `${String(n++).padStart(5, '0')}.jpg`; fs.writeFileSync(`${out}/frames/${f}`, Buffer.from(data, 'base64')); frames.push({ f, t: metadata.timestamp * 1000 }); try { await cdp.send('Page.screencastFrameAck', { sessionId }) } catch {} });
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: 760, maxHeight: 726, everyNthFrame: 1 });
const pageT0 = await p.evaluate(() => performance.timeOrigin + window.__T0);
if (cond === 'A' || cond === 'B') {
  // 自前のrAFループ: update→param上書き→draw。A: 顔向きだけ(物理は毎frame reset で静止)。B: 顔は0固定、髪/待機要素を一つずつ。
  await p.evaluate((cond) => { const pr = window.__rigPreview.player; pr.stop(); let last = performance.now(); window.__done = false; const T0 = performance.now();
    const S = cond === 'A' ? [['AngleX±20', 3], ['AngleY±15', 3], ['AngleZ±10', 3], ['AngleX+Z', 3]] : [['HairBack±1(直接)', 3], ['Breath', 3], ['BodyAngleX±10', 3], ['BodyAngleZ±10', 3], ['物理のみ(BodyX駆動)', 3]];
    const f = (now) => { const t = (now - T0) / 1000; let i = 0, u = t; while (i < S.length && u >= S[i][1]) { u -= S[i][1]; i++ } if (i >= S.length) { window.__done = true; return }
      const seg = S[i][0]; window.__seg = seg; const s = Math.sin(2 * Math.PI * u / 3);
      const P = { ParamAngleX: 0, ParamAngleY: 0, ParamAngleZ: 0, ParamBodyAngleX: 0, ParamBodyAngleZ: 0, ParamBreath: 0 };
      if (cond === 'A') { if (i === 0) P.ParamAngleX = 20 * s; if (i === 1) P.ParamAngleY = 15 * s; if (i === 2) P.ParamAngleZ = 10 * s; if (i === 3) { P.ParamAngleX = 20 * s; P.ParamAngleZ = 10 * Math.sin(2 * Math.PI * u / 1.5) } }
      else { if (i === 1) P.ParamBreath = (1 - Math.cos(2 * Math.PI * u / 3)) / 2; if (i === 2 || i === 4) P.ParamBodyAngleX = 10 * s; if (i === 3) P.ParamBodyAngleZ = 10 * s }
      for (const [k, v] of Object.entries(P)) pr.setParameter(k, v);
      if (cond === 'B' && i === 0) pr.setParameter('ParamHairBack', s);
      if (cond === 'A') pr.resetSimulation();
      pr.update(Math.min((now - last) / 1000, 0.1)); last = now;
      if (cond === 'B' && i === 0) pr.setParameter('ParamHairBack', s);
      pr.draw(); requestAnimationFrame(f) };
    requestAnimationFrame(f) }, cond);
  await p.waitForFunction(() => window.__done, null, { timeout: 120000 });
} else {
  const ap = async (s, ms) => { await p.evaluate(s => { window.__seg = s; window.__rigPreview.apply(s) }, s); await p.waitForTimeout(ms) };
  await ap('idle', 5000); await ap('thinking', 5000);
  await p.evaluate(() => { const T = performance.now(); window.__spk = setInterval(() => { const t = (performance.now() - T) / 1000; window.__rigPreview.setMouth(Math.min(1, Math.abs(Math.sin(t * Math.PI * 6)))) }, 30) });
  await ap('speaking', 4000); await p.evaluate(() => { clearInterval(window.__spk); window.__rigPreview.setMouth(0) }); await ap('idle', 3000);
}
await cdp.send('Page.stopScreencast');
const log = await p.evaluate(() => window.__log);
const box = await p.evaluate(() => { const r = window.__ov.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } });
fs.writeFileSync(out + '/log.json', JSON.stringify({ model, cond, setup, box, pageT0, frames, log, errs, p2lrt: p2 }));
await b.close(); console.log('ok', cond, frames.length, log.length, errs.length, p2);
