// BOXP-506 TD-01: 実 BFF の build（conversation/extractViews/geocode）を、Hermes の応答だけ合成文に差し替えて通す。ジオコードは実 Nominatim。使い方: node realpath506.mjs <bff/dist の絶対パス>
const dist = process.argv[2]
const { createConversation } = await import(`${dist}/conversation.js`)
const { createGeocoder } = await import(`${dist}/geocode.js`)
const texts = {
  arcana: 'ゲームアルカナへの行き方です。名古屋駅から電車でどうぞ。\n\n```kohako-view\n{"kind":"map","title":"ゲームアルカナへの経路","destination":{"name":"ゲームアルカナ","address":"愛知県稲沢市朝府町2-33"},"origin":"名古屋駅","mode":"transit"}\n```',
  sameLine: '地図です。\n```kohako-view {"kind":"map","title":"ゲームアルカナ","destination":{"name":"ゲームアルカナ","address":"愛知県稲沢市朝府町2-33"},"mode":"transit"}```',
  tamachi: '田町店です。\n```kohako-view\n{"kind":"map","title":"田町店","destination":{"name":"クラフトビアマーケット田町店","address":"東京都港区芝5-16-14"}}\n```',
  usage: '利用枠です。\n```kohako-view\n{"kind":"usage"}\n```',
}
const hermes = { run: async (_id, input) => ({ status: 'done', text: texts[input] }), watch: async () => ({ status: 'unknown' }), approve: async () => 'ok', stop: async () => {} }
const conv = createConversation({ now: Date.now, hermes, prefix: 'e2e', geocode: createGeocoder({ fetcher: fetch }) })
const out = {}
for (const k of Object.keys(texts)) {
  const e = conv.submit({ kind: 'text', requestId: `e2e-${k}-${Date.now()}`, text: k, expiresAt: Date.now() + 60000, views: true }, 'x')
  const id = e.requestId ?? `e2e-${k}`
  await (conv.get(e.requestId)?.settled ?? new Promise(r => setTimeout(r, 12000)))
  out[k] = conv.get(e.requestId)?.reply
}
console.log(JSON.stringify(out, null, 1))
