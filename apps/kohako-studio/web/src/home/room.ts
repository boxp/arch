// BOXP-512: コハコの家の背景「月窓の間」。構図は room.css、ここは時間帯と比較用の旧版切替だけを持つ。
export type Daypart = 'morning' | 'day' | 'evening' | 'night'
export const dayparts: readonly Daypart[] = ['morning', 'day', 'evening', 'night']
/** 端末の時刻（時）から窓の外の空を選ぶ。 */
export const daypartOf = (hour: number): Daypart =>
  hour < 5 ? 'night' : hour < 10 ? 'morning' : hour < 16 ? 'day' : hour < 19 ? 'evening' : 'night'
export type RoomOptions = { daypart: Daypart | null; version: 'v2' | 'v1' }
/** `?daypart=night` で空を固定、`?bg=v1` で BOXP-510 初版の背景を表示する（見比べ用。保存はしない）。 */
export function roomOptions(search: string): RoomOptions {
  const q = new URLSearchParams(search),
    d = q.get('daypart')
  return {
    daypart: dayparts.includes(d as Daypart) ? (d as Daypart) : null,
    version: q.get('bg') === 'v1' ? 'v1' : 'v2',
  }
}
/** BOXP-510 初版（回路の点線と花びら 5 枚）。Owner が同じ配備版で見比べられるよう残す。 */
export function buildRoomV1(doc: Document): DocumentFragment {
  const NS = 'http://www.w3.org/2000/svg',
    frag = doc.createDocumentFragment(),
    svg = doc.createElementNS(NS, 'svg'),
    path = doc.createElementNS(NS, 'path')
  svg.setAttribute('class', 'circuit')
  svg.setAttribute('viewBox', '0 0 400 300')
  svg.setAttribute('preserveAspectRatio', 'xMidYMid slice')
  path.setAttribute('d', 'M0 60h80l20 20h90M400 220h-70l-20-20h-110M40 300v-60l20-20h60M360 0v50l-20 20h-60')
  svg.append(path)
  for (const [cx, cy] of [
    [190, 80],
    [200, 200],
    [120, 220],
    [280, 70],
  ]) {
    const c = doc.createElementNS(NS, 'circle')
    c.setAttribute('cx', String(cx))
    c.setAttribute('cy', String(cy))
    c.setAttribute('r', '3')
    svg.append(c)
  }
  frag.append(svg)
  for (let i = 1; i <= 5; i++) {
    const s = doc.createElement('span')
    s.className = `petal p${i}`
    frag.append(s)
  }
  return frag
}
