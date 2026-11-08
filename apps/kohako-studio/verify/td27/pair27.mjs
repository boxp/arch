// 旧新を同じ時刻で横に並べたframe列を作る(track.mjs の出力用)。usage: node pair27.mjs dirA dirB out labelA,labelB [fps] [slow] [crop x,y,w,h px]
import Jimp from 'jimp'; import fs from 'node:fs';
const [,, A, B, out, lab, fps = '30', slow = '1', crop = '0,0,760,726'] = process.argv; fs.mkdirSync(out, { recursive: true });
const font = await Jimp.loadFont(Jimp.FONT_SANS_16_BLACK); const [cx, cy, cw, ch] = crop.split(',').map(Number); const labels = lab.split(',');
const S = [A, B].map(d => { const j = JSON.parse(fs.readFileSync(d + '/log.json')); return { d, fr: j.frames.map(f => ({ f: f.f, t: (f.t - j.pageT0) / 1000 })), log: j.log } });
const near = (arr, t) => { let lo = 0, hi = arr.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m].t < t) lo = m + 1; else hi = m } return arr[lo] };
const T = Math.min(...S.map(s => s.fr.at(-1).t)); const t0 = Math.max(...S.map(s => s.fr[0].t)); let n = 0;
for (let t = t0; t <= T; t += 1 / (+fps * +slow)) { const fr = new Jimp(cw * 2 + 8, ch + 22, 0xffffffff);
  for (let k = 0; k < 2; k++) { const s = S[k]; const f = near(s.fr, t); const img = (await Jimp.read(`${s.d}/frames/${f.f}`)).crop(cx, cy, cw, ch); const e = near(s.log, t);
    fr.composite(img, k * (cw + 8), 22); fr.print(font, k * (cw + 8) + 2, 2, `${labels[k]} t=${t.toFixed(2)}s ${e.seg} X${e.p[0].toFixed(0)} Z${e.p[2].toFixed(0)} BX${e.p[3].toFixed(1)}`) }
  await fr.quality(88).writeAsync(`${out}/${String(n++).padStart(5, '0')}.jpg`) }
console.log(out, n);
