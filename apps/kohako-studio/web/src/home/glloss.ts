// BOXP-663: 動く姿（WebGL）の描画コンテキストが失われた時の扱い。
// スマホで家を開き直した時（バックグラウンドからの復帰・GPU のメモリ逼迫）にブラウザが WebGL のコンテキストを捨てることがある。
// 以前は何もしていなかったため、canvas が空（端末によっては白い矩形）のまま残り、コハコが再読み込みまで消えていた。
// いまは失われたらすぐ静止画へ切り替え、コンテキストが戻ったら同じ canvas へ動く姿を読み直す。
// 状態の決め方だけをここに置き、画面の操作は main.ts が行う。

/**
 * none: 動く姿を使っていない（静止表情指定・読み込み前・読み込み失敗）。
 * live: 動く姿を描いている。lost: 失われて静止画で表示中。rebuilding: 戻ったので読み直している。
 */
export type RigGl = 'none' | 'live' | 'lost' | 'rebuilding'
/**
 * lost / restored: canvas の webglcontextlost / webglcontextrestored。
 * visible: 画面に戻った（visibilitychange・pageshow）。イベントを取りこぼしていても、その時点のコンテキストの状態で判断する。
 * rebuilt / failed: 読み直しが終わった・失敗した。
 */
export type GlEvent = 'lost' | 'restored' | 'visible' | 'rebuilt' | 'failed'
/** fallback: 静止画へ切り替える。rebuild: 動く姿を読み直す。show: 読み直した動く姿を出す。 */
export type GlAction = 'fallback' | 'rebuild' | 'show' | null

export function nextRigGl(now: RigGl, ev: GlEvent, contextLost: boolean): { next: RigGl; action: GlAction } {
  switch (now) {
    case 'none':
      return { next: 'none', action: null }
    case 'live':
      if (ev === 'lost' || (ev === 'visible' && contextLost)) return { next: 'lost', action: 'fallback' }
      return { next: 'live', action: null }
    case 'lost':
      if (ev === 'restored' || (ev === 'visible' && !contextLost)) return { next: 'rebuilding', action: 'rebuild' }
      return { next: 'lost', action: null }
    case 'rebuilding':
      // 読み直しの途中でまた失われた時は、終わった結果を出さずに静止画のまま次の復帰を待つ。
      if (ev === 'lost') return { next: 'lost', action: null }
      if (ev === 'rebuilt') return contextLost ? { next: 'lost', action: null } : { next: 'live', action: 'show' }
      if (ev === 'failed') return { next: 'lost', action: null }
      return { next: 'rebuilding', action: null }
  }
}
