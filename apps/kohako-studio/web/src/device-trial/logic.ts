// BOXP-752: 家から端末へ 1 タップで地図を開く試験ページの表示の決まり。
// 仕様: Obsidian Projects/kohako-device-delegation/trial-spec.md（決まり 4・9・10）。
export type DeviceState = 'pending' | 'opened' | 'expired' | 'cancelled'

/** SW と同じ判定: 開くのは Google マップの検索 URL だけ。 */
export function isMapUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    const u = new URL(value)
    return (
      u.protocol === 'https:' &&
      u.hostname === 'www.google.com' &&
      u.pathname === '/maps/search/' &&
      !u.username &&
      !u.password &&
      !u.port
    )
  } catch {
    return false
  }
}

export function requestParam(search: string): string | null {
  const id = new URLSearchParams(search).get('request')
  return id && /^[A-Za-z0-9-]{8,64}$/.test(id) ? id : null
}

export const STATE_LABEL: Record<DeviceState, string> = {
  pending: '待ち',
  opened: '開いた',
  expired: '期限切れ',
  cancelled: '取消',
}

const ERROR_TEXT: Record<string, string> = {
  invalid: '行き先が一覧にありません。',
  stopped: '端末への依頼は止めてあります。再開してから送ってください。',
  pending_exists: 'まだ待ちの依頼があります。開くか、やめるか、2分待ってください。',
  too_many: '1時間に送れる回数（10回）に達しました。少し待ってください。',
  already_opened: 'この依頼は開封済みです（1件は1回だけ開けます）。',
  expired: 'この依頼は期限切れです（2分）。もう一度送ってください。',
  cancelled: 'この依頼は取り消されています（やめた・停止した）。',
  not_found: 'この依頼は見つかりません。',
  forbidden: 'この操作はご本人のログインでだけできます。',
  unauthenticated: 'ログインが切れています。ページを読み込み直してください。',
  device_trial_disabled: 'この家では試験が無効です。',
}
export const errorText = (code: unknown) =>
  (typeof code === 'string' && ERROR_TEXT[code]) || 'うまくいきませんでした。少し待ってからもう一度試してください。'

export type PushOutcome = { sent: number; errors: number; skipped?: 'no-subscriptions' | 'error' }
export function pushText(p: PushOutcome | undefined): string {
  if (!p) return ''
  if (p.skipped === 'no-subscriptions')
    return '通知を受け取る端末がありません。各端末の家の「受信箱」→「通知をONにする」を先に押してください。'
  if (!p.sent) return '通知を送れませんでした。このページの「地図を開く」からは開けます。'
  return `${p.sent}台の端末に通知を送りました${p.errors ? `（${p.errors}台は失敗）` : ''}。`
}

/** 残り時間（秒、0 未満は 0）。 */
export const remaining = (expiresAt: string, now: number) =>
  Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 1000))

/** 決まり 10: 履歴の 1 行。送った時刻・行き先・結果・結果の時刻・経路・秒。 */
export type HistoryReq = {
  name: string
  state: DeviceState
  createdAt: string
  endedAt?: string
  via?: 'notification' | 'page'
  seconds?: number
}
export function historyRow(r: HistoryReq, time: (iso: string) => string): string[] {
  return [
    time(r.createdAt),
    r.name,
    STATE_LABEL[r.state],
    r.endedAt ? time(r.endedAt) : '',
    r.via === 'notification' ? '通知' : r.via === 'page' ? 'ページ' : '',
    r.seconds === undefined ? '' : String(r.seconds),
  ]
}
