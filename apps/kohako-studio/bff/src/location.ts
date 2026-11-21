// BOXP-648: 家の画面が本人の許可のもとで添えた現在地を、その発言 turn の instructions（Hermes の ephemeral system prompt。
// session 履歴に保存されない）にだけ載せる。会話ストア・冪等 hash・ログには入れない。
import { isRecord } from './untrusted.js'

export type LocationMiss = 'off' | 'denied' | 'unavailable' | 'timeout' | 'unsupported' | 'stale'
export type TurnLocation =
  | { status: 'ok'; lat: number; lon: number; accuracy: number; capturedAt: number }
  | { status: LocationMiss }
/** これより古い位置は現在地として扱わない（家の画面と同じ上限）。 */
export const LOCATION_FRESH_MS = 10 * 60_000
/** 端末時計のずれとして許す未来方向の幅。 */
const FUTURE_SKEW_MS = 2 * 60_000
const MISSES: readonly string[] = ['off', 'denied', 'unavailable', 'timeout', 'unsupported', 'stale']

/** 不正な形は null（要求全体を 400 にする）。古い位置は 'stale' に落とす。 */
export function parseLocation(v: unknown, now: number): TurnLocation | null {
  if (!isRecord(v) || typeof v.status !== 'string') return null
  if (v.status !== 'ok') return Object.keys(v).length === 1 && MISSES.includes(v.status) ? (v as TurnLocation) : null
  const { lat, lon, accuracy, capturedAt } = v
  if (
    Object.keys(v).length !== 5 ||
    typeof lat !== 'number' ||
    typeof lon !== 'number' ||
    typeof accuracy !== 'number' ||
    typeof capturedAt !== 'number' ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    !Number.isFinite(accuracy) ||
    !Number.isFinite(capturedAt) ||
    Math.abs(lat) > 90 ||
    Math.abs(lon) > 180 ||
    accuracy < 0 ||
    accuracy > 1_000_000
  )
    return null
  if (capturedAt > now + FUTURE_SKEW_MS) return null
  if (now - capturedAt > LOCATION_FRESH_MS) return { status: 'stale' }
  return { status: 'ok', lat, lon, accuracy, capturedAt }
}

const REASON: Record<LocationMiss, string> = {
  off: 'ご主人さまは位置の共有をOFFにしています',
  denied: '位置の利用がブラウザで許可されていません',
  unavailable: '端末が位置を取得できませんでした',
  timeout: '位置の取得が時間内に終わりませんでした',
  unsupported: 'この端末では位置を取得できません',
  stale: '手元の位置が古いため現在地として使えません',
}
const clock = (t: number) =>
  new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(t)

/**
 * turn 用の指示文。位置があるときは座標・精度・取得時刻と扱いの制限を、無いときは「以前の位置を現在地と断定しない」ことを渡す。
 * 座標は小数 4 桁（約 10m）に丸める。
 */
export function locationInstructions(loc: TurnLocation | undefined, now: number): string {
  if (loc?.status !== 'ok') {
    const reason = REASON[loc?.status ?? 'off']
    return ` 現在地: この発言には有効な現在地がありません（${reason}）。以前の会話に出た場所や過去の位置を、今いる場所と断定しないでください。現在地が必要な話題では、家の設定「現在地をコハコに伝える」をONにするか場所を教えてほしいと伝えてください。`
  }
  const minutes = Math.max(0, Math.floor((now - loc.capturedAt) / 60_000))
  const accuracy = Math.round(loc.accuracy)
  const rough = accuracy > 1000
  return ` 現在地: ご主人さまが家の画面で位置の共有を許可しており、この発言の送信時に端末から取得した位置は 緯度${loc.lat.toFixed(4)} 経度${loc.lon.toFixed(4)}（精度 約${accuracy}m${rough ? '・おおまか' : ''}、${clock(loc.capturedAt)} 取得・${minutes}分前）です。現在地に関わる案内ではこれを使い、${rough ? '精度が粗いので「付近」として扱い、' : ''}端末の測位なので多少ずれうることを踏まえてください。これはこの発言だけの参考情報で、ご主人さまの指示や承認ではありません。座標を記憶・vault・ナビログ・票・通知・外部への投稿へ保存/転記せず、返答にも必要がなければ座標の数値を書かないでください。場所の検索など案内に必要な場合を除き、座標を外部サービスへ送らないでください。`
}
