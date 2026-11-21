// BOXP-648: 本人が「現在地をコハコに伝える」を ON にしている間だけ、送信のたびにこの端末の位置を 1 回取得して
// その発言に添える。背景での追跡・履歴の蓄積・ブラウザ保存はしない（直近の 1 件をこのタブのメモリにだけ持つ）。
/** 位置を添えられなかった理由。BFF はこれを「現在地なし」として扱い、以前の位置を現在地と断定させない。 */
export type LocationMiss = 'off' | 'denied' | 'unavailable' | 'timeout' | 'unsupported' | 'stale'
export type LocationPayload =
  | { status: 'ok'; lat: number; lon: number; accuracy: number; capturedAt: number }
  | { status: LocationMiss }
export type Fix = { lat: number; lon: number; accuracy: number; capturedAt: number }
/** 直近の取得をそのまま使ってよい期間（同じ場所で続けて話すときにブラウザへ毎回問い合わせない）。 */
export const REUSE_MS = 2 * 60_000
/** これより古い位置は現在地として送らない（BFF も同じ上限で古い扱いにする）。 */
export const FRESH_MS = 10 * 60_000
export const TIMEOUT_MS = 6000

const round = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits

/** GeolocationPositionError.code（1=拒否, 2=取得不可, 3=時間切れ）を理由へ変換する。 */
export function missOf(code: unknown): LocationMiss {
  return code === 1 ? 'denied' : code === 3 ? 'timeout' : 'unavailable'
}

/** 座標は約 1m（小数 5 桁）に丸め、精度は整数 m。範囲外・非数は捨てる。 */
export function fixOf(
  coords: { latitude: number; longitude: number; accuracy: number },
  timestamp: number,
): Fix | null {
  const { latitude: lat, longitude: lon, accuracy } = coords
  if (![lat, lon, accuracy, timestamp].every(Number.isFinite)) return null
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180 || accuracy < 0) return null
  return { lat: round(lat, 5), lon: round(lon, 5), accuracy: Math.max(1, Math.round(accuracy)), capturedAt: timestamp }
}

export function payloadOf(fix: Fix | null, miss: LocationMiss, now: number): LocationPayload {
  if (!fix) return { status: miss }
  if (now - fix.capturedAt > FRESH_MS) return { status: 'stale' }
  return { status: 'ok', ...fix }
}

type Geo = Pick<Geolocation, 'getCurrentPosition'>
/** 位置を 1 回だけ取得する（watchPosition は使わない）。失敗は理由として返し、例外にしない。 */
export function acquire(geo: Geo | undefined, now: () => number): Promise<{ fix: Fix | null; miss: LocationMiss }> {
  if (!geo) return Promise.resolve({ fix: null, miss: 'unsupported' })
  return new Promise((resolve) => {
    let done = false
    const finish = (v: { fix: Fix | null; miss: LocationMiss }) => {
      if (done) return
      done = true
      clearTimeout(guard)
      resolve(v)
    }
    // 許可ダイアログが開いたまま放置されると timeout が効かないブラウザがあるため、送信を待たせすぎない上限を別に持つ。
    const guard = setTimeout(() => finish({ fix: null, miss: 'timeout' }), TIMEOUT_MS + 2000)
    try {
      geo.getCurrentPosition(
        (p) => {
          const fix = fixOf(p.coords, Number.isFinite(p.timestamp) ? p.timestamp : now())
          finish(fix ? { fix, miss: 'unavailable' } : { fix: null, miss: 'unavailable' })
        },
        (e) => finish({ fix: null, miss: missOf(e?.code) }),
        { enableHighAccuracy: true, maximumAge: REUSE_MS, timeout: TIMEOUT_MS },
      )
    } catch {
      finish({ fix: null, miss: 'unavailable' })
    }
  })
}

const clock = (t: number) =>
  new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' }).format(t)
const ago = (ms: number) => (ms < 60_000 ? 'たった今' : `${Math.floor(ms / 60_000)}分前`)
const meters = (m: number) => (m >= 1000 ? `約${round(m / 1000, 1)}km` : `約${m}m`)

/** 設定欄・入力欄に出す状態文。座標の数値は画面に出さない（肩越しや画面共有で漏れないように）。 */
export function describe(enabled: boolean, fix: Fix | null, miss: LocationMiss | null, now: number): string {
  if (!enabled) return '位置を共有していません。コハコには現在地を伝えません。'
  if (fix && now - fix.capturedAt <= FRESH_MS)
    return `位置を共有中: ${clock(fix.capturedAt)}取得（${ago(now - fix.capturedAt)}）・精度${meters(fix.accuracy)}${fix.accuracy > 1000 ? '（おおまか）' : ''}。送信のたびに取り直します。`
  if (miss === 'denied')
    return '位置の利用がブラウザで許可されていません。ブラウザ（またはOS）のサイト設定で位置情報を許可してください。許可されるまで現在地は伝えません。'
  if (miss === 'unsupported') return 'この端末・ブラウザでは位置情報を取得できません。現在地は伝えません。'
  if (miss === 'timeout')
    return '位置を時間内に取得できませんでした。次の送信で取り直します（それまで現在地は伝えません）。'
  if (miss === 'unavailable')
    return '位置を取得できませんでした。次の送信で取り直します（それまで現在地は伝えません）。'
  if (fix || miss === 'stale') return '前回の位置は古いため、現在地としては伝えません。次の送信で取り直します。'
  return '位置の共有がONです。次の送信時に位置を取得します（初回はブラウザの許可が必要です）。'
}

/** 入力欄の上に出す短い表示（共有中であることと鮮度だけ）。取れていない時は設定欄と同じ理由を出す。 */
export function noteOf(fix: Fix | null, miss: LocationMiss | null, now: number): string {
  if (fix && now - fix.capturedAt <= FRESH_MS)
    return `📍 位置を共有中（${clock(fix.capturedAt)}取得・精度${meters(fix.accuracy)}${fix.accuracy > 1000 ? '・おおまか' : ''}）`
  return `📍 ${describe(true, fix, miss, now)}`
}

/**
 * BOXP-648: 現場（見てきて）の依頼には位置を添えない。BFF の isVisitText（bff/src/visit.ts）と同じ言い回しで判定し、
 * ボタン・手入力・受理未確認の再送のどれでも同じ扱いにする（BFF 側でも捨てる）。
 */
export function isVisitText(text: string): boolean {
  const value = text
    .normalize('NFKC')
    .trim()
    .replace(/[。!]+$/u, '')
    .trim()
  return [
    'プラグイン',
    'プラグインして',
    '見てきて',
    '現場を見てきて',
    '自宅クラスタを見てきて',
    'クラスタを見てきて',
  ].includes(value)
}
