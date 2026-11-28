import { must } from '../must'
import { renderMarkdown } from './markdown'
import { atBottom } from './scroll'
import { choiceButtonText, extractChoices } from './choices'
import { queuedAttempted } from './noticeReply'
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
/** BOXP-658: BFF の choicesOf と同じく、明示の choices が無ければ本文から抽出した選択肢を有効な値とする（送信直前の確認で正当な選択を無効扱いにしない）。 */
export const noticeChoiceValues = (i: Pick<Item, 'choices' | 'body'>): string[] =>
  i.choices ?? (extractChoices(i.body) ?? []).map((c) => c.value)
/** BOXP-646: 通知の選択肢ボタン。送る値は BFF が受け付ける記号（A など）のまま、表示だけ本文の説明を添える。 */
export function noticeChoices(i: Pick<Item, 'choices' | 'body'>): { value: string; text: string }[] {
  const labels = new Map((extractChoices(i.body) ?? []).map((c) => [c.value, c]))
  return (i.choices ?? []).map((value) => ({
    value,
    text: choiceButtonText(labels.get(value) ?? { value, label: '' }),
  }))
}
export const stateLabel = (i: Pick<Item, 'readAt' | 'handledAt'>) =>
  i.handledAt ? '処理済み' : i.readAt ? '既読' : '未読'
export function formatReceived(value: string, now = Date.now()) {
  const date = new Date(value),
    minutes = Math.max(0, Math.floor((now - date.getTime()) / 60000))
  return `${date.toLocaleString('ja-JP')}（${minutes < 60 ? `${minutes}分` : `${Math.floor(minutes / 60)}時間`}前）`
}
export function canVisitNotification(item: Pick<Item, 'source' | 'reply'>): boolean {
  return item.source === 'alertmanager' && !item.reply
}
export function notificationParam(search: string) {
  const id = new URLSearchParams(search).get('notification')
  return id && /^[A-Za-z0-9._:-]{8,200}$/.test(id) ? id : null
}
/**
 * BOXP-772: 検索文字列から notification パラメータだけを外す（他のパラメータの表記・順序は変えない）。
 * notification が無ければ null。
 */
