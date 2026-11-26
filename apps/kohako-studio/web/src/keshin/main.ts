// BOXP-716: Keshin2D（MIT、public/kohako/keshin/ に同梱）でコハコを動かす本人限定の試作。いつもの家・会話・通常版は変えない。
// 仕様は vault の Projects/kohako-home/keshin2d-trial-716.md。座る決まりは通常版の home/seat.ts（いつ・どれだけ）と live2d/seat.ts（絵の置き方）をそのまま使う。
// 会話の API は呼ばない（台本で 聞いている → 考えている → 話している を再現する）。
import '../home/room.css'
import './style.css'
import { SeatDirector, type SeatFrame } from '../home/seat'
import {
  ART,
  artOpacity,
  CHAIR_RISE,
  ease,
  followWeight,
  legOpacity,
  mendThighs,
  SEAT,
  SEAT_RISE,
  seatLift,
} from '../live2d/seat'
import { K2D, lookAt, skirtK, stateAt, type TalkState, toK, toModel } from './map'

type Out = number[]
type Deform = (x: number, y: number, out: Out) => void
type Layer = { name: string; path: string; src: string }
type K2DApi = {
  mouse: { x: number; y: number }
  VIEW: { cx: number; cy: number; half: number }
  setExpr(name: string): void
  talk(on: boolean): void
}

const frame = document.getElementById('k2d') as HTMLIFrameElement
const k2d = () => (frame.contentWindow as (Window & { __k2d?: K2DApi }) | null)?.__k2d
const query = new URLSearchParams(location.search)
// 録画用（?rec=1）: 操作の帯を隠す。
if (query.get('rec') === '1') document.body.dataset.rec = '1'

// ---- 座る（home/seat.ts の係をそのまま使う。自動で座る予定は入れず、ボタンと台本でだけ座る） ----
const director = new SeatDirector(() => 1, [1e9, 1e9])
let seat: SeatFrame = { phase: 'standing', level: 0, chair: 0, swingLeft: 0, swingRight: 0, offset: 0, moving: false }
let lastOffset = 0

const one = () => 1
/** 層ごとの動き（Keshin2D の classify の前に呼ばれる）。null なら Keshin2D の既定の動き。 */
function part(L: Layer, ctx: { bodyT: Deform }): { cell: number; deform: Deform; alpha?: () => number } | null {
  const { bodyT } = ctx
  const t = [0, 0]
  const lerpInto = (out: Out, x: number, y: number, w: number) => {
    bodyT(x, y, t)
    out[0] = x + (t[0] - x) * w
    out[1] = y + (t[1] - y) * w
  }
  switch (L.path) {
    case '座り/椅子':
      return {
        cell: 40,
        alpha: () => seat.chair,
        deform: (x, y, out) => {
          const [mx, my] = toModel(x, y)
          const [kx, ky] = toK(mx, my + CHAIR_RISE * (1 - ease(seat.chair)))
          out[0] = kx
          out[1] = ky
        },
      }
    case '座り/影':
      return {
        cell: 40,
        alpha: () => artOpacity(seat.level),
        deform: (x, y, out) => {
          out[0] = x
          out[1] = y
        },
      }
    case '座り/太もも':
      // S8.6: 上のほうは体の動きに付いていき、座面に着いたところは動かない。
      return {
        cell: 30,
        alpha: () => artOpacity(seat.level),
        deform: (x, y, out) => lerpInto(out, x, y, followWeight(toModel(x, y)[1])),
      }
    case '座り/すね左':
    case '座り/すね右': {
      // S8.3・S8.5: 入れ替わる間は立ち姿のひざから下と同じ位置、座っている間はひざを支点にぶらぶら（shinCorners と同じ変換）。
      const left = L.path.endsWith('左'),
        art = left ? ART.shinLeft : ART.shinRight
      return {
        cell: 30,
        alpha: () => artOpacity(seat.level),
        deform: (x, y, out) => {
          const [mx, my] = toModel(x, y),
            swing = left ? seat.swingLeft : seat.swingRight,
            slide = SEAT_RISE * (1 - Math.max(0, Math.min(1, seat.level))),
            [px, py] = art.pivot,
            a = (left ? -1 : 1) * SEAT.swing * swing,
            k = 1 + SEAT.dangle * swing,
            dx = mx - px,
            dy = (my - py) * k,
            [kx, ky] = toK(px + dx * Math.cos(a) - dy * Math.sin(a), py + dx * Math.sin(a) + dy * Math.cos(a) + slide)
          out[0] = kx
          out[1] = ky
        },
      }
    }
  }
  if (/^(脚|足)[RL]$/.test(L.name))
    // S8.1・S8.2: 立ち姿の脚・足は絵の位置へ寄せながら消える。
    return {
      cell: 40,
      alpha: () => legOpacity(seat.level),
      deform: (x, y, out) => {
        const [mx, my] = toModel(x, y),
          [kx, ky] = toK(mx, my - seatLift(my, seat.level))
        bodyT(kx, ky, out)
      },
    }
  if (L.name === '裾R' || L.name === '裾L') {
    // S8.4: 硬い板。v11r の BottomwearR は画面の左（通常版の left）。
    const side = L.name === '裾R' ? 'left' : 'right'
    return {
      cell: 40,
      alpha: one,
      deform: (x, y, out) => {
        const [kx, ky] = skirtK(side, x, y, seat.level)
        bodyT(kx, ky, out)
      },
    }
  }
  return null
}

