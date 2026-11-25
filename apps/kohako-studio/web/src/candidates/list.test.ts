import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  type Candidate,
  candidateHomeURL,
  candidateLinks,
  candidateURL,
  candidateVideos,
  parseIndex,
  sortNewestFirst,
  statusClass,
} from './list'

const ok = {
  id: 'arm-4980edd',
  commit: '4980edd3a5a89232b4f0bb343e604fafca2d2828',
  title: '腕',
  status: '試作',
  built: true,
}

describe('試作候補の一覧', () => {
  it('本人採用は動作単位の表記でも採用の色にする', () => {
    expect(statusClass('本人採用（制止）')).toBe('adopted')
    expect(statusClass('独立判定合格（照れ）')).toBe('pass')
    expect(statusClass('不合格')).toBe('ng')
    expect(statusClass('試作')).toBe('trial')
    expect(statusClass('その他')).toBe('unknown')
  })
  it('形の崩れた項目を捨てる', () => {
    expect(parseIndex({ candidates: [ok, { ...ok, id: '../x' }, { ...ok, commit: 'abc' }, null] })).toHaveLength(1)
    expect(parseIndex(null)).toEqual([])
  })
  it('候補ごとの固定パスへ acting 付きでリンクする', () => {
    expect(candidateURL(ok)).toBe('./candidates/arm-4980edd/live2d.html?acting=1')
    expect(candidateURL(ok, 'studio')).toBe('./candidates/arm-4980edd/studio.html?acting=1')
  })
  it('家の画面で見る候補（page: home）は、家の画面へリンクする', () => {
    const home = { ...ok, id: 'seat-0123abc', page: 'home' }
    expect(candidateHomeURL(home)).toBe('./candidates/seat-0123abc/home.html')
    expect(candidateLinks(home)).toEqual([
      { text: '家の画面で見る', href: './candidates/seat-0123abc/home.html' },
      { text: 'すぐ座るところから見る', href: './candidates/seat-0123abc/home.html?seat=now' },
    ])
    expect(candidateLinks(ok).map((l) => l.href)).toEqual([
      './candidates/arm-4980edd/live2d.html?acting=1',
      './candidates/arm-4980edd/studio.html?acting=1',
    ])
  })
  it('Studio の固定入口から候補一覧へ行ける', () => {
    expect(readFileSync(new URL('../../studio.html', import.meta.url), 'utf8')).toContain('href="./candidates.html"')
  })
  it('新しい試作を先頭に並べる（created の降順、無いものは末尾）', () => {
    const a = { ...ok, id: 'a', created: '2026-11-10T01:00:00Z' },
      b = { ...ok, id: 'b', created: '2026-11-10T13:00:00Z' },
      c = { ...ok, id: 'c' }
    expect(sortNewestFirst([a, c, b]).map((x) => x.id)).toEqual(['b', 'a', 'c'])
  })
})

// BOXP-698: 動く画面を開けない端末（スマホは上半身の枠で座らない 等）でも候補の動きを見られるよう、
// 候補に実時間の録画を付けられる。録画は通常版の公開ファイル ./kohako/candidate-videos/<id>/<file> に置く。
describe('試作候補の録画', () => {
  const seat = { ...ok, id: 'seat-0123abc', page: 'home' }
  it('録画は候補 ID ごとの固定パスの mp4 として並べる（題と補足つき、書いた順）', () => {
    const c = {
      ...seat,
      videos: [
        { file: '01-sit.mp4', title: '座る', note: '配備 sha-0000000 の録画' },
        { file: '02-talk.mp4', title: '話しかけて立つ' },
      ],
    }
    expect(candidateVideos(c)).toEqual([
      { src: './kohako/candidate-videos/seat-0123abc/01-sit.mp4', title: '座る', note: '配備 sha-0000000 の録画' },
      { src: './kohako/candidate-videos/seat-0123abc/02-talk.mp4', title: '話しかけて立つ', note: '' },
    ])
  })
  it('録画の指定が無い候補は 0 本', () => {
    expect(candidateVideos(seat)).toEqual([])
  })
  it('形の崩れた録画は捨てる（別のパスや別の種類のファイルへ誘導しない）', () => {
    const bad = [
      { file: '../x.mp4', title: 'a' },
      { file: 'a/b.mp4', title: 'a' },
      { file: 'https://example.com/a.mp4', title: 'a' },
      { file: 'a.webm', title: 'a' },
      { file: 'a.mp4' },
      { file: 'a.mp4', title: '' },
      null,
      'a.mp4',
    ]
    expect(candidateVideos({ ...seat, videos: bad } as unknown as Candidate)).toEqual([])
    expect(candidateVideos({ ...seat, videos: 'a.mp4' } as unknown as Candidate)).toEqual([])
  })
  it('一覧に載せた録画のファイルが公開ファイルに在る', () => {
    const manifest = new URL('../../../candidates/candidates.json', import.meta.url)
    if (!existsSync(manifest)) return // image の web だけの build では候補の一覧が無い
    const list = parseIndex(JSON.parse(readFileSync(manifest, 'utf8')))
    const videos = list.flatMap(candidateVideos)
    for (const v of videos)
      expect(existsSync(new URL(`../../public/${v.src.slice(2)}`, import.meta.url)), v.src).toBe(true)
    expect(list.find((c) => c.id === 'seat-8abde00')?.videos).toHaveLength(3)
  })
})
