// 録画frameから時刻・parameter付きのcontact sheetを作る。
// usage: node sheet.mjs <outdir...> --from s --to s --every n --cols c --crop x,y,w,h(stage比0..1) --scale f --out file.png --label a,b
import Jimp from 'jimp'; import fs from 'node:fs'; import path from 'node:path';
const args = process.argv.slice(2); const dirs = []; const o = { from: 0, to: 1e9, every: 1, cols: 6, scale: 1, crop: '0,0,1,1', out: 'sheet.png', label: '', max: 60 };
for (let i = 0; i < args.length; i++) { if (args[i].startsWith('--')) { o[args[i].slice(2)] = args[++i] } else dirs.push(args[i]) }
const font = await Jimp.loadFont(Jimp.FONT_SANS_16_BLACK); const fontW = await Jimp.loadFont(Jimp.FONT_SANS_16_WHITE);
const [cx, cy, cw, ch] = o.crop.split(',').map(Number); const labels = o.label ? o.label.split(',') : dirs.map(d => path.basename(d));
const nearest = (rows, t) => { let lo = 0, hi = rows.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (rows[m][0] < t) lo = m + 1; else hi = m } return rows[Math.max(0, Math.min(rows.length - 1, lo))] };
const sets = dirs.map((d, k) => { const meta = JSON.parse(fs.readFileSync(d + '/meta.json')); const fr = JSON.parse(fs.readFileSync(d + '/frames.json')); const tr = JSON.parse(fs.readFileSync(d + '/trace.json')); const ev = JSON.parse(fs.readFileSync(d + '/events.json'));
  const sel = fr.filter(f => f.t >= +o.from * 1000 && f.t <= +o.to * 1000).filter((_, i) => i % +o.every === 0).slice(0, +o.max); return { d, meta, fr: sel, tr, ev, label: labels[k] } });
const ixOf = (s, n) => s.tr.ids.indexOf(n);
const s0 = sets[0].meta.stage; const W = Math.round(s0.w * cw * +o.scale), Hh = Math.round(s0.h * ch * +o.scale); const cols = +o.cols; const n = Math.max(...sets.map(s => s.fr.length));
const rowsPer = Math.ceil(n / cols); const cellH = Hh + 20; const sheet = new Jimp(cols * W, sets.length * rowsPer * cellH, 0xffffffff);
for (let k = 0; k < sets.length; k++) { const s = sets[k]; const st = s.meta.stage;
  for (let i = 0; i < s.fr.length; i++) { const f = s.fr[i]; const img = await Jimp.read(`${s.d}/frames/${f.f}`); img.crop(Math.round(st.x + st.w * cx), Math.round(st.y + st.h * cy), Math.round(st.w * cw), Math.round(st.h * ch)); if (+o.scale !== 1) img.resize(W, Hh, Jimp.RESIZE_BICUBIC);
    const row = s.tr.rows.length ? nearest(s.tr.rows, f.t) : null; const evs = s.ev.filter(e => e[0] <= f.t).map(e => e[1]); const state = [...evs].reverse().find(e => e.startsWith('state:') || e.startsWith('apply:') || e.startsWith('seg:'))?.split(':')[1] ?? '';
    const ja = { '待機中': 'idle', '考えています': 'thinking', '話しています': 'speaking', '失敗': 'failed', '聞いています': 'listening', '承認待ち': 'approval', '応答を表示中': 'done', '停止しました': 'stopped', '未接続': 'offline' }; const st2 = ja[state] ?? state;
    const txt = `${s.label} t=${(f.t / 1000).toFixed(2)}s ${st2}` + (row ? ` X${row[1 + ixOf(s,'ParamAngleX')]} Y${row[1 + ixOf(s,'ParamAngleY')]} HB${row[1 + ixOf(s,'ParamHairBack')]} E${row[1 + ixOf(s,'ParamEyeLOpen')]} M${row[1 + ixOf(s,'ParamMouthOpenY')]}` : '');
    const X = (i % cols) * W, Y = (k * rowsPer + Math.floor(i / cols)) * cellH; sheet.composite(img, X, Y + 20); sheet.print(font, X + 2, Y + 2, txt.slice(0, Math.floor(W / 7))); } }
await sheet.writeAsync(o.out); console.log(o.out, sheet.bitmap.width, sheet.bitmap.height, 'frames', sets.map(s => s.fr.length).join('/'));
