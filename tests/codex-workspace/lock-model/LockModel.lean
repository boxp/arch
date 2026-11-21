import Std.Data.HashSet

/-!
# Task Board runner: ticket lock と計画停止・再起動の小さなモデル (BOXP-650)

owner 2 つ (A・B)、チケット 1 件。規則の日本語での説明・定理との対応・実装との対応・
省いたものは同じディレクトリの README.md にある。このファイルは Lean 本体だけを使う。

- 証明の検査:   `lean LockModel.lean`
- 手順の生成:   `lean --run LockModel.lean cover 5 | gzip -n -9 > lock-traces.txt.gz`
-/

inductive R | A | B
  deriving DecidableEq, Hashable, Repr

inductive Status | active | terminating | terminated
  deriving DecidableEq, Hashable, Repr

/-- lock ファイル。`inst` は取得した process の世代、`run` は付与の通し番号。 -/
structure Lock where
  owner : R
  inst : Nat
  run : Nat
  hb : Nat
  deriving DecidableEq, Hashable, Repr

/-- owner 1 つ分。`inst`・`held` は動いている process の手元、残りはファイル。
`held` はその process が開始してまだ終えていない実行の番号（古い順）。lock を奪われた後に
取り直すと、古い実行と新しい実行の両方が残りうる。 -/
structure Own where
  inst : Nat := 0
  held : List Nat := []
  stInst : Nat := 0
  status : Status := .active
  marker : Option Nat := none
  /-- 印を書いた時刻（印がないときは 0）。 -/
  markAt : Nat := 0
  deriving DecidableEq, Hashable, Repr

structure St where
  clock : Nat := 0
  lock : Option Lock := none
  nextRun : Nat := 0
  a : Own := {}
  b : Own := {}
  deriving DecidableEq, Hashable, Repr

inductive Ev
  | acquire (r : R) | beat (r : R) | release (r : R) | recover (r : R)
  | shutdown (r : R) | restart (r : R) | tick (dt : Nat)
  deriving Repr

def staleAfter : Nat := 180

/-- どの lock とも一致しない計画停止の印を残しておく秒数。 -/
def markerRetention : Nat := 3600

def other : R → R
  | .A => .B
  | .B => .A

def ownOf (s : St) : R → Own
  | .A => s.a
  | .B => s.b

def setOwn (s : St) (r : R) (o : Own) : St :=
  match r with
  | .A => { s with a := o }
  | .B => { s with b := o }

/-- heartbeat が期限を超えて古い。ちょうど `staleAfter` 秒はまだ有効。 -/
abbrev stale (s : St) (l : Lock) : Prop := s.clock - l.hb > staleAfter

/-- `r` の今の process 自身の lock か。 -/
abbrev mine (s : St) (r : R) (l : Lock) : Prop := l.owner = r ∧ l.inst = (ownOf s r).inst

/-- owner が新しい lock を取ってよい状態か（停止の印がなく、状態が active）。 -/
abbrev accepting (o : Own) : Prop := o.marker = none ∧ o.status = .active

def grant (s : St) (r : R) : St :=
  let o := ownOf s r
  setOwn { s with lock := some ⟨r, o.stInst, s.nextRun, s.clock⟩, nextRun := s.nextRun + 1 } r
    { o with held := o.held ++ [s.nextRun] }

/-- 期限切れの lock を片付ける。自分の今の process の lock は片付けない。 -/
def sweep (s : St) (r : R) : St :=
  match s.lock with
  | some l => if stale s l then { s with lock := none } else s
  | none => s

/-- owner `o` の印が保存期限を超えて古い。 -/
abbrev markerExpired (clock : Nat) (o : Own) : Prop := clock - o.markAt > markerRetention

