import { lostPrototypes, modelFor, normalizeModelId, rigModels } from './model'

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
  select.value = lost?.id ?? (includeSample ? model.id : model.id === 'sample' ? 'kohako-v12' : model.id)
  select.addEventListener('change', () => { params.set('model', select.value); location.search = params.toString() })
  const details = document.createElement('p')
  const selected = lost ?? (includeSample || model.id !== 'sample' ? model : modelFor(''))
  details.textContent = `${select.selectedOptions[0]?.textContent} — ${selected.evaluation}。問題: ${selected.problems} 最新の試作は v12（担当不採用・本人確認用）です。`
  container.append(label, select, details)
  if (lost) {
    const note = document.createElement('p'); note.textContent = 'p2lrt は作業ディレクトリ消失により未保存・再現不能です。比較画像を表示します。'; container.append(note)
    for (const src of lost.images) { const img = document.createElement('img'); img.src = src; img.alt = `${lost.id} の比較: ${src.split('-compare-')[1]?.replace('.png', '')}`; img.style.maxWidth = '100%'; img.loading = 'lazy'; container.append(img) }
  }
  return !!lost
}
