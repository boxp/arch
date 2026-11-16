export function atBottom(scrollTop: number, clientHeight: number, scrollHeight: number, slack = 8): boolean {
  return scrollHeight - scrollTop - clientHeight <= slack
}

export function nextFollow(
  follow: boolean,
  lastTop: number,
  top: number,
  clientHeight: number,
  scrollHeight: number,
): boolean {
  if (atBottom(top, clientHeight, scrollHeight)) return true
  if (top < lastTop - 1) return false
  return follow
}

export function createFollower() {
  let follow = true,
    lastTop = 0
  const attached = new WeakSet<HTMLElement>()
  return {
    attach(el: HTMLElement) {
      if (attached.has(el)) return
      attached.add(el)
      el.addEventListener(
        'scroll',
        () => {
          if (!el.clientHeight) return
          follow = nextFollow(follow, lastTop, el.scrollTop, el.clientHeight, el.scrollHeight)
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
