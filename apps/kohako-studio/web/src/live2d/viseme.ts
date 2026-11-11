// Text-based approximation only: kanji readings and actual phoneme timings are unknown.
export type Vowel = 'a' | 'i' | 'u' | 'e' | 'o' | 'n' | 'closed'
export type Viseme = { vowel: Vowel; open: number; width: number }
const shapes: Record<Vowel, Viseme> = {
  a: { vowel: 'a', open: 0.9, width: 1 }, i: { vowel: 'i', open: 0.3, width: 1.12 },
  u: { vowel: 'u', open: 0.3, width: 0.8 }, e: { vowel: 'e', open: 0.55, width: 1.06 },
  o: { vowel: 'o', open: 0.7, width: 0.85 }, n: { vowel: 'n', open: 0.06, width: 1 },
  closed: { vowel: 'closed', open: 0, width: 1 },
}
type Mora = { vowel: Vowel; index: number; start: number; end: number }
export type VisemeSequence = { morae: Mora[]; duration: number }
const rows = ['あかさたなはまやらわがざだばぱぁ', 'いきしちにひみりゐぎじぢびぴぃ', 'うくすつぬふむゆるぐずづぶぷぅゔ', 'えけせてねへめれゑげぜでべぺぇ', 'おこそとのほもよろをごぞどぼぽぉ']
export function makeVisemes(text: string, duration: number): VisemeSequence {
  const units: { vowel: Vowel; index: number; weight: number }[] = []
  let offset = 0, unknown = 0
  for (const char of text) {
    const index = offset; offset += char.length
    const code = char.codePointAt(0)!, kana = code >= 0x30a1 && code <= 0x30f6 ? String.fromCodePoint(code - 0x60) : char
    if ('ゃゅょ'.includes(kana) && units.length && units[units.length - 1].vowel !== 'closed') { units[units.length - 1].vowel = ({ 'ゃ': 'a', 'ゅ': 'u', 'ょ': 'o' } as Record<string, Vowel>)[kana]; continue }
    if (kana === 'ー' && units.length) { units[units.length - 1].weight += 1; continue }
    let vowel: Vowel = 'closed', weight = 1
    const row = rows.findIndex(r => r.includes(kana))
    if (row >= 0) vowel = (['a', 'i', 'u', 'e', 'o'] as const)[row]
    else if (kana === 'ん') vowel = 'n'
    else if (kana === 'っ') weight = 0.5
    else if (/[a-z]/i.test(char)) vowel = ({ a: 'a', i: 'i', u: 'u', e: 'e', o: 'o' } as Record<string, Vowel>)[char.toLowerCase()] ?? 'e'
    else if (/\p{Script=Han}/u.test(char)) vowel = (['a', 'e', 'o'] as const)[unknown++ % 3]
    else weight = 0.6
    units.push({ vowel, index, weight })
  }
  const total = units.reduce((n, u) => n + u.weight, 0); let time = 0
  const morae = units.map(u => { const start = time; time += total ? duration * u.weight / total : 0; return { vowel: u.vowel, index: u.index, start, end: time } })
  return { morae, duration }
}
export function boundaryTime(seq: VisemeSequence, charIndex: number): number {
  return [...seq.morae].reverse().find(m => m.index <= charIndex)?.start ?? 0
}
export function visemeAt(seq: VisemeSequence, seconds: number): Viseme {
  if (seconds < 0 || seconds >= seq.duration) return shapes.closed
  const index = seq.morae.findIndex(m => seconds >= m.start && seconds < m.end)
  if (index < 0) return shapes.closed
  const mora = seq.morae[index], shape = shapes[mora.vowel], prev = shapes[seq.morae[index - 1]?.vowel ?? 'closed']
  const t = Math.min(1, (seconds - mora.start) / 0.07), k = t * t * (3 - 2 * t)
  return { vowel: mora.vowel, open: prev.open + (shape.open - prev.open) * k, width: prev.width + (shape.width - prev.width) * k }
}
