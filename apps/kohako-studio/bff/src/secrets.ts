// BOXP-560: 家の手順一覧で道具の実引数を Owner 本人に見せる時の伏字。
// 伏せるのは「明確な認証秘密」の形だけ（秘密鍵、認証ヘッダ、既知の接頭辞つきトークン、URL の利用者情報、秘密らしい名前の項目の値、
// 一部コマンドのパスワード指定）。形の決まっていない秘密値（例: echo 値 | 何か、位置引数のパスワード）は見分けられないので対象外。
// それまで伏せようとすると引数を何も出せなくなる（BOXP-548 の経緯）ため、Owner 判断でこの線引きにしている。
// 表示先は家に認証済みの Owner 本人だけで、値は BFF のメモリにしか置かない。
export const MASK = '［伏字］'
export const VALUE_MAX = 20_000
export const STEP_MAX = 60_000
// auth は author / authority / authorization（専用規則が方式名を残して伏せる）を巻き込まないよう、後ろが or のものを除く。
const WORD =
  'pass(?:word|wd|phrase)|secret|token|api[-_ ]?key|access[-_ ]?key|credential|private[-_ ]?key|session|auth(?!or)'
// 名前は前後 40 字までしか見ない（区切りの無い長い文字列で処理時間が伸びないように）。
const NAME = `(?<![A-Za-z0-9_.-])[A-Za-z0-9_.-]{0,40}(?:${WORD})[A-Za-z0-9_.-]{0,40}`
// 引用符つきの値は、閉じ引用符が無くても（入力が途中で切れた・複数行にまたがる）終わりまで伏せる。伏せ過ぎる側に倒す。
const QUOTED = `"""[\\s\\S]*?(?:"""|$)|'''[\\s\\S]*?(?:'''|$)|\\$?'[^']*'?|"(?:[^"\\\\]|\\\\[\\s\\S])*"?|\`[^\`]*\`?`
const RULES: [RegExp, string][] = [
  [/-----BEGIN [A-Z0-9 ]{0,40}PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]{0,40}PRIVATE KEY-----|$)/g, MASK],
  // 認証ヘッダ: 方式名（Bearer 等）は残し、値を伏せる。Cookie は行末まで。
  [
    /((?:proxy-)?authorization\\?["']?\s*[:=]\s*\\?["']?(?:(?:basic|bearer|digest|token)\s+)?)[^\s"'\\]+/gi,
    `$1${MASK}`,
  ],
  [/((?:set-)?cookie\\?["']?\s*[:=]\s*\\?["']?)[^"'\n\\]+/gi, `$1${MASK}`],
  [/\b(bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, `$1${MASK}`],
  [
    /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|glpat-[A-Za-z0-9_-]{16,}|hf_[A-Za-z0-9]{20,}|npm_[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+)/g,
    MASK,
  ],
  // URL の利用者情報（scheme://user:pass@ と scheme://token@）。
  [/\b([a-z][a-z0-9+.-]{0,20}:\/\/[^\s/@:]{0,200}:)[^\s/@]{1,500}@/gi, `$1${MASK}@`],
  [/\b([a-z][a-z0-9+.-]{0,20}:\/\/)[^\s/@:]{8,500}@/gi, `$1${MASK}@`],
  // 秘密らしい名前の項目: NAME=値 / NAME: 値 / "name": "値"（JSON 文字列内の \"name\": \"値\" も）。
  [
    new RegExp(
      `((?:\\\\?["'])?${NAME}(?:\\\\?["'])?\\s*[:=]\\s*)(?:\\\\"[^"]*"?|${QUOTED}|[^\\s"'\`&|;,)}\\]]+)`,
      'gi',
    ),
    `$1${MASK}`,
  ],
  // --name 値 / -name 値（値が引用符つきで空白を含む場合も）。値が - で始まる秘密もあるので、次の語は何であっても伏せる
  // （--password --verbose の --verbose も伏字になるが、伏せ過ぎる側に倒す）。
  [new RegExp(`(--?${NAME.replace('(?<![A-Za-z0-9_.-])', '')}\\s+)(?:${QUOTED}|\\S+)`, 'gi'), `$1${MASK}`],
  [
    new RegExp(`\\b((?:mysql|mariadb|mysqldump|mysqladmin)\\b[^\\n|;&]*?\\s-p)(?:${QUOTED}|[^\\s'"]\\S*)`, 'g'),
    `$1${MASK}`,
  ],
  [new RegExp(`\\b(sshpass\\s+-p\\s*)(?:${QUOTED}|\\S+)`, 'g'), `$1${MASK}`],
  [new RegExp(`\\b(curl\\b[^\\n|;&]*?\\s(?:-u|--user)[\\s=]+)(?:${QUOTED}|\\S+)`, 'g'), `$1${MASK}`],
]
export function redactSecrets(text: string): string {
  let out = text
  for (const [rule, to] of RULES) out = out.replace(rule, to)
  return out
}
// 認証ヘッダは上の専用規則が方式名を残して伏せるので、本文中の名前規則には入れず、項目名の判定にだけ使う。
const SECRET_KEY = new RegExp(`${WORD}|authorization|cookie`, 'i')
const maskKeys = (value: unknown, depth = 0): unknown => {
  if (depth > 8) return '…'
  if (Array.isArray(value)) return value.map((v) => maskKeys(v, depth + 1))
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, SECRET_KEY.test(k) ? MASK : maskKeys(v, depth + 1)]),
    )
  return value
}
export type ArgField = { key: string; value: string; truncated: boolean }
// 伏字の前に入力を切る位置（巨大な引数で処理時間が伸びないように）。表示上限 max には依存させない。
export const INPUT_MAX = VALUE_MAX * 4
// 入力を切った時に、切り口の手前で表示から落とす長さ。途中で切れたトークンや URL が規則の最小長に届かず残るのを防ぐ。
export const EDGE_GUARD = 2_000
/** 改行とタブ以外の制御文字を落とし、伏字にしてから上限で切る（切った端に秘密の一部が残らないよう、伏字が先）。 */
export function publicText(text: string, max: number): { value: string; truncated: boolean } {
  const cut = text.length > INPUT_MAX
  const clean = redactSecrets((cut ? text.slice(0, INPUT_MAX) : text).replace(/[^\P{Cc}\n\t]/gu, ''))
  // 入力を切った場合、閉じ引用符の無い値は上の規則が終わりまで伏せ、切り口付近の断片は表示しない。
  const limit = Math.max(0, Math.min(max, cut ? clean.length - EDGE_GUARD : clean.length))
  return { value: clean.slice(0, limit), truncated: cut || clean.length > limit }
}
export function redactArgs(args: Record<string, unknown>): ArgField[] {
  const fields: ArgField[] = []
  let left = STEP_MAX
  for (const [key, raw] of Object.entries(args)) {
    if (fields.length >= 24) break
    if (!/^[A-Za-z0-9_.-]{1,64}$/.test(key)) continue
    if (SECRET_KEY.test(key)) {
      fields.push({ key, value: MASK, truncated: false })
      continue
    }
    let text: string
    try {
      text = typeof raw === 'string' ? raw : (JSON.stringify(maskKeys(raw), null, 2) ?? '')
    } catch {
      continue
    }
    const { value, truncated } = publicText(text, Math.min(VALUE_MAX, left))
    left -= value.length
    fields.push({ key, value, truncated })
  }
  return fields
}
