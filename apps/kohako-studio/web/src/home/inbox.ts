type Item = { eventId: string; source: string; ticketId?: string; title: string; body: string; choices?: string[]; receivedAt: string; readAt?: string; handledAt?: string; reply?: { replyId: string; kind: 'choice' | 'text'; value: string; requestId: string; status: string } }
export const replyText = (i: Pick<Item, 'title' | 'ticketId'>, kind: 'choice' | 'text', value: string) => `通知「${i.title}」${i.ticketId ? `（${i.ticketId}）` : ''}への${kind === 'choice' ? '選択' : '返信'}: ${value}`
export const stateLabel = (i: Pick<Item, 'readAt' | 'handledAt'>) => i.handledAt ? '処理済み' : i.readAt ? '既読' : '未読'
export function formatReceived(value: string, now = Date.now()) { const date = new Date(value), minutes = Math.max(0, Math.floor((now - date.getTime()) / 60000)); return `${date.toLocaleString('ja-JP')}（${minutes < 60 ? `${minutes}分` : `${Math.floor(minutes / 60)}時間`}前）` }
export function notificationParam(search: string) { const id = new URLSearchParams(search).get('notification'); return id && /^[A-Za-z0-9._:-]{8,200}$/.test(id) ? id : null }
export function initInbox(follow: (requestId: string, text: string) => boolean = () => false) {
  const el = (id: string) => document.getElementById(id)!, panel = el('inbox'), list = el('inbox-list'), detail = el('inbox-detail'), message = el('push-message')
  let notice = '', items: Item[] = [], selected = notificationParam(location.search), timer = 0
  const call = async (path: string, method = 'GET', body?: unknown) => { const r = await fetch(`/kohako/api/v1/${path}`, { method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) }); return { status: r.status, data: r.status === 204 ? null : await r.json() } }
  const button = (text: string, fn: () => void) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.addEventListener('click', fn); return b }
  const line = (parent: HTMLElement, text: string) => { const p = document.createElement('p'); p.textContent = text; parent.append(p) }
  const open = async (id: string) => { selected = id; panel.hidden = false; await call(`notifications/${encodeURIComponent(id)}/read`, 'POST'); await refresh() }
  function render() {
    list.replaceChildren(); detail.replaceChildren()
    for (const i of items) list.append(button(`${i.title}｜${i.source} ${i.ticketId ?? ''}｜${i.eventId.slice(0, 16)}｜${formatReceived(i.receivedAt)}｜${stateLabel(i)}`, () => { void open(i.eventId) }))
    const i = items.find(x => x.eventId === selected); if (!i) return
    line(detail, i.title); line(detail, i.body); line(detail, `${i.source} ${i.ticketId ?? ''} ${i.eventId} ${formatReceived(i.receivedAt)} ${stateLabel(i)}`)
    detail.append(button('処理済みにする', () => { void call(`notifications/${encodeURIComponent(i.eventId)}/handled`, 'POST').then(refresh) }))
    const status = document.createElement('p'); status.textContent = notice; notice = ''; detail.append(status)
    const send = async (kind: 'choice' | 'text', value: string) => {
      const key = `kohako-reply-${i.eventId}`, replyId = i.reply?.replyId ?? sessionStorage.getItem(key) ?? crypto.randomUUID(); sessionStorage.setItem(key, replyId)
      try {
        const result = await call(`notifications/${encodeURIComponent(i.eventId)}/reply`, 'POST', { replyId, kind, value })
        if (result.status >= 300) { status.textContent = '返信を送信できませんでした。'; return }
        if (result.data.status !== 'submitted') { status.textContent = `受付番号: ${result.data.requestId}（送信できませんでした。会話中でなければ同じ返信を再試行できます）`; return }
        track(result.data.requestId, replyText(i, kind, value)); await refresh()
      } catch { status.textContent = '返信を送信できませんでした。' }
    }
    // 「会話で続きを見る」も同じ返信を POST する。BFF が追跡中なら再実行せず受付番号を返し、再起動で追跡が消えていれば同じ受付番号で再送して追跡を再開する。
    // 返信は家の Web 会話へ送られるので、応答・承認要求・停止は会話画面の追跡で扱う（受信箱では受付番号だけを持つ）。
    const track = (requestId: string, text: string) => {
      if (follow(requestId, text)) { panel.hidden = true; return }
      notice = status.textContent = `返信は受付済みです（受付番号: ${requestId}）。いまは別の会話を追っているため、終わってから「会話で続きを見る」を押してください。`
    }
    if (i.reply && i.reply.status === 'submitted') { const r = i.reply; line(detail, `返信済み。受付番号: ${r.requestId}`); detail.append(button('会話で続きを見る', () => { void send(r.kind, r.value) })) }
    else if (i.reply) { const r = i.reply; line(detail, `「${r.value}」の送信を確認できませんでした（受付番号: ${r.requestId}）。同じ受付番号で再送できます。`); detail.append(button('同じ返信を再送', () => { void send(r.kind, r.value) })) }
    else if (i.choices?.length) for (const choice of i.choices) detail.append(button(choice, () => { void send('choice', choice) }))
    else { const input = document.createElement('textarea'); input.maxLength = 500; input.placeholder = '返信を入力'; detail.append(input, button('返信する', () => { if (input.value.trim()) void send('text', input.value) })) }
  }
  async function refresh() { try { const r = await call('notifications'); if (r.status === 503 && r.data?.error === 'notifications_disabled') { el('inbox-open').hidden = true; panel.hidden = true; return }; if (r.status !== 200) return; items = r.data.items; el('inbox-open').hidden = false; el('inbox-badge').textContent = r.data.unread ? `（${r.data.unread}）` : ''; render() } catch { /* 次回更新で再試行 */ } }
  el('inbox-open').addEventListener('click', () => { panel.hidden = !panel.hidden; void refresh() }); el('inbox-close').addEventListener('click', () => { panel.hidden = true })
  el('push-on').addEventListener('click', () => { void (async () => { try {
    if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) { message.textContent = 'このブラウザは通知に対応していません。'; return }
    if (await Notification.requestPermission() !== 'granted') { message.textContent = '通知は許可されていません。受信箱とTelegramで確認できます'; return }
    const key = await call('push/key'); if (key.status !== 200) throw Error()
    const reg = await navigator.serviceWorker.register('/kohako/sw.js', { scope: '/kohako/' }), raw = atob(key.data.publicKey.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(key.data.publicKey.length / 4) * 4, '=')), bytes = Uint8Array.from(raw, c => c.charCodeAt(0))
    const sub = await reg.pushManager.getSubscription() ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes }); const result = await call('push/subscriptions', 'POST', sub.toJSON()); if (result.status !== 201) throw Error(); message.textContent = 'この端末の通知を有効にしました。'
  } catch { message.textContent = '通知を設定できませんでした。' } })() })
  el('push-off').addEventListener('click', () => { void (async () => { try { const reg = await navigator.serviceWorker.getRegistration('/kohako/'), sub = await reg?.pushManager.getSubscription(); if (sub) { const result = await call('push/subscriptions', 'DELETE', { endpoint: sub.endpoint }); if (result.status !== 204) throw Error(); await sub.unsubscribe() }; message.textContent = 'この端末の通知をOFFにしました。' } catch { message.textContent = '通知をOFFにできませんでした。' } })() })
  navigator.serviceWorker?.addEventListener('message', e => { if (e.data?.type === 'open-notification' && notificationParam(`?notification=${encodeURIComponent(e.data.eventId)}`)) void open(e.data.eventId) })
  const schedule = () => { clearInterval(timer); if (!document.hidden) { void refresh().then(() => { if (selected && items.some(i => i.eventId === selected)) void open(selected) }); timer = window.setInterval(() => void refresh(), 60000) } }
  document.addEventListener('visibilitychange', schedule); schedule()
}
