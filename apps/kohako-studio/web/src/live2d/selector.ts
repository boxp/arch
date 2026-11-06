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
    const number = (id: string) => id === 'kohako' ? 0 : id === 'sample' ? 99 : Number(id.split('v').pop())
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
    const link = document.createElement('a'); link.href = './kohako/live2d/compare/kohako-v13-hair-shift-web.png'; link.textContent = '髪のずれ 修正前後の比較（実ブラウザ）'; const link2 = document.createElement('a'); link2.href = './kohako/live2d/compare/kohako-v13-compare-hair.png'; link2.textContent = '静止・角度別の比較'; container.append(link, ' ／ ', link2)
  }
  if (lost) {
    const note = document.createElement('p'); note.textContent = 'p2lrt は作業ディレクトリ消失により未保存・再現不能です。比較画像を表示します。'; container.append(note)
    for (const src of lost.images) { const img = document.createElement('img'); img.src = src; img.alt = `${lost.id} の比較: ${src.split('-compare-')[1]?.replace('.png', '')}`; img.style.maxWidth = '100%'; img.loading = 'lazy'; container.append(img) }
  }
  return !!lost
}