/-- owner `o` の計画停止の印を処理する。印と同じ owner・世代の lock は期限を待たず回収し、
回収したとき（または `retireEmpty` のとき、印が保存期限を超えたとき）は owner を terminated にして印を消す。 -/
def recoverMarker (s : St) (o : R) (retireEmpty : Bool) : St :=
  match (ownOf s o).marker with
  | none => s
  | some j =>
    match s.lock with
    | some l =>
      if l.owner = o ∧ l.inst = j then
        let s1 := { s with lock := none }
        if (ownOf s o).stInst = j then
          setOwn s1 o { ownOf s o with status := .terminated, marker := none, markAt := 0 }
        else s1
      else if (retireEmpty ∨ markerExpired s.clock (ownOf s o)) ∧ (ownOf s o).stInst = j then
        setOwn s o { ownOf s o with status := .terminated, marker := none, markAt := 0 }
      else s
    | none =>
      if (retireEmpty ∨ markerExpired s.clock (ownOf s o)) ∧ (ownOf s o).stInst = j then
        setOwn s o { ownOf s o with status := .terminated, marker := none, markAt := 0 }
      else s

/-- 仕様: 1 操作の後の状態。 -/
def step (s : St) : Ev → St
  | .tick dt => { s with clock := s.clock + dt }
  | .acquire r =>
    if accepting (ownOf s r) then
      match s.lock with
      | none => grant s r
      | some l => if stale s l ∧ ¬ mine s r l then grant s r else s
    else s
  | .beat r =>
    -- 手元の全ての実行が 1 回ずつ heartbeat する。lock と一致する実行だけが時刻を更新する。
    match s.lock with
    | some l =>
      if mine s r l ∧ l.run ∈ (ownOf s r).held then { s with lock := some { l with hb := s.clock } }
      else s
    | none => s
  | .release r =>
    -- 手元で最も古い実行が終わる。lock がその実行のものなら消す。
    match (ownOf s r).held with
    | [] => s
    | n :: rest =>
      let s1 := match s.lock with
        | some l => if mine s r l ∧ l.run = n then { s with lock := none } else s
        | none => s
      setOwn s1 r { ownOf s r with held := rest }
  | .recover r => sweep (recoverMarker s (other r) false) r
  | .shutdown r =>
    let o := ownOf s r
    setOwn s r { o with status := .terminating, marker := some o.stInst, markAt := s.clock }
  | .restart r =>
    -- 古い process は消え、新しい世代が「回収してから active にする」順で起動する。
    let o := ownOf s r
    let s0 := setOwn s r { o with inst := o.inst + 1, held := [] }
    let s1 := if o.marker = some (o.inst + 1) then s0 else recoverMarker s0 r true
    let s2 := sweep (recoverMarker s1 (other r) false) r
    setOwn s2 r { ownOf s2 r with stInst := o.inst + 1, status := .active }

/-! ## 証明（モデルについて、全ての状態で成り立つ）

番号は README.md の「規則」の番号。`unfold_model` は定義を展開するだけで、残りは `grind` が閉じる。 -/

