import { must } from '../must'
import { renderMarkdown } from './markdown'
import { atBottom } from './scroll'
export type Item = {
  eventId: string
  source: string
  ticketId?: string
  title: string
  body: string
  choices?: string[]
  receivedAt: string
  readAt?: string
  announcedAt?: string
  handledAt?: string
  reply?: { replyId: string; kind: 'choice' | 'text'; value: string; requestId: string; status: string }
}
export function sortAscending(items: Item[]): Item[] {
  const seen = new Set<string>()
  return items
    .filter((i) => {
      if (seen.has(i.eventId)) return false
      seen.add(i.eventId)
      return true
    })
    .sort((a, b) => {
      const x = Date.parse(a.receivedAt),
        y = Date.parse(b.receivedAt)
      return (
        (Number.isFinite(x) ? x : Infinity) - (Number.isFinite(y) ? y : Infinity) ||
        (a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0)
      )
    })
}
export const detailKey = (i: Item) =>
  JSON.stringify([i.eventId, i.title, i.body, i.source, i.ticketId, i.choices, i.reply])
export class ReplyDrafts {
  private drafts = new Map<string, string>()
  get(id: string) {
    return this.drafts.get(id) ?? ''
  }
  set(id: string, value: string) {
    this.drafts.set(id, value)
  }
  clear(id: string) {
    this.drafts.delete(id)
  }
}
export const sourceLabel = (source: string) =>
  source === 'task-board-report'
    ? 'Task Board'
    : source === 'hermes-cron'
      ? '定期通知'
      : source === 'alertmanager'
        ? 'アラート'
        : source
export const replyText = (i: Pick<Item, 'title' | 'ticketId'>, kind: 'choice' | 'text', value: string) =>
  `通知「${i.title}」${i.ticketId ? `（${i.ticketId}）` : ''}への${kind === 'choice' ? '選択' : '返信'}: ${value}`
export const stateLabel = (i: Pick<Item, 'readAt' | 'handledAt'>) =>
  i.handledAt ? '処理済み' : i.readAt ? '既読' : '未読'
