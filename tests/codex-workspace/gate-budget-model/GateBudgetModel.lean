import Std.Data.HashSet

/-!
# Task Board runner: PR gate 失敗予算（ticket pool）と run 開始の予約の小さなモデル (BOXP-673, BOXP-753)

ticket 2 件 (T1・T2)、PR 2 件 (P1・P2)、unit（PR 1 件あたりの枠）は 2。
規則は docs/project_docs/BOXP-369・448・450 の文章から起こした。規則の日本語での説明・定理との対応・
実装との対応・省いたものは同じディレクトリの README.md にある。このファイルは Lean 本体だけを使う。

- 証明の検査:   `lean GateBudgetModel.lean`
- 手順の生成:   `lean --run GateBudgetModel.lean cover 5 | gzip -n -9 > gate-budget-traces.txt.gz`
-/

inductive T | T1 | T2
  deriving DecidableEq, Hashable, Repr

inductive P | P1 | P2
  deriving DecidableEq, Hashable, Repr

/-- 動いている run。`h1`・`h2` は開始時に予約した PR（P1・P2）、`failed` はこの run の失敗を数え済みか。 -/
structure Run where
  h1 : Bool
  h2 : Bool
  failed : Bool
  deriving DecidableEq, Hashable, Repr

/-- ticket 1 件分。 -/
structure Tk where
  /-- P1・P2 で数えた失敗の件数。 -/
  f1 : Nat := 0
  f2 : Nat := 0
  /-- BOXP-448 より前の grant（下限としてだけ効く）の合計。 -/
  legacy : Nat := 0
  /-- 追加の grant（常に足される）の合計。 -/
  additive : Nat := 0
  /-- Owner が P1・P2 をこの ticket の PR 数から除外したか。 -/
  x1 : Bool := false
  x2 : Bool := false
  run : Option Run := none
  /-- BOXP-753: 受領済みで、まだ補充を判定していない停滞レビューがある。 -/
  pend : Bool := false
  /-- 補充した回数。 -/
  nref : Nat := 0
  /-- 最後に補充した時点の失敗の数（補充がなければ 0）。 -/
  mark : Nat := 0
  /-- 補充で引き上げた上限の合計。 -/
  bonus : Nat := 0
  deriving DecidableEq, Hashable, Repr

structure St where
  a : Tk := {}
  b : Tk := {}
  /-- P1・P2 を最初に PR gate へ通した（または最初に失敗した）ticket。 -/
  o1 : Option T := none
  o2 : Option T := none
  deriving DecidableEq, Hashable, Repr

inductive Ev
  | start (t : T) | finish (t : T) | pass (t : T) (p : P) | fail (t : T) (p : P)
  | grant (t : T) | legacy (t : T) | excl (t : T) (p : P)
  /-- BOXP-753: 新しい停滞レビュー（done）の受領が元票の Notes に書かれた。 -/
  | review (t : T)
  /-- 最後に受領したレビューの受領をもう一度書いた（再配送・重複）。 -/
  | redeliver (t : T)
  deriving Repr

/-- PR 1 件あたりの枠。実装の既定は 10。手順を短くするため、実装が許す「下げる方向の設定」で 2 にして再生する。 -/
def unit : Nat := 2

def other : T → T
  | .T1 => .T2
  | .T2 => .T1

def tk (s : St) : T → Tk
  | .T1 => s.a
  | .T2 => s.b

def setTk (s : St) (t : T) (k : Tk) : St :=
  match t with
  | .T1 => { s with a := k }
  | .T2 => { s with b := k }

def owner (s : St) : P → Option T
  | .P1 => s.o1
  | .P2 => s.o2

/-- 持ち主がまだいない PR は、最初に通した ticket のものになる。いちど決まった持ち主は変わらない。 -/
def claim (s : St) (t : T) (p : P) : St :=
  match p with
  | .P1 => if s.o1 = none then { s with o1 := some t } else s
  | .P2 => if s.o2 = none then { s with o2 := some t } else s

/-- ticket の失敗の総数。 -/
def used (s : St) (t : T) : Nat := (tk s t).f1 + (tk s t).f2

/-- ticket の PR 数 N: 自分が持ち主で、除外されていない PR の数。 -/
def scopeN (s : St) (t : T) : Nat :=
  (if s.o1 = some t ∧ (tk s t).x1 = false then 1 else 0)
    + (if s.o2 = some t ∧ (tk s t).x2 = false then 1 else 0)

/-- 基本枠 = unit × max(1, N)。 -/
def base (s : St) (t : T) : Nat := unit * max 1 (scopeN s t)

/-- ticket の上限 = max(unit × max(1, N), unit + 旧 grant) + 追加 grant + レビュー補充の合計。 -/
def limit (s : St) (t : T) : Nat :=
  max (unit * max 1 (scopeN s t)) (unit + (tk s t).legacy) + (tk s t).additive + (tk s t).bonus

abbrev exhausted (s : St) (t : T) : Prop := limit s t ≤ used s t

/-- 1 ticket あたりの補充の回数の上限。 -/
def refreshCap : Nat := 2

/-- 補充する条件（規則 11）: 上限に達していない・前回の補充より後に失敗がある・回数が上限未満・残りが基本枠より少ない。 -/
abbrev refreshable (s : St) (t : T) : Prop :=
  ¬ exhausted s t ∧ (tk s t).mark < used s t ∧ (tk s t).nref < refreshCap ∧ limit s t < used s t + base s t

/-- 受領済みのレビューを判定する（run の開始・失敗の計上・grant の直前）。判定は 1 回だけで、補充すると
上限 = 失敗の数 + 基本枠 になる。 -/
def refresh (s : St) (t : T) : St :=
  if (tk s t).pend then
    if refreshable s t then
      setTk s t { tk s t with pend := false, nref := (tk s t).nref + 1, mark := used s t,
                              bonus := (tk s t).bonus + (used s t + base s t - limit s t) }
    else setTk s t { tk s t with pend := false }
  else s

