// BOXP-749: 実 BFF の build（conversation/extractViews/geocode）に、Hermes の応答だけ合成文を通す。ジオコードは実 Nominatim（1 秒 1 件）。
// 使い方: node realpath749.mjs <bff/dist の絶対パス>  → 返答（views）を JSON で出力する。出発地は含めない。
const dist = process.argv[2]
const { createConversation } = await import(`${dist}/conversation.js`)
const { createGeocoder } = await import(`${dist}/geocode.js`)
const renoir = { name: 'Cafe Renoir 芝大門店', address: '東京都港区芝大門2-3-1 常泉ビル2F' }
const block = (v) => `\n\n\`\`\`kohako-view\n${JSON.stringify(v)}\n\`\`\``
const texts = {
  // 本人画面でピンが出なかった時と同じ形（aliases なし）
  single: `Cafe Renoir 芝大門店です。${block({ kind: 'map', title: 'Cafe Renoir 芝大門店', destination: renoir })}`,
  // 新しい指示に従った形（aliases あり）
  singleAlias: `Cafe Renoir 芝大門店です。${block({ kind: 'map', title: 'Cafe Renoir 芝大門店', destination: { ...renoir, aliases: ['ルノアール'] } })}`,
  multi: `3 つの候補です。${block({
    kind: 'map',
    title: '大門・三田・麻布十番のカフェ',
    places: [
      { ...renoir, aliases: ['ルノアール', 'カフェ ルノアール'] },
      { name: 'エクセルシオール カフェ 三田店', address: '東京都港区芝5-31-5 GATO三田ビル1F', aliases: ['EXCELSIOR CAFFE'] },
      { name: 'ロバーツコーヒー 麻布十番店', address: '東京都港区麻布十番2丁目', aliases: ["Robert's Coffee"] },
    ],
  })}`,
}
const hermes = { run: async (_id, input) => ({ status: 'done', text: texts[input] }), watch: async () => ({ status: 'unknown' }), approve: async () => 'ok', stop: async () => {} }
const conv = createConversation({ now: Date.now, hermes, prefix: 'e2e', geocode: createGeocoder({ fetcher: fetch }) })
const out = {}
for (const k of Object.keys(texts)) {
  const started = Date.now()
  const e = conv.submit({ kind: 'text', requestId: `e2e-${k}-${Date.now()}`, text: k, expiresAt: Date.now() + 60000, views: true }, 'x')
  await (conv.get(e.requestId)?.settled ?? new Promise((r) => setTimeout(r, 25000)))
  out[k] = { ms: Date.now() - started, reply: conv.get(e.requestId)?.reply }
}
console.log(JSON.stringify(out, null, 1))
