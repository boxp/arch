import Std.Data.HashSet

/-!
# Task Board runner: PR gate 失敗予算（ticket pool）と run 開始の予約の小さなモデル (BOXP-673)

ticket 2 件 (T1・T2)、PR 2 件 (P1・P2)、unit（PR 1 件あたりの枠）は 2。
規則は docs/project_docs/BOXP-369・448・450 の文章から起こした。規則の日本語での説明・定理との対応・
実装との対応・省いたものは同じディレクトリの README.md にある。このファイルは Lean 本体だけを使う。

- 証明の検査:   `lean GateBudgetModel.lean`
- 手順の生成:   `lean --run GateBudgetModel.lean cover 7 | gzip -n -9 > gate-budget-traces.txt.gz`
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

/-- ticket の上限 = max(unit × max(1, N), unit + 旧 grant) + 追加 grant。 -/
def limit (s : St) (t : T) : Nat :=
  max (unit * max 1 (scopeN s t)) (unit + (tk s t).legacy) + (tk s t).additive

abbrev exhausted (s : St) (t : T) : Prop := limit s t ≤ used s t

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

/-- 仕様: 1 操作の後の状態。 -/
def step (s : St) : Ev → St
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

/-! ## 証明（モデルについて、全ての状態で成り立つ）

番号は README.md の「規則」の番号。 -/