export function withoutNotificationParam(search: string): string | null {
  const parts = search.replace(/^\?/, '').split('&'),
    isNotification = (p: string) => {
      try {
        return decodeURIComponent(p.split('=')[0].replace(/\+/g, ' ')) === 'notification'
      } catch {
        return false
      }
    }
  if (!search || !parts.some(isNotification)) return null
  const rest = parts.filter((p) => p && !isNotification(p))
  return rest.length ? `?${rest.join('&')}` : ''
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
/**
 * BOXP-658: 応答待ち・送信待ちがある間の通知返信を、家の会話の送信待ち（508 と同じ FIFO）へ積むための口。
 * 積んだ返信は送信待ちから同じ replyId で通知の返信 API へ送られる（受信箱からは送らない）。
 */
export type ReplyQueue = {
  /** いま返信を送らず送信待ちへ積むべきか。 */
  active: () => boolean
  add: (
    item: Item,
    kind: 'choice' | 'text',
    value: string,
    replyId: string,
    /** 'busy': この画面は空いていたが BFF が会話の進行中（別端末など）で断った。送信待ちは「再開」まで止める。 */
    held?: 'busy',
    /** サーバーに同じ replyId の返信記録がある（再送）。取消前に受理確認を必須にする。 */
    attempted?: boolean,
  ) => { ok: true } | { ok: false; message: string }
  /** その通知への返信が送信待ちにあれば、表示と保留理由を返す。 */
  pending: (eventId: string) => { text: string; held: string } | null
  cancel: (eventId: string) => void
}
export const QUEUED_REPLY_TEXT =
  '送信待ちに追加しました（まだ送信していません）。いまの返答が終わったら、送信待ちの順に送ります。やめるときは「取消」を押してください。'
export const QUEUED_BUSY_TEXT =
  'ほかの依頼がまだ進行中のため、返信は送らずに送信待ちに追加しました（まだ送信していません）。終わったら送信待ち欄の「再開」で送ります。やめるときは「取消」を押してください。'
export function initInbox(
  follow: (requestId: string, text: string) => boolean = () => false,
  announcer?: Announcer,
  replyQueue?: ReplyQueue,
) {
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
  // BOXP-772: 通知を押して開いた URL のジャンプは一覧取得の確定で 1 度だけ消費する（selected とは別に持つ）。
  let jump = selected
  let opening = !!selected,
    firstOpen = true,
    renderedKey: string | null = null
  const dropNotificationParam = () => {
    const search = withoutNotificationParam(location.search)
    if (search !== null) history.replaceState(history.state, '', `${location.pathname}${search}${location.hash}`)
  }
  if (!jump) dropNotificationParam()
  const drafts = new ReplyDrafts()
  const sending = new Set<string>()
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
    if (sending.has(i.eventId)) return false
    const key = `kohako-reply-${i.eventId}`,
      replyId = i.reply?.replyId ?? sessionStorage.getItem(key) ?? crypto.randomUUID()
    sessionStorage.setItem(key, replyId)
    // BOXP-658: 応答待ち・送信待ちがある間は BFF へ送らず送信待ちへ積む（受理済みの返信の「会話で続きを見る」は追跡だけなので積まない）。
    const enqueue = (held?: 'busy') => {
      const queued = must(replyQueue).add(i, kind, value, replyId, held, queuedAttempted(i.reply, replyId))
      if (!queued.ok) {
        status.textContent = queued.message
        return false
      }
      if (kind === 'text') drafts.clear(i.eventId)
      notice = status.textContent = held ? QUEUED_BUSY_TEXT : QUEUED_REPLY_TEXT
      renderedKey = null
      render()
      return true
    }
    if (replyQueue && i.reply?.status !== 'submitted' && replyQueue.active()) return enqueue()
    sending.add(i.eventId)
    try {
      const result = await call(`notifications/${encodeURIComponent(i.eventId)}/reply`, 'POST', {
        replyId,
        kind,
        value,
      })
      // BOXP-658: BFF は会話の進行中（別端末の依頼など）なら返信を保存せず 429 busy を返す。本文を失わないよう送信待ちへ積む。
      if (replyQueue && result.status === 429 && result.data?.error === 'busy') return enqueue('busy')
      if (result.status >= 300) {
        status.textContent = '返信を送信できませんでした。'
        return false
      }
      if (result.data.status !== 'submitted') {
        status.textContent = `返信を送信できませんでした。同じ返信を再試行できます（受付番号: ${result.data.requestId}）。`
        return false
      }
      await call(`notifications/${encodeURIComponent(i.eventId)}/read`, 'POST')
      drafts.clear(i.eventId)
      if (follow(result.data.requestId, replyText(i, kind, value))) panel.hidden = true
      else
        notice =
          status.textContent = `返信を受け付けました。いまの会話が終わってから、受信箱の「会話で続きを見る」を押してください（受付番号: ${result.data.requestId}）。`
      await refresh()
      return true
    } catch {
      status.textContent = '返信を送信できませんでした。'
      return false
    } finally {
      sending.delete(i.eventId)
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
        part('row-state', replyQueue?.pending(i.eventId) ? `${state}・送信待ち` : state),
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
    const queued = i ? (replyQueue?.pending(i.eventId) ?? null) : null
    const key = i ? detailKey(i) + JSON.stringify(queued) : null
    const meta = i
      ? `${sourceLabel(i.source)} ${i.ticketId ?? ''}・${formatReceived(i.receivedAt)}・${stateLabel(i)}・ID: ${i.eventId}`
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
    if (canVisitNotification(i))
      detail.append(
        button('見てきて', () => {
          void sendReply('text', '見てきて')
        }),
      )
    if (queued) {
      // 送信待ちの返信は「返信済み」「処理済み」とは別に、未送信であることと取消を出す（承認・返信の完了に見せない）。
      line(detail, `送信待ち（未送信）: ${queued.text}`).className = 'detail-queued'
      if (queued.held) line(detail, queued.held).className = 'detail-queued-hold'
      detail.append(
        button('取消', () => {
          replyQueue?.cancel(i.eventId)
          renderedKey = null
          render()
        }),
      )
    }
    if (i.reply && i.reply.status === 'submitted') {
      const r = i.reply
      line(detail, `返信済みです（受付番号: ${r.requestId}）。`)
      detail.append(
        button('会話で続きを見る', () => {
          void sendReply(r.kind, r.value)
        }),
      )
    } else if (i.reply) {
      const r = i.reply
      line(
        detail,
        `「${r.value}」の送信を確認できませんでした。同じ受付番号のまま再送できます（受付番号: ${r.requestId}）。`,
      )
      detail.append(
        button('同じ返信を再送', () => {
          void sendReply(r.kind, r.value)
        }),
      )
    } else if (!queued) {
      for (const choice of noticeChoices(i))
        detail.append(
          button(choice.text, () => {
            void sendReply('choice', choice.value)
          }),
        )
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
  /** 一覧の状態が確定した（取得できた・通知機能が無効と分かった）ら true。 */
  async function refresh(): Promise<boolean> {
    try {
      const r = await call('notifications')
      if (r.status === 503 && r.data?.error === 'notifications_disabled') {
        el('inbox-open').hidden = true
        panel.hidden = true
        return true
      }
      if (r.status !== 200) return false
      items = sortAscending(r.data.items)
      el('inbox-open').hidden = false
      el('inbox-badge').textContent = r.data.unread ? String(r.data.unread) : ''
      el('inbox-open').setAttribute('aria-label', r.data.unread ? `受信箱（未読 ${r.data.unread} 件）` : '受信箱')
      render()
      void tryAnnounce()
      return true
    } catch {
      /* 次回更新で再試行 */
      return false
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
          message.textContent =
            '通知が許可されていません。ブラウザのサイト設定から許可できます（未設定の間も受信箱とTelegramで確認できます）。'
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
        message.textContent = 'この端末の通知をONにしました。'
      } catch {
        message.textContent = 'この端末の通知をONにできませんでした。'
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
        message.textContent = 'この端末の通知をOFFにできませんでした。'
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
      // BOXP-772: 表示へ戻るたびに前の通知を開き直さない。開くのは保留中のジャンプだけで、一覧が確定したら消費する。
      void refresh().then((loaded) => {
        const id = jump
        if (!id || !loaded) {
          if (!id) opening = false
          return
        }
        jump = null
        dropNotificationParam()
        if (items.some((i) => i.eventId === id)) void openNotification(id)
        else opening = false
      })
      timer = window.setInterval(() => void refresh(), 60000)
    }
  }
  document.addEventListener('visibilitychange', schedule)
  schedule()
  return {
    retry: () => void tryAnnounce(),
    refresh: () => refresh(),
    /** 送信待ちの変化を詳細に反映する（入力中の返信とカーソル位置は保つ）。 */
    rerender: () => render(),
    /** 送信待ちから取り消した自由文の返信を、その通知の下書きへ戻す（入力中の下書きがあれば消さない）。 */
    restoreDraft: (eventId: string, value: string) => {
      if (!drafts.get(eventId).trim()) drafts.set(eventId, value)
    },
  }
}