export function formatReceived(value: string, now = Date.now()) {
  const date = new Date(value),
    minutes = Math.max(0, Math.floor((now - date.getTime()) / 60000))
  return `${date.toLocaleString('ja-JP')}（${minutes < 60 ? `${minutes}分` : `${Math.floor(minutes / 60)}時間`}前）`
}
export function notificationParam(search: string) {
  const id = new URLSearchParams(search).get('notification')
  return id && /^[A-Za-z0-9._:-]{8,200}$/.test(id) ? id : null
}
export function pickAnnouncements(items: Item[], now = Date.now()) {
  const candidates = announcementCandidates(items, now)
  return {
    item: candidates.length >= 4 ? candidates[candidates.length - 1] : candidates[0],
    more: candidates.length >= 4 ? candidates.length - 1 : 0,
  }
}
/** 案内対象の未提示通知（受信時刻の古い順） */
export function announcementCandidates(items: Item[], now = Date.now()) {
  return items
    .filter(
      (i) =>
        !i.readAt &&
        !i.handledAt &&
        !i.announcedAt &&
        !i.reply &&
        Number.isFinite(Date.parse(i.receivedAt)) &&
        now - Date.parse(i.receivedAt) <= 86400_000 &&
        Date.parse(i.receivedAt) <= now,
    )
    .sort((a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt))
}
type Announcer = {
  canAnnounce: () => boolean
  announce: (
    item: Item,
    actions: {
      send: (kind: 'choice' | 'text', value: string) => Promise<boolean>
      open: () => void
      later: () => void
    },
    more: number,
  ) => void
}
export function initInbox(follow: (requestId: string, text: string) => boolean = () => false, announcer?: Announcer) {
  const el = (id: string) => must(document.getElementById(id)),
    panel = el('inbox'),
    list = el('inbox-list'),
    detail = el('inbox-detail'),
    message = el('push-message')
  let notice = '',
    items: Item[] = [],
    selected = notificationParam(location.search),
    timer = 0,
    waiting = false,
    active = '',
    holdTimer = 0
  let opening = !!selected,
    firstOpen = true,
    renderedKey: string | null = null
  const drafts = new ReplyDrafts()
  const call = async (path: string, method = 'GET', body?: unknown) => {
    const r = await fetch(`/kohako/api/v1/${path}`, {
      method,
      ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    })
    return { status: r.status, data: r.status === 204 ? null : await r.json() }
  }
  const button = (text: string, fn: () => void) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = text
    b.addEventListener('click', fn)
    return b
  }
  const line = (parent: HTMLElement, text: string) => {
    const p = document.createElement('p')
    p.textContent = text
    parent.append(p)
    return p
  }
  const open = async (id: string) => {
    if (active === id) {
      active = ''
      clearTimeout(holdTimer)
    }
    selected = id
    panel.hidden = false
    await call(`notifications/${encodeURIComponent(id)}/read`, 'POST')
    await refresh()
  }
  const release = () => {
    active = ''
    clearTimeout(holdTimer)
    void refresh()
  }
  const send = async (i: Item, kind: 'choice' | 'text', value: string, status: HTMLElement) => {
    const key = `kohako-reply-${i.eventId}`,
      replyId = i.reply?.replyId ?? sessionStorage.getItem(key) ?? crypto.randomUUID()
    sessionStorage.setItem(key, replyId)
    try {
      const result = await call(`notifications/${encodeURIComponent(i.eventId)}/reply`, 'POST', {
        replyId,
        kind,
        value,
      })
      if (result.status >= 300) {
        status.textContent = '返信を送信できませんでした。'
        return false
      }
      if (result.data.status !== 'submitted') {
        status.textContent = `受付番号: ${result.data.requestId}（送信できませんでした。同じ返信を再試行できます）`
        return false
      }
      await call(`notifications/${encodeURIComponent(i.eventId)}/read`, 'POST')
      drafts.clear(i.eventId)
      if (follow(result.data.requestId, replyText(i, kind, value))) panel.hidden = true
      else
        notice =
          status.textContent = `返信は受付済みです（受付番号: ${result.data.requestId}）。会話が終わってから受信箱で「会話で続きを見る」を押してください。`
      await refresh()
      return true
    } catch {
      status.textContent = '返信を送信できませんでした。'
      return false
    }
  }
  async function tryAnnounce() {
    if (!announcer || waiting || active || opening || document.hidden || !announcer.canAnnounce()) return
    const picked = pickAnnouncements(items)
    if (!picked.item) return
    waiting = true
    try {
      // 表示前は短時間の仮押さえだけ（複数タブの同時表示防止）。案内済みは実際に表示した後に保存するので、
      // 仮押さえ後に表示できずページが閉じられても、期限後に再び案内される。
      // まとめて案内する場合は対象全件を仮押さえし、このタブが押さえた通知だけを案内する（他タブとの二重表示防止）。
      const targets = picked.more ? announcementCandidates(items) : [picked.item],
        claimed: Item[] = []
      for (const t of targets) {
        const result = await call(`notifications/${encodeURIComponent(t.eventId)}/announcing`, 'POST')
        if (result.status !== 200) continue
        if (result.data.claimed) claimed.push(t)
        else t.announcedAt = new Date().toISOString() // 他タブが表示中/表示済み。次の一覧更新でサーバー状態に戻る
      }
      if (!claimed.length) return
      const item = picked.more ? claimed[claimed.length - 1] : claimed[0],
        more = picked.more ? claimed.length - 1 : 0
      if (
        document.hidden ||
        opening ||
        active ||
        !announcer.canAnnounce() ||
        items.find((i) => i.eventId === item.eventId)?.readAt
      )
        return
      active = item.eventId
      holdTimer = window.setTimeout(release, 20000)
      const status = must(document.getElementById('notice-status'))
      announcer.announce(
        item,
        {
          send: async (kind, value) => {
            const ok = await send(item, kind, value, status)
            if (ok) release()
            return ok
          },
          open: () => {
            opening = true
            release()
            void open(item.eventId).finally(() => {
              opening = false
            })
          },
          later: release,
        },
        more,
      )
      for (const i of claimed) {
        const r = await call(`notifications/${encodeURIComponent(i.eventId)}/announced`, 'POST')
        if (r.status === 200) i.announcedAt = new Date().toISOString()
      }
    } catch {
      /* 次回更新で再試行 */
    } finally {
      waiting = false
    }
  }
  function render() {
    const top = list.scrollTop,
      bottom = firstOpen || atBottom(top, list.clientHeight, list.scrollHeight)
    list.replaceChildren()
    // 一覧の行: 状態の印・題名・出どころ・受信時刻。区切りの「｜」と受付 ID は読み上げ・検証用に文字として残し、見た目は CSS で整える。
    for (const i of items) {
      const row = button('', () => {
          void open(i.eventId)
        }),
        state = stateLabel(i),
        part = (cls: string, text: string) => {
          const s = document.createElement('span')
          s.className = cls
          s.textContent = text
          return s
        }
      row.className = 'inbox-row'
      row.dataset.state = i.handledAt ? 'handled' : i.readAt ? 'read' : 'unread'
      if (i.eventId === selected) row.setAttribute('aria-current', 'true')
      row.append(
        part('row-title', i.title),
        part('row-sep', '｜'),
        part('row-chip', `${sourceLabel(i.source)} ${i.ticketId ?? ''}`.trim()),
        part('row-sep', `｜${i.eventId.slice(0, 16)}｜`),
        part('row-time', formatReceived(i.receivedAt)),
        part('row-sep', '｜'),
        part('row-state', state),
      )
      list.append(row)
    }
    if (!items.length) {
      const p = document.createElement('p')
      p.className = 'empty'
      p.textContent = '通知はありません。'
      list.append(p)
    }
    if (!panel.hidden) {
      list.scrollTop = bottom ? list.scrollHeight : top
      firstOpen = false
    }
    const i = items.find((x) => x.eventId === selected)
    const key = i ? detailKey(i) : null
    const meta = i
      ? `${sourceLabel(i.source)} ${i.ticketId ?? ''} ${i.eventId} ${formatReceived(i.receivedAt)} ${stateLabel(i)}`
      : ''
    if (i && key === renderedKey && !notice) {
      const row = detail.querySelector('.detail-meta')
      if (row) row.textContent = meta
      return
    }
    const previous = detail.querySelector('textarea'),
      focused = previous && document.activeElement === previous
    const start = focused ? previous.selectionStart : 0,
      end = focused ? previous.selectionEnd : 0
    detail.replaceChildren()
    renderedKey = key
    if (!i) return
    line(detail, i.title).className = 'detail-title'
    const content = document.createElement('div')
    content.className = 'md'
    content.append(renderMarkdown(i.body))
    detail.append(content)
    line(detail, meta).className = 'detail-meta'
    const handled = button('処理済みにする', () => {
      void call(`notifications/${encodeURIComponent(i.eventId)}/handled`, 'POST').then(refresh)
    })
    handled.className = 'secondary'
    detail.append(handled)
    const status = document.createElement('p')
    status.className = 'detail-status'
    status.setAttribute('role', 'status')
    status.textContent = notice
    notice = ''
    detail.append(status)
    const sendReply = (kind: 'choice' | 'text', value: string) => send(i, kind, value, status)
    if (i.reply && i.reply.status === 'submitted') {
      const r = i.reply
      line(detail, `返信済み。受付番号: ${r.requestId}`)
      detail.append(
        button('会話で続きを見る', () => {
          void sendReply(r.kind, r.value)
        }),
      )
    } else if (i.reply) {
      const r = i.reply
      line(
        detail,
        `「${r.value}」の送信を確認できませんでした（受付番号: ${r.requestId}）。同じ受付番号で再送できます。`,
      )
      detail.append(
        button('同じ返信を再送', () => {
          void sendReply(r.kind, r.value)
        }),
      )
    } else if (i.choices?.length)
      for (const choice of i.choices)
        detail.append(
          button(choice, () => {
            void sendReply('choice', choice)
          }),
        )
    else {
      const input = document.createElement('textarea')
      input.maxLength = 500
      input.placeholder = '返信を入力'
      input.value = drafts.get(i.eventId)
      input.addEventListener('input', () => drafts.set(i.eventId, input.value))
      detail.append(
        input,
        button('返信する', () => {
          if (input.value.trim()) void sendReply('text', input.value)
        }),
      )
      if (focused) {
        input.focus()
        input.setSelectionRange(start, end)
      }
    }
  }
  async function refresh() {
    try {
      const r = await call('notifications')
      if (r.status === 503 && r.data?.error === 'notifications_disabled') {
        el('inbox-open').hidden = true
        panel.hidden = true
        return
      }
      if (r.status !== 200) return
      items = sortAscending(r.data.items)
      el('inbox-open').hidden = false
      el('inbox-badge').textContent = r.data.unread ? String(r.data.unread) : ''
      el('inbox-open').setAttribute('aria-label', r.data.unread ? `受信箱（未読 ${r.data.unread} 件）` : '受信箱')
      render()
      void tryAnnounce()
    } catch {
      /* 次回更新で再試行 */
    }
  }
  el('inbox-open').addEventListener('click', () => {
    panel.hidden = !panel.hidden
    void refresh()
  })
  el('inbox-close').addEventListener('click', () => {
    panel.hidden = true
  })
  el('push-on').addEventListener('click', () => {
    void (async () => {
      try {
        if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
          message.textContent = 'このブラウザは通知に対応していません。'
          return
        }
        if ((await Notification.requestPermission()) !== 'granted') {
          message.textContent = '通知は許可されていません。受信箱とTelegramで確認できます'
          return
        }
        const key = await call('push/key')
        if (key.status !== 200) throw Error()
        const reg = await navigator.serviceWorker.register('/kohako/sw.js', { scope: '/kohako/' }),
          raw = atob(
            key.data.publicKey
              .replace(/-/g, '+')
              .replace(/_/g, '/')
              .padEnd(Math.ceil(key.data.publicKey.length / 4) * 4, '='),
          ),
          bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0))
        const sub =
          (await reg.pushManager.getSubscription()) ??
          (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes }))
        const result = await call('push/subscriptions', 'POST', sub.toJSON())
        if (result.status !== 201) throw Error()
        message.textContent = 'この端末の通知を有効にしました。'
      } catch {
        message.textContent = '通知を設定できませんでした。'
      }
    })()
  })
  el('push-off').addEventListener('click', () => {
    void (async () => {
      try {
        const reg = await navigator.serviceWorker.getRegistration('/kohako/'),
          sub = await reg?.pushManager.getSubscription()
        if (sub) {
          const result = await call('push/subscriptions', 'DELETE', { endpoint: sub.endpoint })
          if (result.status !== 204) throw Error()
          await sub.unsubscribe()
        }
        message.textContent = 'この端末の通知をOFFにしました。'
      } catch {
        message.textContent = '通知をOFFにできませんでした。'
      }
    })()
  })
  navigator.serviceWorker?.addEventListener('message', (e) => {
    if (
      e.data?.type === 'open-notification' &&
      notificationParam(`?notification=${encodeURIComponent(e.data.eventId)}`)
    )
      void openNotification(e.data.eventId)
  })
  async function openNotification(id: string) {
    opening = true
    try {
      await call(`notifications/${encodeURIComponent(id)}/announced`, 'POST')
      await open(id)
    } finally {
      opening = false
    }
  }
  const schedule = () => {
    clearInterval(timer)
    if (!document.hidden) {
      void refresh().then(() => {
        if (selected && items.some((i) => i.eventId === selected)) void openNotification(selected)
        else opening = false
      })
      timer = window.setInterval(() => void refresh(), 60000)
    }
  }
  document.addEventListener('visibilitychange', schedule)
  schedule()
  return { retry: () => void tryAnnounce() }
}
