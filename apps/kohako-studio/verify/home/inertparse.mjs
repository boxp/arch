// BOXP-506: 生成HTMLの消毒前の解析（DOMParser）が外部URLへ通信しないことを3エンジンで確認する。
// 実行例: node inertparse.mjs "const d=new DOMParser().parseFromString('<body>'+html+'</body>','text/html')"  （対照: "document.createElement('div').innerHTML=html" は通信が出る）
import { chromium, firefox, webkit } from 'playwright'
const payload = `<img src="http://leak.test/img?x=1"><img srcset="http://leak.test/srcset 1x"><picture><source srcset="http://leak.test/source"></picture><link rel=stylesheet href="http://leak.test/css"><link rel=preload as=image href="http://leak.test/preload"><style>@import url(http://leak.test/import);body{background:url(http://leak.test/bg)}</style><div style="background:url(http://leak.test/inline)"></div><video poster="http://leak.test/poster" src="http://leak.test/video"></video><audio src="http://leak.test/audio"></audio><object data="http://leak.test/obj"></object><embed src="http://leak.test/embed"><iframe src="http://leak.test/iframe"></iframe><svg><image href="http://leak.test/svgimg"/></svg><input type=image src="http://leak.test/input"><script src="http://leak.test/script"></script><meta http-equiv=refresh content="0;url=http://leak.test/refresh"><body background="http://leak.test/bodybg">`
const fn = process.argv[2]
let fail = 0
for (const [name, bt] of [['chromium', chromium], ['firefox', firefox], ['webkit', webkit]]) {
  const b = await bt.launch(); const p = await b.newPage(); const hits = []
  await p.route('**/*', r => { const u = r.request().url(); if (u.includes('leak.test')) hits.push(u); return u.startsWith('http://app.test') ? r.fulfill({ body: '<!doctype html><title>x</title>', contentType: 'text/html' }) : r.abort() })
  await p.goto('http://app.test/')
  await p.evaluate(({ html, src }) => { const f = new Function('html', src); f(html) }, { html: payload, src: fn })
  await p.waitForTimeout(1500)
  console.log(name, hits.length ? 'LEAK ' + hits.join(',') : 'no-request'); if (hits.length) fail++
  await b.close()
}
process.exit(fail ? 1 : 0)
