export function atBottom(scrollTop: number, clientHeight: number, scrollHeight: number, slack = 8): boolean {
  return scrollHeight - scrollTop - clientHeight <= slack
}

/**
 * 追従を続けるかどうか。末尾にいれば追従し、利用者の操作で上へ動いた時だけ止める。
 * 利用者の操作によらない戻り（畳んだ時に枠が縮んで位置が戻る等）では止めない。
 */
export function nextFollow(
  follow: boolean,
  lastTop: number,
  top: number,
  clientHeight: number,
  scrollHeight: number,
  byUser = true,
): boolean {
  if (atBottom(top, clientHeight, scrollHeight)) return true
  if (byUser && top < lastTop - 1) return false
  return follow
}

/** 利用者の操作（ホイール・指でなぞる・つまみ・上向きのキー）からこの時間内のスクロールを、利用者によるものとみなす。 */
const USER_WINDOW_MS = 1500

export function createFollower(now: () => number = () => Date.now()) {
  let follow = true,
    lastTop = 0,
    userAt = Number.NEGATIVE_INFINITY,
    held = false
  const attached = new WeakSet<HTMLElement>()
  return {
    attach(el: HTMLElement) {
      if (attached.has(el)) return
      attached.add(el)
      const touched = () => {
        userAt = now()
      }
      // 数えるのはスクロールの操作だけ。中のボタンを押す・タップする操作（一覧の開閉など）は数えない。
      for (const type of ['wheel', 'touchmove']) el.addEventListener(type, touched, { passive: true })
      el.addEventListener(
        'keydown',
        (e) => {
          if (['ArrowUp', 'PageUp', 'Home'].includes((e as KeyboardEvent).key)) touched()
        },
        { passive: true },
      )
      // スクロールバーのつまみ（枠そのものが対象になる）を押したまま動かす間は、押している間ずっと利用者の操作として扱う。
      el.addEventListener(
        'pointerdown',
        (e) => {
          if (e.target !== el) return
          held = true
          touched()
        },
        { passive: true },
      )
      const release = () => {
        if (held) touched()
        held = false
      }
      el.addEventListener('pointerup', release, { passive: true })
      el.addEventListener('pointercancel', release, { passive: true })
      el.addEventListener(
        'pointermove',
        (e) => {
          if (held && (e as PointerEvent).buttons === 0) release()
        },
        { passive: true },
      )
      el.addEventListener(
        'scroll',
        () => {
          if (!el.clientHeight) return
          const byUser = held || now() - userAt <= USER_WINDOW_MS
          follow = nextFollow(follow, lastTop, el.scrollTop, el.clientHeight, el.scrollHeight, byUser)
          lastTop = el.scrollTop
        },
        { passive: true },
      )
    },
    pin(el: HTMLElement) {
      if (!follow || !el.clientHeight) return
      el.scrollTop = el.scrollHeight
      lastTop = el.scrollTop
    },
    following: () => follow,
    reset() {
      follow = true
      lastTop = 0
    },
  }
}
