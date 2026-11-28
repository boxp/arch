import './style.css'
import {
  type DeviceState,
  errorText,
  historyRow,
  isMapUrl,
  type PushOutcome,
  pushText,
  remaining,
  requestParam,
  STATE_LABEL,
} from './logic'

type Req = {
  id: string
  name: string
  state: DeviceState
  createdAt: string
  expiresAt: string
  endedAt?: string
  via?: 'notification' | 'page'
  seconds?: number
  push?: PushOutcome
}
type View = { stopped: boolean; places: { key: string; name: string }[]; defaultPlace: string; requests: Req[] }

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
const call = async (path: string, method = 'GET', body?: unknown) => {
  const r = await fetch(`/kohako/api/v1/device-trial${path}`, {
    method,
    cache: 'no-store',
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  })
  let data: Record<string, unknown> = {}
  try {
    data = await r.json()
  } catch {
    data = { error: r.status === 401 ? 'unauthenticated' : 'unknown' }
  }
  return { status: r.status, data }
}
const time = (iso: string) =>
  new Date(iso).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
const focusId = requestParam(location.search)
let view: View | undefined

async function openMap(id: string) {
  const r = await call(`/requests/${encodeURIComponent(id)}/open`, 'POST', { via: 'page' })
  if (r.status === 200 && isMapUrl(r.data.url)) {
    location.assign(r.data.url)
    return
  }
  showFocus(errorText(r.data.error), 'bad')
  await refresh()
}
function showFocus(text: string, tone: 'good' | 'bad' | '', action?: { label: string; run: () => void }) {
  const box = el('focus')
  box.hidden = false
  box.className = `card ${tone}`
  box.replaceChildren()
  const p = document.createElement('p')
  p.textContent = text
  box.append(p)
  if (action) {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = action.label
    b.addEventListener('click', action.run)
    box.append(b)
  }
}
function renderFocus() {
  if (!focusId || !view) return
  const r = view.requests.find((q) => q.id === focusId)
  if (!r) return showFocus(errorText('not_found'), 'bad')
  if (r.state === 'pending')
    return showFocus(
      `「${r.name}」の地図を開けます（残り${remaining(r.expiresAt, Date.now())}秒）。通知からは開けなかったので、ここから開いてください。`,
      '',
      { label: '地図を開く', run: () => void openMap(r.id) },
    )
  const code = { opened: 'already_opened', expired: 'expired', cancelled: 'cancelled' }[r.state]
  showFocus(`「${r.name}」: ${errorText(code)}`, r.state === 'opened' ? 'good' : 'bad')
}
function render() {
  if (!view) return
  el('stop-state').textContent = view.stopped
    ? 'いまは止めています。通知は送られません。'
    : '動いています。送った通知は2分以内に1回だけ開けます。'
  el<HTMLButtonElement>('send').disabled = view.stopped
  el<HTMLButtonElement>('stop').disabled = view.stopped
  el<HTMLButtonElement>('resume').disabled = !view.stopped
  const select = el<HTMLSelectElement>('place')
  if (!select.options.length)
    for (const p of view.places) {
      const o = document.createElement('option')
      o.value = p.key
      o.textContent = p.name
      o.selected = p.key === view.defaultPlace
      select.append(o)
    }
  const pending = el('pending')
  pending.replaceChildren()
  const live = view.requests.find((r) => r.state === 'pending')
  if (live) {
    const p = document.createElement('p')
    p.textContent = `待ち: ${live.name}（残り${remaining(live.expiresAt, Date.now())}秒） ${pushText(live.push)}`
    const open = document.createElement('button')
    open.type = 'button'
    open.className = 'secondary'
    open.textContent = 'この端末で地図を開く'
    open.addEventListener('click', () => void openMap(live.id))
    const cancel = document.createElement('button')
    cancel.type = 'button'
    cancel.className = 'secondary'
    cancel.textContent = 'やめる'
    cancel.addEventListener('click', () => {
      void call(`/requests/${encodeURIComponent(live.id)}/cancel`, 'POST', {}).then(refresh)
    })
    const actions = document.createElement('div')
    actions.className = 'actions'
    actions.append(open, cancel)
    pending.append(p, actions)
  }
  const body = el('history')
  body.replaceChildren(
    ...[...view.requests].reverse().map((r) => {
      const tr = document.createElement('tr')
      for (const text of historyRow(r, time)) {
        const td = document.createElement('td')
        td.textContent = text
        tr.append(td)
      }
      return tr
    }),
  )
  renderFocus()
}
async function refresh() {
  try {
    const r = await call('')
    if (r.status !== 200) {
      el('stop-state').textContent = errorText(r.data.error)
      return
    }
    view = r.data as unknown as View
    render()
  } catch {
    el('stop-state').textContent = errorText('unknown')
  }
}
el('send').addEventListener('click', () => {
  void (async () => {
    el<HTMLButtonElement>('send').disabled = true
    const r = await call('/requests', 'POST', { place: el<HTMLSelectElement>('place').value })
    el('send-message').textContent =
      r.status === 201 ? `送りました。${pushText(r.data.push as PushOutcome | undefined)}` : errorText(r.data.error)
    await refresh()
  })()
})
for (const [id, stopped] of [
  ['stop', true],
  ['resume', false],
] as const)
  el(id).addEventListener('click', () => {
    void call('/stop', 'POST', { stopped }).then(refresh)
  })
void refresh()
setInterval(() => {
  if (!document.hidden) void refresh()
}, 5000)
