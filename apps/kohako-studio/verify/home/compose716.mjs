// BOXP-716: keshin716.mjs の録画を、左に通常版の家・右に Keshin2D の試作として並べた mp4（H.264、音なし）にする。
// 実行: ffmpeg のある環境で `node compose716.mjs <keshin716.mjs の出力先>`。録画の伸び（実時間との差）は walls から直す。
// PC（1280x800）は人物のいる左 600x800 を、スマホ（390x844）は全体を切り出す。
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
const DIR = process.argv[2]
const meta = JSON.parse(fs.readFileSync(path.join(DIR, 'meta.json'), 'utf8'))
const dur = (f) => +execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString()
const out = {}
for (const [name, crop, file] of [['A', '600:800:0:0', '01-idle-talk.mp4'], ['B', '600:800:0:0', '02-seated-look.mp4'], ['phone', '390:844:0:0', '03-phone-idle-talk.mp4']]) {
  const m = meta[name]
  if (!m?.home || !m.keshin) continue
  // B は「座り切った時」をそろえる（家は座るまでに待機のしぐさの切れ目を待つので、座り始めの時刻が試作と違う）。
  const lag = name === 'B' ? Math.max(0, m.home.seatedAt - m.keshin.seatedAt) : 0,
    length = m.home.length - lag + 0.5,
    inputs = []
  for (const side of ['home', 'keshin']) {
    const f = path.join(DIR, `${name}-${side}.webm`), wall = meta.walls?.[`${name}-${side}.webm`], k = wall ? dur(f) / wall : 1
    // 録画の時刻 = 実時間 × k。始まりを合わせ、実時間の長さに直す。
    inputs.push({ f, ss: (m[side].start + (side === 'home' ? lag : 0)) * k, t: length * k, k })
  }
  const filter = inputs.map((x, i) => `[${i}:v]setpts=(PTS-STARTPTS)/${x.k.toFixed(4)},crop=${crop},fps=30[v${i}]`).join(';') + ';[v0][v1]hstack=inputs=2[v]'
  execFileSync('ffmpeg', ['-v', 'error', '-y', ...inputs.flatMap((x) => ['-ss', x.ss.toFixed(2), '-t', x.t.toFixed(2), '-i', x.f]), '-filter_complex', filter, '-map', '[v]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '26', '-preset', 'slow', '-movflags', '+faststart', '-an', path.join(DIR, file)])
  out[file] = { stretch: inputs.map((x) => +x.k.toFixed(3)), seconds: +length.toFixed(2), bytes: fs.statSync(path.join(DIR, file)).size }
}
console.log(JSON.stringify(out, null, 2))