/-- 別 ticket の動いている run が予約している PR に、この ticket が失敗したことのある PR が含まれる。 -/
def holds (k : Tk) : P → Bool
  | .P1 => match k.run with
    | none => false
    | some r => r.h1
  | .P2 => match k.run with
    | none => false
    | some r => r.h2

abbrev conflict (s : St) (t : T) : Prop :=
  (holds (tk s (other t)) .P1 = true ∧ 0 < (tk s t).f1)
    ∨ (holds (tk s (other t)) .P2 = true ∧ 0 < (tk s t).f2)

/-- 補充を判定する操作の前処理（規則 11）: run の開始（動いている run がないとき）、失敗の計上（動いている run があるとき）、
ticket への grant の直前に、受領済みのレビューを判定する。それ以外の操作では何もしない。 -/
def pre (s : St) : Ev → St
  | .start t => if (tk s t).run = none then refresh s t else s
  | .fail t _ => if (tk s t).run = none then s else refresh s t
  | .grant t => refresh s t
  | _ => s

/-- 判定の後の 1 操作（BOXP-673 までの規則と、レビューの受領）。 -/
def core (s : St) : Ev → St
  | .start t =>
    -- run の開始。動いている run がある・上限に達している・PR が他 ticket の run に予約されている、のどれかなら始めない。
    if (tk s t).run = none ∧ ¬ exhausted s t ∧ ¬ conflict s t then
      setTk s t { tk s t with run := some ⟨decide (0 < (tk s t).f1), decide (0 < (tk s t).f2), false⟩ }
    else s
  | .finish t => setTk s t { tk s t with run := none }
  | .pass t p =>
    -- 動いている run が PR を gate に通して合格した。数えるのは PR の登録だけ。
    match (tk s t).run with
    | none => s
    | some _ => claim s t p
  | .fail t p =>
    -- 動いている run が PR の gate で再試行できる失敗をした。同じ run の 2 回目以降は数えない。
    match (tk s t).run with
    | none => s
    | some r =>
      let s1 := claim s t p
      if r.failed then s1
      else
        let k := tk s1 t
        match p with
        | .P1 => setTk s1 t { k with f1 := k.f1 + 1, run := some { r with failed := true } }
        | .P2 => setTk s1 t { k with f2 := k.f2 + 1, run := some { r with failed := true } }
  | .grant t => setTk s t { tk s t with additive := (tk s t).additive + 1 }
  | .legacy t => setTk s t { tk s t with legacy := (tk s t).legacy + 1 }
  | .excl t p =>
    match p with
    | .P1 => setTk s t { tk s t with x1 := true }
    | .P2 => setTk s t { tk s t with x2 := true }
  -- BOXP-753: 受領は記録だけ。判定は次の開始・計上・grant で行う。
  | .review t => setTk s t { tk s t with pend := true }
  -- 同じレビューの受領を何度書いても、判定は 1 回だけ（何も変わらない）。
  | .redeliver _ => s

/-- 仕様: 1 操作の後の状態 = 受領済みレビューの判定の後に、その操作。 -/
def step (s : St) (e : Ev) : St := core (pre s e) e

/-! ## 証明（モデルについて、全ての状態で成り立つ）

番号は README.md の「規則」の番号。規則 1〜10 はまず `core` について示し、`pre`（レビューの判定）が
それを崩さないことを別に示して合わせる。 -/