macro "unfold_model" : tactic =>
  `(tactic| simp only [step, sweep, recoverMarker, grant, ownOf, setOwn, other] at *)

/-- 規則 1: 期限内で、持ち主に計画停止の印がない lock は、誰の取得・回収・再起動でも変わらない。 -/
theorem fresh_unmarked_lock_survives (s : St) (r : R) (l : Lock)
    (h : s.lock = some l) (hf : ¬ stale s l)
    (hm : (ownOf s l.owner).marker ≠ some l.inst) :
    (step s (.acquire r)).lock = some l ∧ (step s (.recover r)).lock = some l
      ∧ (step s (.restart r)).lock = some l := by
  obtain ⟨clock, lock, nextRun, a, b⟩ := s
  obtain ⟨o, i, n, hb⟩ := l
  simp only at h
  subst h
  refine ⟨?_, ?_, ?_⟩ <;> cases r <;> cases o <;> unfold_model <;> grind

/-- 規則 2: heartbeat が書き換えるのは、その process の手元にある実行の lock だけ。 -/
theorem beat_changes_only_own_run (s : St) (r : R) (l : Lock) (h : s.lock = some l)
    (hn : ¬ (mine s r l ∧ l.run ∈ (ownOf s r).held)) :
    (step s (.beat r)).lock = some l := by
  obtain ⟨clock, lock, nextRun, a, b⟩ := s
  simp only at h
  subst h
  cases r <;> unfold_model <;> grind

/-- 規則 3: 解放が消すのは、終わる実行（手元で最も古い実行）自身の lock だけ。 -/
theorem release_removes_only_own_run (s : St) (r : R) (l : Lock) (h : s.lock = some l)
    (hn : ¬ (mine s r l ∧ (ownOf s r).held.head? = some l.run)) :
    (step s (.release r)).lock = some l := by
  obtain ⟨clock, lock, nextRun, a, b⟩ := s
  simp only at h
  subst h
  cases r <;> unfold_model <;> grind

/-- 規則 4: 停止を始めた owner（印がある、または状態が active でない）の取得は何も変えない。 -/
theorem stopping_owner_cannot_acquire (s : St) (r : R) (h : ¬ accepting (ownOf s r)) :
    step s (.acquire r) = s := by
  cases r <;> unfold_model <;> grind

/-- 規則 5: 自分の今の process の lock は、期限切れでも自分の取得・回収では奪わない。 -/
theorem own_lock_not_reclaimed_by_self (s : St) (r : R) (l : Lock)
    (h : s.lock = some l) (hm : mine s r l) :
    (step s (.acquire r)).lock = some l ∧ (step s (.recover r)).lock = some l := by
  obtain ⟨clock, lock, nextRun, ⟨ai, ah, asi, ast, am, amt⟩, ⟨bi, bh, bsi, bst, bm, bmt⟩⟩ := s
  obtain ⟨o, i, n, hb⟩ := l
  simp only at h
  subst h
  refine ⟨?_, ?_⟩ <;> cases r <;> cases o <;> cases am <;> cases bm <;> unfold_model <;> grind [ownOf]

/-- 規則 6: 持ち主の計画停止の印と世代が一致する lock は、期限を待たずに、
他の owner の回収・他の owner の再起動・持ち主自身の再起動のどれでも回収される。 -/
theorem marked_lock_recovered (s : St) (l : Lock) (h : s.lock = some l)
    (hm : (ownOf s l.owner).marker = some l.inst) (hi : l.inst ≤ (ownOf s l.owner).inst) :
    (step s (.recover (other l.owner))).lock = none
      ∧ (step s (.restart (other l.owner))).lock = none
      ∧ (step s (.restart l.owner)).lock = none := by
  obtain ⟨clock, lock, nextRun, a, b⟩ := s
  obtain ⟨o, i, n, hb⟩ := l
  simp only at h
  subst h
  refine ⟨?_, ?_, ?_⟩ <;> cases o <;> unfold_model <;> grind

/-- owner 1 つ分の不変条件: 状態ファイルの世代は今の process の世代で、
印があればその世代を指し、印がある間は active でない。 -/
def OwnOk (o : Own) : Prop :=
  o.stInst = o.inst ∧ ∀ j, o.marker = some j → j = o.stInst ∧ o.status ≠ .active

/-- 全体の不変条件。 -/
def Good (s : St) : Prop :=
  OwnOk s.a ∧ OwnOk s.b
    ∧ (∀ l, s.lock = some l → l.inst ≤ (ownOf s l.owner).inst ∧ l.run < s.nextRun ∧ l.hb ≤ s.clock)
    ∧ (∀ r n, n ∈ (ownOf s r).held → n < s.nextRun)

/-- 初期状態から操作を何回でも、どんな順でも行って届く状態。 -/
inductive Reachable : St → Prop
  | init : Reachable {}
  | step (s : St) (e : Ev) : Reachable s → Reachable (step s e)

theorem good_init : Good {} := by
  refine ⟨?_, ?_, ?_, ?_⟩ <;> simp [OwnOk]
  intro r; cases r <;> simp [ownOf]

/-- 1 つの操作について「不変条件が残る」を示す: lock の有無と持ち主で分け、定義を展開して閉じる。 -/
macro "good_one" : tactic =>
  `(tactic| (
    intro s h
    obtain ⟨clock, lock, nextRun, ⟨ai, ah, asi, ast, am, amt⟩, ⟨bi, bh, bsi, bst, bm, bmt⟩⟩ := s
    obtain ⟨ha, hb, hl, hh⟩ := h
    have hhA := hh .A
    have hhB := hh .B
    clear hh
    simp only [OwnOk, ownOf] at ha hb hl hhA hhB
    cases am <;> cases bm <;> cases lock with
    | none =>
      refine ⟨?_, ?_, ?_, ?_⟩ <;> (try (intro r'; cases r')) <;>
        (try simp only [OwnOk]) <;> (try unfold_model) <;> grind (splits := 20)
    | some l =>
      obtain ⟨o, i, n, t⟩ := l
      have hl' := hl _ rfl
      clear hl
      cases o <;> simp only at hl' <;>
        refine ⟨?_, ?_, ?_, ?_⟩ <;> (try (intro r'; cases r')) <;>
        (try simp only [OwnOk]) <;> (try unfold_model) <;> grind (splits := 20)))

