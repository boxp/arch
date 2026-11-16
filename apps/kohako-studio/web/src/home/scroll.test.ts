import { describe, expect, it } from 'vitest'
import { createFollower, nextFollow } from './scroll'

describe('nextFollow', () => {
  it('末尾では追従する', () => expect(nextFollow(false, 0, 100, 100, 200)).toBe(true))
  it('上へ動いたら追従を止める', () => expect(nextFollow(true, 100, 50, 100, 300)).toBe(false))
  it('利用者の操作によらない戻りでは追従を止めない', () =>
    expect(nextFollow(true, 100, 50, 100, 300, false)).toBe(true))
  it('追従中に内容が伸びても追従する', () => expect(nextFollow(true, 100, 100, 100, 300)).toBe(true))
  it('追従停止中に内容が伸びても停止したまま', () => expect(nextFollow(false, 50, 50, 100, 300)).toBe(false))
  it('末尾に戻ると追従を再開する', () => expect(nextFollow(false, 50, 200, 100, 300)).toBe(true))
})

function fake() {
  const handlers = new Map<string, (e: unknown) => void>()
  const el = {
    clientHeight: 100,
    scrollHeight: 300,
    scrollTop: 200,
    addEventListener: (type: string, fn: (e: unknown) => void) => handlers.set(type, fn),
  } as unknown as HTMLElement
  let time = 0
  const follower = createFollower(() => time)
  follower.attach(el)
  const fire = (type: string, e: unknown = {}) => handlers.get(type)?.(e)
  fire('scroll')
  return {
    el,
    follower,
    fire,
    advance: (ms: number) => {
      time += ms
    },
  }
}

describe('createFollower', () => {
  it('利用者がホイールで上へ戻したら追従を止め、pin しても動かさない', () => {
    const { el, follower, fire } = fake()
    fire('wheel')
    el.scrollTop = 0
    fire('scroll')
    expect(follower.following()).toBe(false)
    follower.pin(el)
    expect(el.scrollTop).toBe(0)
  })
  it('利用者の操作がない戻り（畳んだ時に位置が戻る等）では追従を止めない', () => {
    const { el, follower, fire } = fake()
    el.scrollTop = 0
    fire('scroll')
    expect(follower.following()).toBe(true)
    follower.pin(el)
    expect(el.scrollTop).toBe(300)
  })
  it('操作から時間が経った後の戻りでは追従を止めない', () => {
    const { el, follower, fire, advance } = fake()
    fire('wheel')
    advance(5000)
    el.scrollTop = 0
    fire('scroll')
    expect(follower.following()).toBe(true)
  })
  it('つまみを押している間は、時間が経っても利用者の操作として扱う', () => {
    const { el, follower, fire, advance } = fake()
    fire('pointerdown', { target: el })
    advance(5000)
    el.scrollTop = 0
    fire('scroll')
    expect(follower.following()).toBe(false)
  })
  it('中のボタンを押す操作やタップは利用者のスクロールとして数えない', () => {
    const { el, follower, fire } = fake()
    fire('pointerdown', { target: {} })
    fire('keydown', { key: 'Enter' })
    el.scrollTop = 0
    fire('scroll')
    expect(follower.following()).toBe(true)
  })
  it('上向きのキーは利用者のスクロールとして数える', () => {
    const { el, follower, fire } = fake()
    fire('keydown', { key: 'PageUp' })
    el.scrollTop = 0
    fire('scroll')
    expect(follower.following()).toBe(false)
  })
  it('上へ戻して追従が止まっていても、reset の後は末尾へ送る', () => {
    const { el, follower, fire } = fake()
    fire('wheel')
    el.scrollTop = 0
    fire('scroll')
    follower.reset()
    follower.pin(el)
    expect(el.scrollTop).toBe(300)
    expect(follower.following()).toBe(true)
  })
})