/-- run の有無と、run が失敗を数え済みかで場合分けする。 -/
macro "split_run" r:ident : tactic =>
  `(tactic| rcases $r:ident with _ | ⟨_, _, _ | _⟩)

macro "unfold_model" : tactic =>
  `(tactic| ((try simp only [core, exhausted, conflict, claim] at *)
             (repeat' split)
             all_goals (try simp only [used, limit, scopeN, holds, tk, setTk, owner, other, unit] at *)))

/-! ### レビューの判定 `refresh` の性質 -/

/-- 判定は何もしないか、その ticket の pend・nref・mark・bonus だけを変える（nref・bonus は減らない）。 -/
theorem refresh_shape (s : St) (t : T) :
    refresh s t = s ∨ ∃ n m b, (tk s t).nref ≤ n ∧ (tk s t).bonus ≤ b ∧
      refresh s t = setTk s t { tk s t with pend := false, nref := n, mark := m, bonus := b } := by
  unfold refresh
  split
  · split
    · exact Or.inr ⟨_, _, _, Nat.le_succ _, Nat.le_add_right _ _, rfl⟩
    · exact Or.inr ⟨_, _, _, Nat.le_refl _, Nat.le_refl _, rfl⟩
  · exact Or.inl rfl

theorem tk_setTk (s : St) (t : T) (k : Tk) : tk (setTk s t k) t = k := by
  cases t <;> rfl

/-- 上限のうち、レビュー補充以外の部分。 -/
def limit0 (s : St) (t : T) : Nat :=
  max (unit * max 1 (scopeN s t)) (unit + (tk s t).legacy) + (tk s t).additive

/-- 判定が変えるのはその ticket の pend・nref・mark・bonus だけで、上限は bonus の差だけ動く。 -/
theorem meta_limit (s : St) (t : T) (pd : Bool) (n m b : Nat) :
    limit (setTk s t { tk s t with pend := pd, nref := n, mark := m, bonus := b }) t + (tk s t).bonus
      = limit s t + b := by
  have h0 : limit0 (setTk s t { tk s t with pend := pd, nref := n, mark := m, bonus := b }) t = limit0 s t := by
    cases t <;> rfl
  have h1 : limit (setTk s t { tk s t with pend := pd, nref := n, mark := m, bonus := b }) t
      = limit0 (setTk s t { tk s t with pend := pd, nref := n, mark := m, bonus := b }) t
        + (tk (setTk s t { tk s t with pend := pd, nref := n, mark := m, bonus := b }) t).bonus := rfl
  have h2 : limit s t = limit0 s t + (tk s t).bonus := rfl
  have h3 : (tk (setTk s t { tk s t with pend := pd, nref := n, mark := m, bonus := b }) t).bonus = b := by
    cases t <;> rfl
  rw [h1, h2, h0, h3]
  omega

theorem tk_setTk_other (s : St) (t u : T) (k : Tk) (h : t ≠ u) : tk (setTk s t k) u = tk s u := by
  cases t <;> cases u <;> simp_all [setTk, tk]

/-- 基本枠は PR 2 件分（unit × 2）を超えない。 -/
theorem base_le (s : St) (t : T) : base s t ≤ unit * 2 := by
  cases t <;> simp only [base, scopeN, unit] <;> (repeat' split) <;> omega

/-- 判定の前後で、どの ticket の失敗・grant・除外・run・PR の持ち主も変わらない。 -/
theorem refresh_keeps (s : St) (t u : T) :
    (tk (refresh s t) u).f1 = (tk s u).f1 ∧ (tk (refresh s t) u).f2 = (tk s u).f2
      ∧ (tk (refresh s t) u).legacy = (tk s u).legacy ∧ (tk (refresh s t) u).additive = (tk s u).additive
      ∧ (tk (refresh s t) u).x1 = (tk s u).x1 ∧ (tk (refresh s t) u).x2 = (tk s u).x2
      ∧ (tk (refresh s t) u).run = (tk s u).run
      ∧ (refresh s t).o1 = s.o1 ∧ (refresh s t).o2 = s.o2
      ∧ (tk s u).nref ≤ (tk (refresh s t) u).nref ∧ (tk s u).bonus ≤ (tk (refresh s t) u).bonus := by
  rcases refresh_shape s t with h | ⟨n, m, b, hn, hb, h⟩ <;> rw [h]
  · simp
  · cases t <;> cases u <;> simp_all [setTk, tk]

theorem refresh_used (s : St) (t u : T) : used (refresh s t) u = used s u := by
  have := refresh_keeps s t u; simp only [used]; omega

theorem refresh_scopeN (s : St) (t u : T) : scopeN (refresh s t) u = scopeN s u := by
  have := refresh_keeps s t u; simp only [scopeN]; simp only [this]

theorem refresh_limit_mono (s : St) (t u : T) : limit s u ≤ limit (refresh s t) u := by
  have := refresh_keeps s t u; have hn := refresh_scopeN s t u; simp only [limit]; rw [hn]; omega

theorem refresh_conflict (s : St) (t u : T) : conflict (refresh s t) u ↔ conflict s u := by
  have hu := refresh_keeps s t u
  have ho := refresh_keeps s t (other u)
  simp only [conflict, holds, ho.2.2.2.2.2.2.1, hu.1, hu.2.1]

/-- 上限に達している ticket は補充されない（止まった ticket を動かすのは Owner の grant だけ）。 -/
theorem exhausted_no_refresh (s : St) (t : T) (h : exhausted s t) : limit (refresh s t) t = limit s t := by
  unfold refresh
  split
  · split
    · rename_i hr; exact absurd h hr.1
    · cases t <;> rfl
  · rfl

/-- 前回の補充（なければ記録の始まり）より後に失敗がなければ、補充しない（同じ方針の繰り返し）。 -/
theorem no_refresh_without_new_failure (s : St) (t : T) (h : used s t ≤ (tk s t).mark) :
    limit (refresh s t) t = limit s t := by
  unfold refresh
  split
  · split
    · rename_i hr; exact absurd hr.2.1 (Nat.not_lt.mpr h)
    · cases t <;> rfl
  · rfl

/-- 補充は 1 ticket あたり `refreshCap` 回まで。回数を使い切ると補充しない。 -/
theorem no_refresh_over_cap (s : St) (t : T) (h : refreshCap ≤ (tk s t).nref) :
    limit (refresh s t) t = limit s t := by
  unfold refresh
  split
  · split
    · rename_i hr; exact absurd hr.2.2.1 (Nat.not_lt.mpr h)
    · cases t <;> rfl
  · rfl

/-- 補充すると、残りがちょうど基本枠になる（上限 = 失敗の数 + 基本枠）。 -/
theorem refresh_restores_base (s : St) (t : T) (hp : (tk s t).pend = true) (hr : refreshable s t) :
    limit (refresh s t) t = used s t + base s t := by
  have hl := hr.2.2.2
  have hm := meta_limit s t false ((tk s t).nref + 1) (used s t) ((tk s t).bonus + (used s t + base s t - limit s t))
  unfold refresh
  rw [ite_eq_left_of_eq_true _ _ (eq_true hp), ite_eq_left_of_eq_true _ _ (eq_true hr)]
  omega

/-- 判定は 1 回だけ: 判定の後には受領済みで未判定のレビューは残らず、もう一度判定しても何も変わらない。 -/
theorem refresh_once (s : St) (t : T) : (tk (refresh s t) t).pend = false ∧ refresh (refresh s t) t = refresh s t := by
  unfold refresh
  split
  · split <;> cases t <;> simp [setTk, tk]
  · rename_i h
    cases t <;> simp_all

/-- 受領を書いただけ・同じ受領の再配送では、どの ticket の上限も変わらない（補充は判定のときだけ）。 -/
theorem review_does_not_raise (s : St) (t u : T) :
    limit (step s (.review t)) u = limit s u ∧ step s (.redeliver t) = s := by
  constructor
  · cases t <;> cases u <;> rfl
  · rfl

/-! ### `pre` の性質 -/

theorem pre_shape (s : St) (e : Ev) : pre s e = s ∨ ∃ t, pre s e = refresh s t := by
  cases e with
  | start t =>
    by_cases h : (tk s t).run = none
    · exact Or.inr ⟨t, by simp [pre, h]⟩
    · exact Or.inl (by simp [pre, h])
  | fail t p =>
    by_cases h : (tk s t).run = none
    · exact Or.inl (by simp [pre, h])
    · exact Or.inr ⟨t, by simp [pre, h]⟩
  | grant t => exact Or.inr ⟨t, rfl⟩
  | _ => exact Or.inl rfl

theorem pre_keeps (s : St) (e : Ev) (u : T) :
    used (pre s e) u = used s u ∧ (tk (pre s e) u).additive = (tk s u).additive
      ∧ (tk (pre s e) u).legacy = (tk s u).legacy ∧ (tk (pre s e) u).run = (tk s u).run
      ∧ owner (pre s e) .P1 = owner s .P1 ∧ owner (pre s e) .P2 = owner s .P2
      ∧ limit s u ≤ limit (pre s e) u ∧ (conflict (pre s e) u ↔ conflict s u)
      ∧ (tk s u).nref ≤ (tk (pre s e) u).nref := by
  rcases pre_shape s e with h | ⟨t, h⟩ <;> rw [h]
  · exact ⟨rfl, rfl, rfl, rfl, rfl, rfl, Nat.le_refl _, Iff.rfl, Nat.le_refl _⟩
  · have k := refresh_keeps s t u
    exact ⟨refresh_used s t u, k.2.2.2.1, k.2.2.1, k.2.2.2.2.2.2.1, k.2.2.2.2.2.2.2.1, k.2.2.2.2.2.2.2.2.1,
      refresh_limit_mono s t u, refresh_conflict s t u, k.2.2.2.2.2.2.2.2.2.1⟩

/-! ### `core` についての規則 1〜10 -/

theorem core_never_reset (s : St) (e : Ev) (t : T) :
    used s t ≤ used (core s e) t ∧ (tk s t).additive ≤ (tk (core s e) t).additive
      ∧ (tk s t).legacy ≤ (tk (core s e) t).legacy := by
  obtain ⟨⟨af1, af2, al, aa, ax1, ax2, ar, ap, an, am, ab⟩, ⟨bf1, bf2, bl, ba, bx1, bx2, br, bp, bn, bm, bb⟩, o1, o2⟩ := s
  cases e with
  | start u => cases u <;> cases t <;> unfold_model <;> grind
  | finish u => cases u <;> cases t <;> unfold_model <;> grind
  | pass u p => cases u <;> cases p <;> cases t <;> (split_run ar) <;> (split_run br) <;> unfold_model <;> grind
  | fail u p => cases u <;> cases p <;> cases t <;> (split_run ar) <;> (split_run br) <;> unfold_model <;> grind
  | grant u => cases u <;> cases t <;> unfold_model <;> grind
  | legacy u => cases u <;> cases t <;> unfold_model <;> grind
  | excl u p => cases u <;> cases p <;> cases t <;> unfold_model <;> grind
  | review u => cases u <;> cases t <;> unfold_model <;> grind
  | redeliver u => cases u <;> cases t <;> unfold_model <;> grind

/-- 規則 1: 失敗の数と grant は、どの操作でも減らない（reset はない）。補充の回数と量も減らない。 -/
theorem never_reset (s : St) (e : Ev) (t : T) :
    used s t ≤ used (step s e) t ∧ (tk s t).additive ≤ (tk (step s e) t).additive
      ∧ (tk s t).legacy ≤ (tk (step s e) t).legacy := by
  have p := pre_keeps s e t
  have c := core_never_reset (pre s e) e t
  simp only [step]
  exact ⟨p.1 ▸ c.1, p.2.1 ▸ c.2.1, p.2.2.1 ▸ c.2.2⟩

/-- 規則 2: 1 つの run が数える失敗は 1 件まで（失敗を数え済みの run の再処理・別 PR での失敗は数を変えない）。 -/
theorem one_failure_per_run (s : St) (t : T) (p : P) (r : Run)
    (h : (tk s t).run = some r) (hf : r.failed = true) :
    used (step s (.fail t p)) t = used s t := by
  have hp := pre_keeps s (.fail t p) t
  have h' : (tk (pre s (.fail t p)) t).run = some r := hp.2.2.2.1 ▸ h
  simp only [step]; rw [← hp.1]
  generalize pre s (.fail t p) = s' at h'
  obtain ⟨⟨af1, af2, al, aa, ax1, ax2, ar, ap, an, am, ab⟩, ⟨bf1, bf2, bl, ba, bx1, bx2, br, bp, bn, bm, bb⟩, o1, o2⟩ := s'
  cases t <;> cases p <;> unfold_model <;> grind

/-- 規則 3a: 上限は unit を下回らず、旧 grant と追加 grant を足した分、PR 数に応じた分のどちらも下回らない。 -/
theorem limit_floor (s : St) (t : T) :
    unit ≤ limit s t ∧ unit + (tk s t).legacy + (tk s t).additive ≤ limit s t
      ∧ unit * scopeN s t + (tk s t).additive ≤ limit s t := by
  cases t <;> unfold_model <;> grind

/-- 規則 3b: 追加 grant 1 件は上限をちょうど 1 増やす（受領済みで未判定のレビューがないとき）。 -/
theorem grant_adds_one (s : St) (t : T) (hp : (tk s t).pend = false) :
    limit (step s (.grant t)) t = limit s t + 1 := by
  have : pre s (.grant t) = s := by simp [pre, refresh, hp]
  simp only [step, this]
  cases t <;> unfold_model <;> grind

/-- 規則 3b': 未判定のレビューがあっても、grant は上限を少なくとも 1 増やす。 -/
theorem grant_adds_at_least_one (s : St) (t : T) : limit s t + 1 ≤ limit (step s (.grant t)) t := by
  have hp := (pre_keeps s (.grant t) t).2.2.2.2.2.2.1
  have : limit (core (pre s (.grant t)) (.grant t)) t = limit (pre s (.grant t)) t + 1 := by
    generalize pre s (.grant t) = s'
    cases t <;> unfold_model <;> grind
  simp only [step]; omega

/-- 規則 3c: 旧 grant は下限でしかない。PR 数に応じた分が既に上回っていれば、旧 grant を足しても上限は変わらない
（PR 数の分と二重に数えない）。 -/
theorem legacy_is_floor_only (s : St) (t : T)
    (h : unit + (tk s t).legacy + 1 ≤ unit * max 1 (scopeN s t)) :
    limit (step s (.legacy t)) t = limit s t := by
  simp only [step, pre]
  cases t <;> unfold_model <;> grind

/-- 規則 4: 上限に達した ticket の run は始まらない（run の有無も、上限に達していることも変わらない）。 -/
theorem exhausted_does_not_start (s : St) (t : T) (h : exhausted s t) :
    (tk (step s (.start t)) t).run = (tk s t).run ∧ exhausted (step s (.start t)) t := by
  simp only [step, pre]
  split
  · rename_i hr
    have hl := exhausted_no_refresh s t h
    have hu := refresh_used s t t
    have hk := (refresh_keeps s t t).2.2.2.2.2.2.1
    have he : exhausted (refresh s t) t := by simp only [exhausted] at *; omega
    generalize refresh s t = s' at he hk
    have hr' : (tk s' t).run = none := hk ▸ hr
    rw [← hk]
    cases t <;> unfold_model <;> grind
  · cases t <;> unfold_model <;> grind

/-- 規則 5: 残りの枠があり、動いている run がなく、PR が他 ticket の run に予約されていなければ、run は始まる。
PR ごとの失敗数は開始を止めない（判定に現れない）。 -/
theorem starts_when_budget_remains (s : St) (t : T)
    (hr : (tk s t).run = none) (hb : ¬ exhausted s t) (hc : ¬ conflict s t) :
    (tk (step s (.start t)) t).run ≠ none := by
  have hp := pre_keeps s (.start t) t
  have hr' : (tk (pre s (.start t)) t).run = none := hp.2.2.2.1 ▸ hr
  have hb' : ¬ exhausted (pre s (.start t)) t := by simp only [exhausted] at *; omega
  have hc' : ¬ conflict (pre s (.start t)) t := fun h => hc (hp.2.2.2.2.2.2.2.1.mp h)
  simp only [step]
  generalize pre s (.start t) = s' at hr' hb' hc'
  cases t <;> unfold_model <;> grind

theorem core_owner_is_permanent (s : St) (e : Ev) (p : P) (t : T) (h : owner s p = some t) :
    owner (core s e) p = some t := by
  obtain ⟨⟨af1, af2, al, aa, ax1, ax2, ar, ap, an, am, ab⟩, ⟨bf1, bf2, bl, ba, bx1, bx2, br, bp, bn, bm, bb⟩, o1, o2⟩ := s
  cases e with
  | start u => cases u <;> cases p <;> unfold_model <;> grind
  | finish u => cases u <;> cases p <;> unfold_model <;> grind
  | pass u q => cases u <;> cases q <;> cases p <;> (split_run ar) <;> (split_run br) <;> unfold_model <;> grind
  | fail u q => cases u <;> cases q <;> cases p <;> (split_run ar) <;> (split_run br) <;> unfold_model <;> grind
  | grant u => cases u <;> cases p <;> unfold_model <;> grind
  | legacy u => cases u <;> cases p <;> unfold_model <;> grind
  | excl u q => cases u <;> cases q <;> cases p <;> unfold_model <;> grind
  | review u => cases u <;> cases p <;> unfold_model <;> grind
  | redeliver u => cases u <;> cases p <;> unfold_model <;> grind

/-- 規則 6: いちど決まった PR の持ち主は、どの操作でも変わらない。 -/
theorem owner_is_permanent (s : St) (e : Ev) (p : P) (t : T) (h : owner s p = some t) :
    owner (step s e) p = some t := by
  have hp := pre_keeps s e t
  apply core_owner_is_permanent
  cases p
  · exact hp.2.2.2.2.1 ▸ h
  · exact hp.2.2.2.2.2.1 ▸ h

/-- 除外の操作か。 -/
def Ev.isExcl : Ev → Bool
  | .excl _ _ => true
  | _ => false

theorem core_limit_only_lowered_by_exclusion (s : St) (e : Ev) (t : T) (h : e.isExcl = false) :
    limit s t ≤ limit (core s e) t := by
  obtain ⟨⟨af1, af2, al, aa, ax1, ax2, ar, ap, an, am, ab⟩, ⟨bf1, bf2, bl, ba, bx1, bx2, br, bp, bn, bm, bb⟩, o1, o2⟩ := s
  cases e with
  | start u => cases u <;> cases t <;> unfold_model <;> grind
  | finish u => cases u <;> cases t <;> unfold_model <;> grind
  | pass u p => cases u <;> cases p <;> cases t <;> unfold_model <;> grind
  | fail u p => cases u <;> cases p <;> cases t <;> unfold_model <;> grind
  | grant u => cases u <;> cases t <;> unfold_model <;> grind
  | legacy u => cases u <;> cases t <;> unfold_model <;> grind
  | excl u p => simp [Ev.isExcl] at h
  | review u => cases u <;> cases t <;> unfold_model <;> grind
  | redeliver u => cases u <;> cases t <;> unfold_model <;> grind

/-- 規則 7: 除外以外の操作は、どの ticket の上限も下げない（他 ticket の操作で枠が減ることはない）。 -/
theorem limit_only_lowered_by_exclusion (s : St) (e : Ev) (t : T) (h : e.isExcl = false) :
    limit s t ≤ limit (step s e) t :=
  Nat.le_trans (pre_keeps s e t).2.2.2.2.2.2.1 (core_limit_only_lowered_by_exclusion (pre s e) e t h)

/-- 規則 8: 除外は、その ticket の上限を上げない。もう一方の ticket の上限は変えない。 -/
theorem exclusion_only_lowers_own (s : St) (t : T) (p : P) :
    limit (step s (.excl t p)) t ≤ limit s t
      ∧ limit (step s (.excl t p)) (other t) = limit s (other t) := by
  simp only [step, pre]
  obtain ⟨⟨af1, af2, al, aa, ax1, ax2, ar, ap, an, am, ab⟩, ⟨bf1, bf2, bl, ba, bx1, bx2, br, bp, bn, bm, bb⟩, o1, o2⟩ := s
  cases t <;> cases p <;> unfold_model <;> grind

/-- ticket 1 件分の不変条件: 失敗の数は上限以下。失敗をまだ数えていない run が動いている間は上限未満。 -/
def TkOk (s : St) (t : T) : Prop :=
  used s t ≤ limit s t ∧ ∀ r, (tk s t).run = some r → r.failed = false → used s t < limit s t

/-- 2 つの run が同じ PR を同時に予約していない。 -/
def Exclusive (s : St) : Prop :=
  ∀ ra rb, s.a.run = some ra → s.b.run = some rb →
    ¬ (ra.h1 = true ∧ rb.h1 = true) ∧ ¬ (ra.h2 = true ∧ rb.h2 = true)

/-- 初期状態から、除外以外の操作を何回でも、どんな順でも行って届く状態。 -/
inductive ReachableNoExcl : St → Prop
  | init : ReachableNoExcl {}
  | step (s : St) (e : Ev) : ReachableNoExcl s → e.isExcl = false → ReachableNoExcl (step s e)

/-- 初期状態から操作を何回でも、どんな順でも行って届く状態。 -/
inductive Reachable : St → Prop
  | init : Reachable {}
  | step (s : St) (e : Ev) : Reachable s → Reachable (step s e)

theorem tkok_pre (s : St) (e : Ev) (t : T) (h : TkOk s t) : TkOk (pre s e) t := by
  have hp := pre_keeps s e t
  simp only [TkOk] at *
  rw [hp.1, hp.2.2.2.1]
  exact ⟨Nat.le_trans h.1 hp.2.2.2.2.2.2.1, fun r hr hf => Nat.lt_of_lt_of_le (h.2 r hr hf) hp.2.2.2.2.2.2.1⟩

set_option maxHeartbeats 2000000 in
theorem tkok_core (s : St) (e : Ev) (t : T) (he : e.isExcl = false) (h : TkOk s t) :
    TkOk (core s e) t := by
  obtain ⟨⟨af1, af2, al, aa, ax1, ax2, ar, ap, an, am, ab⟩, ⟨bf1, bf2, bl, ba, bx1, bx2, br, bp, bn, bm, bb⟩, o1, o2⟩ := s
  simp only [TkOk] at *
  cases e with
  | start u => cases u <;> cases t <;> (split_run ar) <;> (split_run br) <;> unfold_model <;> grind
  | finish u => cases u <;> cases t <;> (split_run ar) <;> (split_run br) <;> unfold_model <;> grind
  | pass u p =>
    cases u <;> cases p <;> cases t <;> unfold_model <;> grind
  | fail u p =>
    cases u <;> cases p <;> cases t <;> unfold_model <;> grind
  | grant u => cases u <;> cases t <;> (split_run ar) <;> (split_run br) <;> unfold_model <;> grind
  | legacy u => cases u <;> cases t <;> (split_run ar) <;> (split_run br) <;> unfold_model <;> grind
  | excl u p => simp [Ev.isExcl] at he
  | review u => cases u <;> cases t <;> (split_run ar) <;> (split_run br) <;> unfold_model <;> grind
  | redeliver u => cases u <;> cases t <;> unfold_model <;> grind

/-- 規則 9: 除外が行われない限り、どんな操作順・どんな長さでも、失敗の数は上限を超えない
（上限に達した後の run は生まれない）。 -/
theorem never_over_limit (s : St) (h : ReachableNoExcl s) (t : T) : used s t ≤ limit s t := by
  have : TkOk s t := by
    induction h with
    | init => cases t <;> simp [TkOk, used, limit, scopeN, tk, unit]
    | step s e _ he ih => exact tkok_core (pre s e) e t he (tkok_pre s e t ih)
  exact this.1

theorem exclusive_core (s : St) (e : Ev) (h : Exclusive s) : Exclusive (core s e) := by
  obtain ⟨⟨af1, af2, al, aa, ax1, ax2, ar, ap, an, am, ab⟩, ⟨bf1, bf2, bl, ba, bx1, bx2, br, bp, bn, bm, bb⟩, o1, o2⟩ := s
  simp only [Exclusive] at *
  cases e with
  | start u => cases u <;> (split_run ar) <;> (split_run br) <;> unfold_model <;> grind
  | finish u => cases u <;> (split_run ar) <;> (split_run br) <;> unfold_model <;> grind
  | pass u p => cases u <;> cases p <;> (split_run ar) <;> (split_run br) <;> unfold_model <;> grind
  | fail u p => cases u <;> cases p <;> (split_run ar) <;> (split_run br) <;> unfold_model <;> grind
  | grant u => cases u <;> (split_run ar) <;> (split_run br) <;> unfold_model <;> grind
  | legacy u => cases u <;> (split_run ar) <;> (split_run br) <;> unfold_model <;> grind
  | excl u p => cases u <;> cases p <;> (split_run ar) <;> (split_run br) <;> unfold_model <;> grind
  | review u => cases u <;> (split_run ar) <;> (split_run br) <;> unfold_model <;> grind
  | redeliver u => cases u <;> (split_run ar) <;> (split_run br) <;> unfold_model <;> grind

theorem exclusive_pre (s : St) (e : Ev) (h : Exclusive s) : Exclusive (pre s e) := by
  have ha := (pre_keeps s e .T1).2.2.2.1
  have hb := (pre_keeps s e .T2).2.2.2.1
  simp only [Exclusive, tk] at *
  rw [ha, hb]; exact h

/-- 規則 10: どんな操作順・どんな長さでも、2 つの ticket の run が同じ PR を同時に予約することはない。 -/
theorem reservations_exclusive (s : St) (h : Reachable s) : Exclusive s := by
  induction h with
  | init => simp [Exclusive]
  | step s e _ ih => exact exclusive_core (pre s e) e (exclusive_pre s e ih)

/-! ### 規則 11: レビュー補充は有限 -/

/-- 補充の回数は上限以下、補充の量の合計は 1 回あたり基本枠の最大（PR 2 件 × unit）以下。 -/
def RefOk (s : St) (t : T) : Prop :=
  (tk s t).nref ≤ refreshCap ∧ (tk s t).bonus ≤ (tk s t).nref * (unit * 2)

theorem refok_refresh (s : St) (t u : T) (h : RefOk s u) : RefOk (refresh s t) u := by
  unfold refresh
  split
  · split
    · rename_i hp hr
      by_cases ht : t = u
      · subst ht
        have hx : used s t < limit s t := Nat.lt_of_not_le hr.1
        have hc := hr.2.2.1
        have hb := base_le s t
        simp only [RefOk, tk_setTk, refreshCap, unit] at *
        rw [Nat.succ_mul]
        omega
      · simp only [RefOk, tk_setTk_other s t u _ ht] at *; exact h
    · by_cases ht : t = u
      · subst ht; simp only [RefOk, tk_setTk] at *; exact h
      · simp only [RefOk, tk_setTk_other s t u _ ht] at *; exact h
  · exact h

theorem refok_core (s : St) (e : Ev) (t : T) (h : RefOk s t) : RefOk (core s e) t := by
  obtain ⟨⟨af1, af2, al, aa, ax1, ax2, ar, ap, an, am, ab⟩, ⟨bf1, bf2, bl, ba, bx1, bx2, br, bp, bn, bm, bb⟩, o1, o2⟩ := s
  simp only [RefOk] at *
  cases e with
  | start u => cases u <;> cases t <;> unfold_model <;> grind
  | finish u => cases u <;> cases t <;> unfold_model <;> grind
  | pass u p => cases u <;> cases p <;> cases t <;> unfold_model <;> grind
  | fail u p => cases u <;> cases p <;> cases t <;> unfold_model <;> grind
  | grant u => cases u <;> cases t <;> unfold_model <;> grind
  | legacy u => cases u <;> cases t <;> unfold_model <;> grind
  | excl u p => cases u <;> cases p <;> cases t <;> unfold_model <;> grind
  | review u => cases u <;> cases t <;> unfold_model <;> grind
  | redeliver u => cases u <;> cases t <;> unfold_model <;> grind

/-- 規則 11: どんな操作順・どんな長さでも、レビューの往復で上限は無限に延びない。補充は 1 ticket あたり
`refreshCap` 回まで、補充の量の合計は `refreshCap` × (PR 2 件分の基本枠) 以下。 -/
theorem refresh_bounded (s : St) (h : Reachable s) (t : T) :
    (tk s t).nref ≤ refreshCap ∧ (tk s t).bonus ≤ refreshCap * (unit * 2) := by
  have : RefOk s t := by
    induction h with
    | init => cases t <;> simp [RefOk, tk]
    | step s e _ ih =>
      apply refok_core
      rcases pre_shape s e with hp | ⟨u, hp⟩ <;> rw [hp]
      · exact ih
      · exact refok_refresh s u t ih
  exact ⟨this.1, Nat.le_trans this.2 (Nat.mul_le_mul_right _ this.1)⟩

/-! ## テストケースの機械生成 -/

def evs : List Ev :=
  [.start .T1, .start .T2, .finish .T1, .finish .T2,
   .pass .T1 .P1, .pass .T1 .P2, .pass .T2 .P1, .pass .T2 .P2,
   .fail .T1 .P1, .fail .T1 .P2, .fail .T2 .P1, .fail .T2 .P2,
   .grant .T1, .grant .T2, .legacy .T1, .legacy .T2,
   .excl .T1 .P1, .excl .T1 .P2, .excl .T2 .P1, .excl .T2 .P2,
   .review .T1, .review .T2, .redeliver .T1, .redeliver .T2]

def ts : T → String
  | .T1 => "1"
  | .T2 => "2"

def ps : P → String
  | .P1 => "a"
  | .P2 => "b"

def evs2s : Ev → String
  | .start t => "s" ++ ts t
  | .finish t => "e" ++ ts t
  | .pass t p => "p" ++ ts t ++ ps p
  | .fail t p => "f" ++ ts t ++ ps p
  | .grant t => "g" ++ ts t
  | .legacy t => "l" ++ ts t
  | .excl t p => "x" ++ ts t ++ ps p
  | .review t => "v" ++ ts t
  | .redeliver t => "w" ++ ts t

/-- 操作が返す結果: run が始まった、または失敗を処理した後に上限へ達している、なら 1。 -/
def result (s : St) : Ev → Nat
  | .start t => if (tk s t).run = none ∧ (tk (step s (.start t)) t).run ≠ none then 1 else 0
  | .fail t p =>
    match (tk s t).run with
    | none => 0
    | some _ => if exhausted (step s (.fail t p)) t then 1 else 0
  | _ => 0

/-- ticket 1 件について実装から読めるもの: 失敗数/上限/PR 数、上限到達 (`x`)、動いている run の予約 (`r` と予約した PR)、
レビュー補充の回数（1 回以上なら `+` と回数）。 -/
def obsTk (s : St) (t : T) : String :=
  let x := if exhausted s t then "x" else ""
  let r := match (tk s t).run with
    | none => ""
    | some r => "r" ++ (if r.h1 then "a" else "") ++ (if r.h2 then "b" else "")
  let v := if (tk s t).nref = 0 then "" else s!"+{(tk s t).nref}"
  s!"{used s t}/{limit s t}/{scopeN s t}{x}{r}{v}"

/-- PR 1 件について実装から読めるもの: その PR での失敗数（全 ticket 合計）と、旧上限 (unit) に達したか (`L`)。
旧上限は監査用の表示で、開始の判定には使わない。 -/
def obsPr (s : St) (p : P) : String :=
  let n := match p with
    | .P1 => s.a.f1 + s.b.f1
    | .P2 => s.a.f2 + s.b.f2
  s!"{n}{if unit ≤ n then "L" else ""}"

/-- 1 操作の後に実装から読めるものの全部。 -/
def obs (s : St) (e : Ev) : String :=
  let s' := step s e
  s!"{result s e};{obsTk s' .T1};{obsTk s' .T2};{obsPr s' .P1};{obsPr s' .P2}"

/-- 手順（新しい操作が先頭）を `操作列|各操作後の期待` の 1 行にする。 -/
def line (revPath : List Ev) : String :=
  let t := revPath.reverse
  let (_, os) := t.foldl (fun (s, os) e => (step s e, obs s e :: os)) (({} : St), [])
  ",".intercalate (t.map evs2s) ++ "|" ++ ",".intercalate os.reverse

/-- 途中の状態から始める手順の出発点。短い手順では届かない場面（PR の予約の衝突、上限到達後の grant、
PR 2 件分の上限）を、決めた操作列で作ってから、そこからの全操作を通す。出発点も初期状態からの操作列なので、
実装側も同じ操作を実行してその状態に入る（状態を直接書き込まない）。 -/
def seeds : List (List Ev) :=
  [ -- 両方の ticket が P1 で 1 回ずつ失敗している（次に P1 の予約が衝突しうる）
    [.start .T1, .fail .T1 .P1, .finish .T1, .start .T2, .fail .T2 .P1, .finish .T2],
    -- T1 が上限（PR 1 件 × unit 2）に達して止まっている
    [.start .T1, .fail .T1 .P1, .finish .T1, .start .T1, .fail .T1 .P1, .finish .T1],
    -- T1 が PR 2 件の持ち主で、上限 4 のうち 3 回失敗している
    [.start .T1, .pass .T1 .P2, .fail .T1 .P1, .finish .T1, .start .T1, .fail .T1 .P2, .finish .T1,
     .start .T1, .fail .T1 .P1, .finish .T1],
    -- BOXP-753: T1 が 1/2 で動いている run の中で停滞レビューを受領した（BOXP-749 と同じ形。次の失敗の計上の直前に補充）
    [.start .T1, .fail .T1 .P1, .finish .T1, .start .T1, .review .T1],
    -- T1 が 2 回補充を使い切った（次の受領では補充しない）
    [.start .T1, .fail .T1 .P1, .finish .T1, .review .T1, .start .T1, .fail .T1 .P1, .finish .T1,
     .review .T1, .start .T1, .fail .T1 .P1, .finish .T1] ]

/-- 出発点（操作列 `seed` の後の状態）から `depth - 1` 手以内で届く全ての状態について、そこからの全操作を
1 回ずつ通る手順の集合（手順は `seed` の後に最長 `depth` 手。`depth` 手目で初めて届く状態は、届くところまでで、
そこからは伸ばさない）。同じ状態へは最短の手順 1 本だけを伸ばす。他の手順の先頭部分になる手順は出力しない。 -/
def coverFrom (seed : List Ev) (depth : Nat) : IO Unit := do
  let root : St := seed.foldl step {}
  let mut seen : Std.HashSet St := Std.HashSet.emptyWithCapacity.insert root
  let mut frontier : List (St × List Ev) := [(root, seed.reverse)]
  for _ in [0:depth] do
    let mut next : List (St × List Ev) := []
    for (s, p) in frontier do
      for e in evs do
        let s' := step s e
        if seen.contains s' then
          IO.println (line (e :: p))
        else
          seen := seen.insert s'
          next := (s', e :: p) :: next
    frontier := next.reverse
  for (_, p) in frontier do
    IO.println (line p)

/-- 途中の状態から始める手順の深さ。 -/
def seedDepth : Nat := 3

/-- 初期状態から深さ `depth`、各出発点から深さ `seedDepth` の手順。 -/
def cover (depth : Nat) : IO Unit := do
  coverFrom [] depth
  for seed in seeds do
    coverFrom seed seedDepth

def main (args : List String) : IO Unit := do
  match args with
  | ["cover", n] => cover n.toNat!
  | _ => IO.eprintln "usage: lean --run GateBudgetModel.lean cover DEPTH"