theorem good_tick (dt : Nat) : ∀ s, Good s → Good (step s (.tick dt)) := by good_one
theorem good_acquire (r : R) : ∀ s, Good s → Good (step s (.acquire r)) := by cases r <;> good_one
theorem good_beat (r : R) : ∀ s, Good s → Good (step s (.beat r)) := by cases r <;> good_one
theorem good_release (r : R) : ∀ s, Good s → Good (step s (.release r)) := by cases r <;> good_one
theorem good_recover (r : R) : ∀ s, Good s → Good (step s (.recover r)) := by cases r <;> good_one
theorem good_shutdown (r : R) : ∀ s, Good s → Good (step s (.shutdown r)) := by cases r <;> good_one
set_option maxHeartbeats 1000000 in
theorem good_restart (r : R) : ∀ s, Good s → Good (step s (.restart r)) := by cases r <;> good_one

theorem good_step (s : St) (e : Ev) (h : Good s) : Good (step s e) := by
  cases e with
  | tick dt => exact good_tick dt s h
  | acquire r => exact good_acquire r s h
  | beat r => exact good_beat r s h
  | release r => exact good_release r s h
  | recover r => exact good_recover r s h
  | shutdown r => exact good_shutdown r s h
  | restart r => exact good_restart r s h

/-- 規則 7: 不変条件は、どんな操作順・どんな長さでも成り立つ。 -/
theorem good_reachable (s : St) (h : Reachable s) : Good s := by
  induction h with
  | init => exact good_init
  | step s e _ ih => exact good_step s e ih

/-- 規則 8: 再起動した owner は必ず lock を取れる状態（印なし・active）に戻る。 -/
theorem restart_resumes (s : St) (r : R) (h : Good s) :
    accepting (ownOf (step s (.restart r)) r) := by
  obtain ⟨clock, lock, nextRun, a, b⟩ := s
  obtain ⟨ha, hb, -, -⟩ := h
  simp only [OwnOk] at ha hb
  cases r <;> unfold_model <;> grind

/-- 規則 9: 保存期限を超えた計画停止の印は、一致する lock がなければ、他の owner の回収で片付き、
印の owner は terminated になる。 -/
theorem expired_marker_retired (s : St) (o : R) (j : Nat)
    (hm : (ownOf s o).marker = some j) (hs : (ownOf s o).stInst = j) (he : markerExpired s.clock (ownOf s o))
    (hl : ∀ l, s.lock = some l → ¬ (l.owner = o ∧ l.inst = j)) :
    (ownOf (step s (.recover (other o))) o).marker = none
      ∧ (ownOf (step s (.recover (other o))) o).status = .terminated := by
  obtain ⟨clock, lock, nextRun, a, b⟩ := s
  cases lock with
  | none => cases o <;> unfold_model <;> grind
  | some l =>
    have hl := hl l rfl
    obtain ⟨lo, i, n, t⟩ := l
    cases o <;> cases lo <;> unfold_model <;> grind

