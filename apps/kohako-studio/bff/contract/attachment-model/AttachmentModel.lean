/-!
# コハコの家: 添付 1 件の上限と結果の小さなモデル (BOXP-677)

仕様（チケット BOXP-677 の受入条件）から起こした規則。実装の写しではない。
規則の日本語説明・実装との対応・省いたものは同じディレクトリの README.md にある。Lean 本体だけを使う。

- 証明の検査:   `lean AttachmentModel.lean`
- 境界表の生成: `lean --run AttachmentModel.lean > cases.jsonl`
-/

def MiB : Nat := 1024 * 1024
/-- 画面・BFF の PDF 上限 (30 MiB)。 -/
def pdfMax : Nat := 30 * MiB
/-- 画面・BFF の画像/テキスト上限 (5 MiB)。 -/
def otherMax : Nat := 5 * MiB
/-- 中継 (nginx client_max_body_size 31m)。 -/
def proxyMax : Nat := 31 * MiB
def maxPages : Nat := 30
def maxText : Nat := 48000

inductive Kind | image | pdf | text | unsupported
  deriving DecidableEq, Repr

inductive PdfOpen | ok | encrypted | unreadable | timeout
  deriving DecidableEq, Repr

/-- 観測できる事実。`pages`/`textBytes`/`hasText` は PDF を開けた場合（テキストは textBytes のみ）。 -/
structure Facts where
  kind : Kind
  size : Nat
  opened : PdfOpen := .ok
  pages : Nat := 1
  textBytes : Nat := 1
  hasText : Bool := true
  deriving Repr

inductive Read | full | part | body0
  deriving DecidableEq, Repr

inductive Outcome
  | proxyTooLarge            -- 中継が断る（画面の検査を迂回したときだけ起きる）
  | tooLarge                 -- 413 too_large
  | unsupported              -- 415 unsupported_type
  | pdfFail (why : PdfOpen)  -- 422 pdf_encrypted / pdf_unreadable / pdf_timeout
  | pdfNoText                -- 422 pdf_no_text
  | accepted (r : Read)
  deriving DecidableEq, Repr

def limitOf : Kind → Nat
  | .pdf => pdfMax
  | .unsupported => pdfMax  -- 形式が分かる前に読む量の上限
  | _ => otherMax

/-- 規則: 中継 → サイズ → 形式 → 開封 → 本文の有無 → 上限内なら全文、超えれば一部。 -/
def outcome (f : Facts) : Outcome :=
  if f.size > proxyMax then .proxyTooLarge
  else if f.size > limitOf f.kind then .tooLarge
  else match f.kind with
    | .unsupported => .unsupported
    | .image => .accepted .body0
    | .text => if f.textBytes > maxText then .accepted .part else .accepted .full
    | .pdf =>
      if f.opened ≠ .ok then .pdfFail f.opened
      else if !f.hasText then .pdfNoText
      else if f.textBytes > maxText ∨ f.pages > maxPages then .accepted .part
      else .accepted .full

/-- 画面側の事前検査（送る前に止める）。 -/
def clientRejects (f : Facts) : Bool := decide (f.size > limitOf f.kind)

/-! ## 性質 -/

/-- 上限の並び: 画像/テキスト < PDF < 中継。画面が許す大きさなら中継は必ず通し、BFF が理由を返せる。 -/
theorem limits_ordered : otherMax < pdfMax ∧ pdfMax < proxyMax := by decide

/-- 受け付けた添付は必ず種類ごとの上限内。 -/
theorem accepted_within_limit (f : Facts) (r : Read) (h : outcome f = .accepted r) :
    f.size ≤ limitOf f.kind := by
  unfold outcome at h
  by_cases h1 : f.size > proxyMax <;> simp [h1] at h
  by_cases h2 : f.size > limitOf f.kind <;> simp [h2] at h
  omega

/-- 全文読取と言えるのは、本文上限内かつ（PDF なら）ページ上限内のときだけ。 -/
theorem full_means_within (f : Facts) (h : outcome f = .accepted .full) :
    f.textBytes ≤ maxText ∧ (f.kind = .pdf → f.pages ≤ maxPages) ∧ f.kind ≠ .image := by
  unfold outcome at h
  repeat' split at h
  all_goals first | contradiction | (simp_all; omega) | simp_all

/-- 上限を超えたら成功扱い（全文）にならない。 -/
theorem over_limit_not_full (f : Facts) (h : f.kind = .pdf ∧ f.pages > maxPages) :
    outcome f ≠ .accepted .full := by
  intro hf
  have := (full_means_within f hf).2.1 h.1
  omega

/-- 画面の事前検査は BFF のサイズ判定と一致する（画面が通したものを BFF がサイズで断らない）。 -/
theorem client_agrees (f : Facts) :
    clientRejects f = false → outcome f ≠ .tooLarge ∧ outcome f ≠ .proxyTooLarge := by
  intro hc
  have hle : f.size ≤ limitOf f.kind := by
    unfold clientRejects at hc; simp at hc; omega
  have hp : f.size ≤ proxyMax := by
    have : limitOf f.kind ≤ proxyMax := by cases f.kind <;> decide
    omega
  unfold outcome
  simp [Nat.not_lt.mpr hp, Nat.not_lt.mpr hle]
  split <;> (try split) <;> (try split) <;> (try split) <;> simp

/-! ## 境界表（実装照合用）: 各上限の前後と失敗の種類を総当たりで出す -/

def kindName : Kind → String
  | .image => "image" | .pdf => "pdf" | .text => "text" | .unsupported => "unsupported"
def openName : PdfOpen → String
  | .ok => "ok" | .encrypted => "encrypted" | .unreadable => "unreadable" | .timeout => "timeout"
def readName : Read → String
  | .full => "full" | .part => "partial" | .body0 => "none"
def outcomeJson : Outcome → String
  | .proxyTooLarge => "{\"proxy\":413}"
  | .tooLarge => "{\"status\":413,\"error\":\"too_large\"}"
  | .unsupported => "{\"status\":415,\"error\":\"unsupported_type\"}"
  | .pdfFail w => s!"\{\"status\":422,\"error\":\"pdf_{openName w}\"}"
  | .pdfNoText => "{\"status\":422,\"error\":\"pdf_no_text\"}"
  | .accepted r => s!"\{\"status\":201,\"read\":\"{readName r}\"}"

def sizes : List Nat :=
  [1, otherMax - 1, otherMax, otherMax + 1, pdfMax - 1, pdfMax, pdfMax + 1, proxyMax, proxyMax + 1]

def cases : List Facts := Id.run do
  let mut out : List Facts := []
  for k in [Kind.image, .text, .unsupported] do
    for s in sizes do
      for t in [0, maxText, maxText + 1] do
        out := out ++ [{ kind := k, size := s, textBytes := t }]
  for s in sizes do
    for o in [PdfOpen.ok, .encrypted, .unreadable, .timeout] do
      for p in [1, maxPages, maxPages + 1] do
        for t in [1, maxText, maxText + 1] do
          for ht in [true, false] do
            out := out ++ [{ kind := .pdf, size := s, opened := o, pages := p, textBytes := t, hasText := ht }]
  return out

def main : IO Unit := do
  for f in cases do
    IO.println s!"\{\"kind\":\"{kindName f.kind}\",\"size\":{f.size},\"opened\":\"{openName f.opened}\",\"pages\":{f.pages},\"textBytes\":{f.textBytes},\"hasText\":{f.hasText},\"clientRejects\":{clientRejects f},\"expected\":{outcomeJson (outcome f)}}"
