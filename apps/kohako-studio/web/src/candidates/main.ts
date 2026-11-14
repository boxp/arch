import './style.css'
import { parseIndex, renderCandidates } from './list'

const root = document.querySelector<HTMLElement>('#list')!
fetch(new URL('candidates/index.json', new URL('./', location.href)), { credentials: 'same-origin', cache: 'no-store' })
  .then((r) => {
    if (!r.ok) throw Error(`一覧の取得に失敗 (${r.status})`)
    return r.json()
  })
  .then((data) => renderCandidates(root, parseIndex(data)))
  .catch((e: unknown) => {
    root.replaceChildren()
    const p = document.createElement('p')
    p.className = 'missing'
    p.textContent = e instanceof Error ? e.message : '一覧の取得に失敗'
    root.append(p)
  })