/-! ## テストケースの機械生成 -/

def evs : List Ev :=
  [.acquire .A, .acquire .B, .beat .A, .beat .B, .release .A, .release .B,
   .recover .A, .recover .B, .shutdown .A, .shutdown .B, .restart .A, .restart .B,
   .tick 90, .tick 91, .tick 3601]

def rs : R → String
  | .A => "A"
  | .B => "B"

def evs2s : Ev → String
  | .acquire r => "a" ++ rs r
  | .beat r => "b" ++ rs r
  | .release r => "r" ++ rs r
  | .recover r => "c" ++ rs r
  | .shutdown r => "s" ++ rs r
  | .restart r => "R" ++ rs r
  | .tick dt => "t" ++ toString dt

def obsOwn (o : Own) : String :=
  let st := match o.status with
    | .active => "a"
    | .terminating => "t"
    | .terminated => "x"
  let m := match o.marker with
    | none => "-"
    | some j => "m" ++ toString j
  let h := if o.held.isEmpty then "-" else "+".intercalate (o.held.map toString)
  s!"{o.stInst}{st}{m}{h}"

/-- 操作が返す結果: 取得できた・heartbeat を更新した・自分の lock を消した、なら 1。 -/
def result (s : St) : Ev → Nat
  | .acquire r => if (step s (.acquire r)).nextRun = s.nextRun then 0 else 1
  | .beat r =>
    match s.lock with
    | some l => if mine s r l ∧ l.run ∈ (ownOf s r).held then 1 else 0
    | none => 0
  | .release r =>
    match s.lock with
    | some l => if mine s r l ∧ (ownOf s r).held.head? = some l.run then 1 else 0
    | none => 0
  | _ => 0

/-- 1 操作の後に実装から読めるものの全部: 操作の結果、lock ファイル、
owner ごとの状態ファイル・停止の印・手元の実行。 -/
def obs (s : St) (e : Ev) : String :=
  let s' := step s e
  let l := match s'.lock with
    | none => "-"
    | some l => s!"{rs l.owner}{l.inst}.{l.run}.{l.hb}"
  s!"{result s e};{l};{obsOwn s'.a};{obsOwn s'.b}"

/-- 手順（新しい操作が先頭）を `操作列|各操作後の期待` の 1 行にする。 -/
def line (revPath : List Ev) : String :=
  let t := revPath.reverse
  let (_, os) := t.foldl (fun (s, os) e => (step s e, obs s e :: os)) (({} : St), [])
  ",".intercalate (t.map evs2s) ++ "|" ++ ",".intercalate os.reverse

/-- 決めた深さまでの全手順（比較用。数が多いのでコミットしない）。 -/
def full : Nat → List (List Ev)
  | 0 => [[]]
  | n + 1 => (full n).flatMap fun t => evs.map fun e => e :: t

/-- 初期状態から `depth - 1` 手以内で届く全ての状態について、そこからの全操作を 1 回ずつ通る手順の集合
（手順は最長 `depth` 手。`depth` 手目で初めて届く状態は、届くところまでで、そこからは伸ばさない）。
同じ状態へは最短の手順 1 本だけを伸ばす。他の手順の先頭部分になる手順は出力しない。 -/
def cover (depth : Nat) : IO Unit := do
  let mut seen : Std.HashSet St := Std.HashSet.emptyWithCapacity.insert {}
  let mut frontier : List (St × List Ev) := [({}, [])]
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

def main (args : List String) : IO Unit := do
  match args with
  | ["cover", n] => cover n.toNat!
  | ["full", n] => for t in full n.toNat! do IO.println (line t)
  | _ => IO.eprintln "usage: lean --run LockModel.lean (cover|full) DEPTH"