/** 太ももの絵は通常版と同じく、描き込まれた裾を消して下へ塗り足してから使う（S8.9・S8.10）。 */
function image(L: Layer): Promise<HTMLCanvasElement> | null {
  if (L.path !== '座り/太もも') return null
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const c = document.createElement('canvas')
      c.width = img.naturalWidth
      c.height = img.naturalHeight
      const g = c.getContext('2d', { willReadFrequently: true })
      if (!g) return reject(new Error('2d context'))
      g.drawImage(img, 0, 0)
      const data = g.getImageData(0, 0, c.width, c.height)
      mendThighs(data.data, c.width)
      g.putImageData(data, 0, 0)
      resolve(c)
    }
    img.onerror = () => reject(new Error(`読み込めません: ${ART.thighs.file}`))
    img.src = new URL(`./kohako/live2d/seat/${ART.thighs.file}`, location.href).href
  })
}

// ---- 台本 ----
type Script =
  | {
      kind: 'A'
      t0: number
      sendAt: number
      thinkAt: number
      speakAt: number
      speakFor: number
      last: TalkState | 'done'
    }
  | { kind: 'B'; t0: number; seatedAt: number | null }
let script: Script | null = null
let clock = 0
const status = document.getElementById('status') as HTMLElement
const show = (s: string) => {
  status.textContent = s
}

function runScript(now: number) {
  const api = k2d()
  if (!script || !api) return
  const t = now - script.t0
  if (script.kind === 'A') {
    const st: TalkState | 'done' =
      t >= script.speakAt + script.speakFor ? 'done' : stateAt(t, script.sendAt, script.thinkAt, script.speakAt)
    if (st !== script.last) {
      script.last = st
      show(
        {
          idle: '待機',
          listening: '聞いている',
          thinking: '考えている',
          speaking: '話している',
          done: '台本 A おわり',
        }[st],
      )
      if (st === 'speaking') api.talk(true)
      if (st === 'done') {
        api.talk(false)
        script = null
      }
    }
    // 聞いている間はこちらを見て、考えている間は少し上を見る（通常版の家で「考えています」の間に上を見るのに合わせる）。
    const m = st === 'thinking' ? [0.3, -0.55] : [0, 0]
    api.mouse.x += (m[0] - api.mouse.x) * 0.08
    api.mouse.y += (m[1] - api.mouse.y) * 0.08
    return
  }
  if (script.seatedAt === null) {
    if (seat.phase === 'seated') {
      script.seatedAt = t
      show('座り切った')
    }
    return
  }
  const [x, y] = lookAt(t, script.seatedAt)
  api.mouse.x = x
  api.mouse.y = y
  if (t > script.seatedAt + 10) {
    show('台本 B おわり')
    script = null
  }
}

