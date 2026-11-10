// 候補ごとのビルド結果に帯を入れ、一覧用の index.json を書く。
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
const [manifestPath, out, require] = process.argv.slice(2)
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
// created は試作 commit の UTC 時刻。一覧は新しい試作を先頭に並べる。
const CREATED = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/
const ids = new Set()
const candidates = manifest.candidates.map(c => {
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(c.id) || !/^[0-9a-f]{40}$/.test(c.commit) || !c.title || !c.status || !CREATED.test(c.created ?? '')) throw Error(`invalid candidate: ${c.id}`)
  if (ids.has(c.id)) throw Error(`duplicate candidate id: ${c.id}`)
  ids.add(c.id)
  const built = existsSync(`${out}/${c.id}/studio.html`)
  if (!built && require === '1') throw Error(`candidate not built: ${c.id}`)
  if (built) for (const page of ['studio.html', 'live2d.html']) {
    const file = `${out}/${c.id}/${page}`
    const html = readFileSync(file, 'utf8')
    const banner = `<meta name="kohako-candidate" content="${esc(c.id)}"><div class="candidate-banner" role="note" style="background:#fff3cd;color:#3d2b00;border:1px solid #c9a227;padding:8px 12px;margin:8px;font:14px/1.5 sans-serif">試作候補 <strong>${esc(c.id)}</strong>（${esc(c.status)}・版 ${esc(c.commit.slice(0, 8))}）。通常版 v11r ではありません。 <a href="/kohako/studio.html">通常版に戻る</a> ／ <a href="/kohako/candidates.html">候補の一覧</a></div>`
    if (!html.includes('<body>')) throw Error(`${file}: no <body>`)
    writeFileSync(file, html.replace('<body>', `<body>${banner}`))
  }
  return { ...c, built }
}).sort((a, b) => b.created.localeCompare(a.created))
writeFileSync(`${out}/index.json`, JSON.stringify({ version: manifest.version, candidates }, null, 2))