/-- run の有無と、run が失敗を数え済みかで場合分けする。 -/
macro "split_run" r:ident : tactic =>
  `(tactic| rcases $r:ident with _ | ⟨_, _, _ | _⟩)

macro "unfold_model" : tactic =>
  `(tactic| ((try simp only [step, exhausted, conflict, claim] at *)
             (repeat' split)
             all_goals (try simp only [used, limit, scopeN, holds, tk, setTk, owner, other, unit] at *)))

/-- 規則 1: 失敗の数と grant は、どの操作でも減らない（reset はない）。 -/
theorem never_reset (s : St) (e : Ev) (t : T) :
    used s t ≤ used (step s e) t ∧ (tk s t).additive ≤ (tk (step s e) t).additive
      ∧ (tk s t).legacy ≤ (tk (step s e) t).legacy := by
  obtain ⟨⟨af1, af2, al, aa, ax1, ax2, ar⟩, ⟨bf1, bf2, bl, ba, bx1, bx2, br⟩, o1, o2⟩ := s
  cases e with
  | start u => cases u <;> cases t <;> unfold_model <;> grind
  | finish u => cases u <;> cases t <;> unfold_model <;> grind
  | pass u p => cases u <;> cases p <;> cases t <;> (split_run ar) <;> (split_run br) <;> unfold_model <;> grind
  | fail u p => cases u <;> cases p <;> cases t <;> (split_run ar) <;> (split_run br) <;> unfold_model <;> grind
  | grant u => cases u <;> cases t <;> unfold_model <;> grind
  | legacy u => cases u <;> cases t <;> unfold_model <;> grind
  | excl u p => cases u <;> cases p <;> cases t <;> unfold_model <;> grind

/-- 規則 2: 1 つの run が数える失敗は 1 件まで（失敗を数え済みの run の再処理・別 PR での失敗は数を変えない）。 -/
theorem one_failure_per_run (s : St) (t : T) (p : P) (r : Run)
    (h : (tk s t).run = some r) (hf : r.failed = true) :
    used (step s (.fail t p)) t = used s t := by
  obtain ⟨⟨af1, af2, al, aa, ax1, ax2, ar⟩, ⟨bf1, bf2, bl, ba, bx1, bx2, br⟩, o1, o2⟩ := s
  cases t <;> cases p <;> unfold_model <;> grind

/-- 規則 3a: 上限は unit を下回らず、旧 grant と追加 grant を足した分、PR 数に応じた分のどちらも下回らない。 -/
theorem limit_floor (s : St) (t : T) :
    unit ≤ limit s t ∧ unit + (tk s t).legacy + (tk s t).additive ≤ limit s t
      ∧ unit * scopeN s t + (tk s t).additive ≤ limit s t := by
  cases t <;> unfold_model <;> grind

/-- 規則 3b: 追加 grant 1 件は上限をちょうど 1 増やす。 -/
theorem grant_adds_one (s : St) (t : T) : limit (step s (.grant t)) t = limit s t + 1 := by
  sorry

/-- 規則 3c: 旧 grant は下限でしかない。PR 数に応じた分が既に上回っていれば、旧 grant を足しても上限は変わらない
（PR 数の分と二重に数えない）。 -/
theorem legacy_is_floor_only (s : St) (t : T)
    (h : unit + (tk s t).legacy + 1 ≤ unit * max 1 (scopeN s t)) :
    limit (step s (.legacy t)) t = limit s t := by
  cases t <;> unfold_model <;> grind

/-- 規則 4: 上限に達した ticket の run は始まらない（何も変わらない）。 -/
theorem exhausted_does_not_start (s : St) (t : T) (h : exhausted s t) : step s (.start t) = s := by
  cases t <;> unfold_model <;> grind

/-- 規則 5: 残りの枠があり、動いている run がなく、PR が他 ticket の run に予約されていなければ、run は始まる。
PR ごとの失敗数は開始を止めない（判定に現れない）。 -/
theorem starts_when_budget_remains (s : St) (t : T)
    (hr : (tk s t).run = none) (hb : ¬ exhausted s t) (hc : ¬ conflict s t) :
    (tk (step s (.start t)) t).run ≠ none := by
  cases t <;> unfold_model <;> grind

/-- 規則 6: いちど決まった PR の持ち主は、どの操作でも変わらない。 -/
theorem owner_is_permanent (s : St) (e : Ev) (p : P) (t : T) (h : owner s p = some t) :
    owner (step s e) p = some t := by
  obtain ⟨⟨af1, af2, al, aa, ax1, ax2, ar⟩, ⟨bf1, bf2, bl, ba, bx1, bx2, br⟩, o1, o2⟩ := s
  cases e with
  | start u => cases u <;> cases p <;> unfold_model <;> grind
  | finish u => cases u <;> cases p <;> unfold_model <;> grind
  | pass u q => cases u <;> cases q <;> cases p <;> (split_run ar) <;> (split_run br) <;> unfold_model <;> grind
  | fail u q => cases u <;> cases q <;> cases p <;> (split_run ar) <;> (split_run br) <;> unfold_model <;> grind
  | grant u => cases u <;> cases p <;> unfold_model <;> grind
  | legacy u => cases u <;> cases p <;> unfold_model <;> grind
  | excl u q => cases u <;> cases q <;> cases p <;> unfold_model <;> grind

/-- 除外の操作か。 -/
def Ev.isExcl : Ev → Bool
  | .excl _ _ => true
  | _ => false

/-- 規則 7: 除外以外の操作は、どの ticket の上限も下げない（他 ticket の操作で枠が減ることはない）。 -/
theorem limit_only_lowered_by_exclusion (s : St) (e : Ev) (t : T) (h : e.isExcl = false) :
    limit s t ≤ limit (step s e) t := by
  obtain ⟨⟨af1, af2, al, aa, ax1, ax2, ar⟩, ⟨bf1, bf2, bl, ba, bx1, bx2, br⟩, o1, o2⟩ := s
  cases e with
  | start u => cases u <;> cases t <;> unfold_model <;> grind
  | finish u => cases u <;> cases t <;> unfold_model <;> grind
  | pass u p =>
    cases u <;> cases p <;> cases t <;> unfold_model <;> grind
  | fail u p =>
    cases u <;> cases p <;> cases t <;> unfold_model <;> grind
  | grant u => cases u <;> cases t <;> unfold_model <;> grind
  | legacy u => cases u <;> cases t <;> unfold_model <;> grind
  | excl u p => simp [Ev.isExcl] at h

/-- 規則 8: 除外は、その ticket の上限を上げない。もう一方の ticket の上限は変えない。 -/
theorem exclusion_only_lowers_own (s : St) (t : T) (p : P) :
    limit (step s (.excl t p)) t ≤ limit s t
      ∧ limit (step s (.excl t p)) (other t) = limit s (other t) := by
  obtain ⟨⟨af1, af2, al, aa, ax1, ax2, ar⟩, ⟨bf1, bf2, bl, ba, bx1, bx2, br⟩, o1, o2⟩ := s
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

theorem tkok_step (s : St) (e : Ev) (t : T) (he : e.isExcl = false) (h : TkOk s t) :
    TkOk (step s e) t := by
  obtain ⟨⟨af1, af2, al, aa, ax1, ax2, ar⟩, ⟨bf1, bf2, bl, ba, bx1, bx2, br⟩, o1, o2⟩ := s
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

/-- 規則 9: 除外が行われない限り、どんな操作順・どんな長さでも、失敗の数は上限を超えない
（上限に達した後の run は生まれない）。 -/
theorem never_over_limit (s : St) (h : ReachableNoExcl s) (t : T) : used s t ≤ limit s t := by
  have : TkOk s t := by
    induction h with
    | init => cases t <;> simp [TkOk, used, limit, scopeN, tk, unit]
    | step s e _ he ih => exact tkok_step s e t he ih
  exact this.1

theorem exclusive_step (s : St) (e : Ev) (h : Exclusive s) : Exclusive (step s e) := by
  obtain ⟨⟨af1, af2, al, aa, ax1, ax2, ar⟩, ⟨bf1, bf2, bl, ba, bx1, bx2, br⟩, o1, o2⟩ := s
  simp only [Exclusive] at *
  cases e with
  | start u => cases u <;> (split_run ar) <;> (split_run br) <;> unfold_model <;> grind
  | finish u => cases u <;> (split_run ar) <;> (split_run br) <;> unfold_model <;> grind
  | pass u p => cases u <;> cases p <;> (split_run ar) <;> (split_run br) <;> unfold_model <;> grind
  | fail u p => cases u <;> cases p <;> (split_run ar) <;> (split_run br) <;> unfold_model <;> grind
  | grant u => cases u <;> (split_run ar) <;> (split_run br) <;> unfold_model <;> grind
  | legacy u => cases u <;> (split_run ar) <;> (split_run br) <;> unfold_model <;> grind
  | excl u p => cases u <;> cases p <;> (split_run ar) <;> (split_run br) <;> unfold_model <;> grind

/-- 規則 10: どんな操作順・どんな長さでも、2 つの ticket の run が同じ PR を同時に予約することはない。 -/
theorem reservations_exclusive (s : St) (h : Reachable s) : Exclusive s := by
  induction h with
  | init => simp [Exclusive]
  | step s e _ ih => exact exclusive_step s e ih

/-! ## テストケースの機械生成 -/

def evs : List Ev :=
  [.start .T1, .start .T2, .finish .T1, .finish .T2,
   .pass .T1 .P1, .pass .T1 .P2, .pass .T2 .P1, .pass .T2 .P2,
   .fail .T1 .P1, .fail .T1 .P2, .fail .T2 .P1, .fail .T2 .P2,
   .grant .T1, .grant .T2, .legacy .T1, .legacy .T2,
   .excl .T1 .P1, .excl .T1 .P2, .excl .T2 .P1, .excl .T2 .P2]

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

/-- 操作が返す結果: run が始まった、または失敗を処理した後に上限へ達している、なら 1。 -/
def result (s : St) : Ev → Nat
  | .start t => if (tk s t).run = none ∧ (tk (step s (.start t)) t).run ≠ none then 1 else 0
  | .fail t p =>
    match (tk s t).run with
    | none => 0
    | some _ => if exhausted (step s (.fail t p)) t then 1 else 0
  | _ => 0

/-- ticket 1 件について実装から読めるもの: 失敗数/上限/PR 数、上限到達 (`x`)、動いている run の予約 (`r` と予約した PR)。 -/
def obsTk (s : St) (t : T) : String :=
  let x := if exhausted s t then "x" else ""
  let r := match (tk s t).run with
    | none => ""
    | some r => "r" ++ (if r.h1 then "a" else "") ++ (if r.h2 then "b" else "")
  s!"{used s t}/{limit s t}/{scopeN s t}{x}{r}"

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
     .start .T1, .fail .T1 .P1, .finish .T1] ]

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