/** Keshin2D の毎コマ（updateTargets の後）。座り具合を進め、体と椅子を一緒に下げ（表示範囲を上へずらす）、台本を進める。 */
function onFrame(now: number) {
  clock = now
  seat = director.step(now, { calm: true, keep: true, quiet: true, free: true, subtle: false })
  const api = k2d()
  if (api) {
    const off = seat.offset * K2D.S
    api.VIEW.cy -= off - lastOffset
    lastOffset = off
  }
  runScript(now)
}

declare global {
  interface Window {
    KOHAKO_K2D: unknown
    __keshin: unknown
  }
}
window.KOHAKO_K2D = { part, image, frame: onFrame }

// ---- 表示範囲: 全身を画面の高さに収め、家と同じく左寄り（丸窓の前）に立たせる。縦長では中央。 ----
const TOP = toK(0, 70)[1],
  BOTTOM = toK(0, 2010)[1]
function place() {
  const api = k2d()
  if (!api) return
  const w = innerWidth,
    h = innerHeight,
    portrait = h > w,
    half = ((BOTTOM - TOP) / 2) * (portrait ? 1.04 : 1.235),
    unit = (2 * half) / h,
    at = portrait ? 0.5 : 0.2
  api.VIEW.half = half
  api.VIEW.cy = (TOP + BOTTOM) / 2 + lastOffset
  api.VIEW.cx = K2D.X0 + (0.5 - at) * w * unit
}
document.body.dataset.shape = innerHeight > innerWidth ? 'portrait' : 'pc'
addEventListener('resize', place)

const ready = new Promise<void>((resolve) => {
  frame.addEventListener('load', () => {
    const wait = () => {
      if (!k2d()) return void setTimeout(wait, 50)
      // Keshin2D の地の色を消して、後ろの部屋（家と同じ背景）を見せる。
      const doc = frame.contentDocument
      if (doc) for (const el of [doc.documentElement, doc.body]) el.style.background = 'transparent'
      place()
      resolve()
    }
    wait()
  })
})
frame.src = './kohako/keshin/index.html?model=kohako&ui=0&bg=transparent&mode=mouse&cx=1500&cy=4000&zoom=0.25'

const sit = () => {
  director.force('sit')
  show('座る')
}
const stand = () => {
  director.force('stand')
  show('立つ')
}
const runA = (o: { sendAt?: number; thinkAt?: number; speakAt?: number; speakFor?: number } = {}) => {
  k2d()?.talk(false)
  script = {
    kind: 'A',
    t0: clock,
    sendAt: o.sendAt ?? 4,
    thinkAt: o.thinkAt ?? 4.6,
    speakAt: o.speakAt ?? 7,
    speakFor: o.speakFor ?? 6,
    last: 'idle',
  }
  show('待機')
}
const runB = () => {
  if (seat.phase === 'standing') director.force('sit')
  script = { kind: 'B', t0: clock, seatedAt: null }
  show('座る')
}
const free = () => {
  script = null
  k2d()?.talk(false)
  show('マウスの方を向きます')
}
for (const [id, fn] of [
  ['run-a', () => runA()],
  ['run-b', runB],
  ['sit', sit],
  ['stand', stand],
  ['talk', () => k2d()?.talk(true)],
  ['free', free],
] as const)
  document.getElementById(id)?.addEventListener('click', () => fn())

window.__keshin = {
  ready,
  runA,
  runB,
  sit,
  stand,
  state: () => ({ seat, script: script?.kind ?? null, status: status.textContent }),
}
