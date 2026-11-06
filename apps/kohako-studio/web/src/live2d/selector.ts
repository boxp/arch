import { LATEST_MODEL_ID, lostPrototypes, modelFor, normalizeModelId, rigModels } from './model'

export function setupSelector(container: HTMLElement, includeSample: boolean): boolean {
  const params = new URLSearchParams(location.search)
  const id = normalizeModelId(params.get('model'))
  const lost = lostPrototypes.find(p => p.id === id)
  const model = modelFor(location.search)
  const select = document.createElement('select'); select.id = 'model-select'
  const label = document.createElement('label'); label.htmlFor = select.id; label.textContent = '試作の選択 '
  const all = [...rigModels.filter(m => includeSample || m.id !== 'sample'), ...lostPrototypes]
  all.sort((a, b) => {
    const number = (id: string) => {
      if (id === 'kohako') return 0
      if (id === 'sample') return 99
      const match = id.match(/v(\d+)([a-z])?$/)
      return match ? Number(match[1]) + (match[2] ? (match[2].charCodeAt(0) - 96) / 100 : 0) : 98
    }
    return number(a.id) - number(b.id)
  })
  for (const item of all) {
    const option = document.createElement('option'); option.value = item.id
    const version = item.id === 'kohako' ? 'v0' : item.id === 'sample' ? 'サンプル' : item.id.replace('kohako-', '')
    option.textContent = `${version}（${'images' in item ? '読込不能: 比較画像を表示' : item.evaluation}）`
    select.append(option)
  }
  select.value = lost?.id ?? (includeSample ? model.id : model.id === 'sample' ? LATEST_MODEL_ID : model.id)
  select.addEventListener('change', () => { params.set('model', select.value); location.search = params.toString() })
  const details = document.createElement('p')
  const selected = lost ?? (includeSample || model.id !== 'sample' ? model : modelFor(''))
  details.textContent = `${select.selectedOptions[0]?.textContent} — ${selected.evaluation}。問題: ${selected.problems} 最新の試作は ${LATEST_MODEL_ID.replace('kohako-', '')}（担当評価は選択欄を参照）です。`
  container.append(label, select, details)
  if (model.id === LATEST_MODEL_ID && !lost) {
    const link = document.createElement('a'); link.href = './kohako/live2d/compare/kohako-v13-hair-shift-web.png'; link.textContent = '髪のずれ 修正前後の比較（実ブラウザ）'; const link2 = document.createElement('a'); link2.href = './kohako/live2d/compare/kohako-v14-compare-hair.jpg'; link2.textContent = 'v13・v14 静止／角度別の比較'; const mask = document.createElement('a'); mask.href = './kohako/live2d/compare/kohako-v14-exposure-mask.jpg'; mask.textContent = '後ろ髪の露出領域'; const shake = document.createElement('a'); shake.href = './kohako/live2d/compare/kohako-v14-shake.gif'; shake.textContent = '首振りの静止3点を往復'; const v15 = document.createElement('a'); v15.href = './kohako/live2d/compare/kohako-v15-compare-hair.jpg'; v15.textContent = 'v15 髪の角度別比較'; const v15mask = document.createElement('a'); v15mask.href = './kohako/live2d/compare/kohako-v15-mask.jpg'; v15mask.textContent = 'v15 移動範囲'; const v15shake = document.createElement('a'); v15shake.href = './kohako/live2d/compare/kohako-v15-shake.gif'; v15shake.textContent = 'v15 首振り'; const detail = document.createElement('a'); detail.href = './kohako/live2d/compare/kohako-v15-compare-xminus20.jpg'; detail.textContent = 'X−20 拡大'; const eyes = document.createElement('a'); eyes.href = './kohako/live2d/compare/kohako-v15e-compare-eyes.jpg'; eyes.textContent = 'v15e 閉眼の比較'; container.append(link, ' ／ ', link2, ' ／ ', mask, ' ／ ', shake, ' ／ ', v15, ' ／ ', v15mask, ' ／ ', v15shake, ' ／ ', detail, ' ／ ', eyes)
  }
  if (lost) {
    const note = document.createElement('p'); note.textContent = 'p2lrt は作業ディレクトリ消失により未保存・再現不能です。比較画像を表示します。'; container.append(note)
    for (const src of lost.images) { const img = document.createElement('img'); img.src = src; img.alt = `${lost.id} の比較: ${src.split('-compare-')[1]?.replace('.png', '')}`; img.style.maxWidth = '100%'; img.loading = 'lazy'; container.append(img) }
  }
  return !!lost
}
