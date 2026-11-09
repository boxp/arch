// 旧新を同位相で横に並べた比較動画用frame列を作る。usage: node pair.mjs A B outdir --fps 30 --slow 1 --crop x,y,w,h --scale f --label a,b --from s --to s
import Jimp from 'jimp'; import fs from 'node:fs';
const a = process.argv.slice(2); const dirs = []; const o = { fps: 30, slow: 1, crop: '0,0,1,1', scale: 1, label: 'A,B', from: 0, to: 1e9 };
for (let i = 0; i < a.length; i++) { if (a[i].startsWith('--')) o[a[i].slice(2)] = a[++i]; else dirs.push(a[i]) }
const [A, B, out] = dirs; fs.mkdirSync(out, { recursive: true });
const font = await Jimp.loadFont(Jimp.FONT_SANS_16_BLACK);
const [cx, cy, cw, ch] = o.crop.split(',').map(Number); const labels = o.label.split(',');
const load = d => ({ meta: JSON.parse(fs.readFileSync(d + '/meta.json')), fr: JSON.parse(fs.readFileSync(d + '/frames.json')), tr: JSON.parse(fs.readFileSync(d + '/trace.json')), ev: JSON.parse(fs.readFileSync(d + '/events.json')), d });
const S = [load(A), load(B)];
const nearest = (arr, t, key) => { let lo = 0, hi = arr.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (key(arr[m]) < t) lo = m + 1; else hi = m } const i = Math.max(0, Math.min(arr.length - 1, lo)); return (i > 0 && Math.abs(key(arr[i - 1]) - t) < Math.abs(key(arr[i]) - t)) ? arr[i - 1] : arr[i] };
const ja = { '待機中': 'idle', '考えています': 'thinking', '話しています': 'speaking', '失敗': 'failed', '聞いています': 'listening' };
const T = Math.min(+o.to * 1000, Math.min(...S.map(s => s.fr.at(-1).t))); const step = 1000 / (+o.fps * +o.slow);
const st = S[0].meta.stage; const W = Math.round(st.w * cw * +o.scale), H = Math.round(st.h * ch * +o.scale);
let n = 0;
for (let t = +o.from * 1000; t <= T; t += step) {
  const frame = new Jimp(W * 2 + 8, H + 22, 0xffffffff);
  for (let k = 0; k < 2; k++) { const s = S[k]; const f = nearest(s.fr, t, x => x.t); const img = await Jimp.read(`${s.d}/frames/${f.f}`); const sg = s.meta.stage;
    img.crop(Math.round(sg.x + sg.w * cx), Math.round(sg.y + sg.h * cy), Math.round(sg.w * cw), Math.round(sg.h * ch)); if (+o.scale !== 1) img.resize(W, H, Jimp.RESIZE_BICUBIC);
    const row = nearest(s.tr.rows, t, r => r[0]); const ix = nm => s.tr.ids.indexOf(nm); const evs = s.ev.filter(e => e[0] <= t).map(e => e[1]).reverse(); const state = evs.find(e => /^(state|apply|seg):/.test(e))?.split(':')[1] ?? '';
    frame.composite(img, k * (W + 8), 22); frame.print(font, k * (W + 8) + 2, 2, `${labels[k]} t=${(t / 1000).toFixed(2)}s ${ja[state] ?? state} X${row[1 + ix('ParamAngleX')]} Y${row[1 + ix('ParamAngleY')]} HB${row[1 + ix('ParamHairBack')]}`.slice(0, Math.floor(W / 7))); }
  await frame.quality(88).writeAsync(`${out}/${String(n++).padStart(5, '0')}.jpg`);
}
console.log(out, 'frames', n, 'size', W * 2 + 8, H + 22);
