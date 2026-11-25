/-!
# コハコの家: モデルの試行の記録の小さなモデル (BOXP-706)

仕様（Obsidian の Projects/kohako-home/model-trial-spec.md「記録と決まり」）から起こした規則。実装の写しではない。
規則の日本語説明・実装との対応・省いたものは同じディレクトリの README.md にある。Lean 本体だけを使う。

- 証明の検査:       `lean ModelTrialModel.lean`
- 出来事の並びの生成: `lean --run ModelTrialModel.lean > cases.txt`
-/

set_option linter.unusedSimpArgs false
set_option linter.unusedVariables false

/-- 指定を付けた発言の結果。 -/
inductive Outcome | failed | done | cancelled | unknown
  deriving DecidableEq, Repr

/-- 保存する記録（`model-trial.json`）。終了の理由は省き、終了しているかだけを持つ。 -/
structure Rec where
  turns : Nat
  streak : Nat
  infl : Option Nat
  ended : Bool
  deriving DecidableEq, Repr

/-- 続けて失敗した回数の上限。 -/
def limit : Nat := 2

/-- 発言を送る時の決まり。次の記録と、指定を付けるか。 -/
def planTake (max : Nat) (late : Bool) (r : Rec) (id : Nat) : Rec × Bool :=
  if r.ended then (r, false)
  else if late then ({ r with ended := true }, false)
  else if r.turns ≥ max then ({ r with ended := true }, false)
  else if r.streak ≥ limit then ({ r with ended := true }, false)
  else ({ turns := r.turns + 1, streak := r.streak + 1, infl := some id,
          ended := decide (r.turns + 1 ≥ max) }, true)

/-- 結果が分かった時の決まり。`carried`: この発言は再起動をまたいだ。 -/
def planSettle (carried : Bool) (r : Rec) (id : Nat) (o : Outcome) : Rec :=
  if r.infl ≠ some id then r
  else match o, carried with
    | .failed, _ => { r with infl := none, ended := r.ended || decide (r.streak ≥ limit) }
    | .unknown, true => { r with infl := none, ended := r.ended || decide (r.streak ≥ limit) }
    | .done, false => { r with infl := none, streak := 0 }
    | _, _ => { r with infl := none, streak := r.streak - 1 }

/--
全体の状態。`disk` が保存された記録。メモリの記録は、いつも `disk` と同じ（書けた時だけ反映する）。
`routed`・`real`・`known` は実際に起きたことの記録で、決まりは見ない（性質を述べるためだけに持つ）。
-/
structure World where
  disk : Rec
  /-- `disk.infl` の発言は再起動をまたいだ。 -/
  carried : Bool
  /-- 会話が結果を待っている発言。 -/
  pending : Option Nat
  /-- 次の発言の番号。 -/
  next : Nat
  /-- 指定を付けて送った run の数。 -/
  routed : Nat
  /-- 実際に続けて失敗した回数（分かった結果だけから数える）。 -/
  real : Nat
  /-- `disk.infl` の発言について、すでに分かった結果。 -/
  known : Option Outcome
  deriving Repr

def init : World :=
  { disk := { turns := 0, streak := 0, infl := none, ended := false },
    carried := false, pending := none, next := 0, routed := 0, real := 0, known := none }

inductive Event
  /-- 発言を送る。`late`: 期限を過ぎている。`ok`: 書き込みが成功する。 -/
  | take (late ok : Bool)
  /-- 会話が待っている発言の結果が分かる。 -/
  | settle (o : Outcome) (ok : Bool)
  /-- BFF が再起動する。`tracked`: 最後の発言を会話が追跡し直す。 -/
  | restart (tracked : Bool)
  deriving Repr

/-- 計算した次の記録を書く。書けなければ、記録は（メモリの上でも）前のまま。 -/
def commit (w : World) (n : Rec) (ok : Bool) : Rec :=
  if ok then n else w.disk

/-- この出来事で指定を付けるか。 -/
def routes (max : Nat) (w : World) : Event → Bool
  | .take late ok => ok && (planTake max late w.disk w.next).2
  | _ => false

/-- 分かった結果を、実際に続けて失敗した回数へ反映する。 -/
def reveal (real : Nat) : Outcome → Nat
  | .failed => real + 1
  | .done => 0
  | _ => real

def step (max : Nat) (w : World) : Event → World
  | .take late ok =>
    let p := planTake max late w.disk w.next
    let sent := ok && p.2
    { w with disk := commit w p.1 ok, pending := some w.next, next := w.next + 1,
             carried := if sent then false else w.carried,
             routed := if sent then w.routed + 1 else w.routed,
             known := if sent then none else w.known }
  | .settle o ok =>
    match w.pending with
    | none => w
    | some id =>
      -- 結果は、この発言が `disk.infl` で、まだ分かっていない時にだけ「分かる」。
      let fresh := decide (w.disk.infl = some id) && w.known.isNone
      { w with disk := commit w (planSettle w.carried w.disk id o) ok, pending := none,
               real := if fresh then reveal w.real o else w.real,
               known := if fresh then some o else w.known }
  | .restart tracked =>
    { w with carried := w.disk.infl.isSome,
             pending := if tracked then (if w.next = 0 then none else some (w.next - 1)) else none }

/--
前提: 同じ発言の結果は、何度確かめても同じ。ただし再起動をまたいだ後は不明に変わりうる。
（`disk.infl` の発言の結果がすでに分かっている時だけの制約。）
-/
def legal (w : World) : Event → Prop
  | .settle o _ =>
    ∀ id t, w.pending = some id → w.disk.infl = some id → w.known = some t →
      o = t ∨ (w.carried = true ∧ o = .unknown)
  | _ => True

/-- 先に足した 1 が、まだ実際の失敗として使われていない。 -/
def credit (infl : Option Nat) (known : Option Outcome) : Nat :=
  if infl.isSome ∧ known ≠ some .failed then 1 else 0

/-- どの並びでも保たれること。 -/
structure Safe (max : Nat) (w : World) : Prop where
  /-- 指定を付けた run の数は、保存された回数を超えない。 -/
  routed_le : w.routed ≤ w.disk.turns
  /-- 保存された回数は上限を超えない。 -/
  turns_le : w.disk.turns ≤ max
  /-- 保存された失敗の回数は、実際に続けて失敗した回数より少なくならない。 -/
  streak_ge : w.real + credit w.disk.infl w.known ≤ w.disk.streak
  /-- 成功と分かった発言が残っている間、実際の失敗の回数は 0。 -/
  done_zero : w.disk.infl.isSome → w.known = some .done → w.real = 0

theorem safe_init (max : Nat) : Safe max init := by
  constructor <;> simp [init, credit]

/-! ## 性質 -/

/-- 規則 1: 指定を付けるのは、終了しておらず、回数が残り、書き込みが成功した時だけ。 -/
theorem route_needs (max : Nat) (w : World) (e : Event) (h : routes max w e = true) :
    w.disk.ended = false ∧ w.disk.turns < max ∧ w.disk.streak < limit ∧
      ∃ late, e = .take late true := by
  cases e with
  | take late ok =>
    simp only [routes, planTake] at h
    cases hd : w.disk.ended <;> cases late <;> cases ok <;>
      simp [hd] at h
    by_cases h1 : w.disk.turns ≥ max <;> simp [h1] at h
    by_cases h2 : w.disk.streak ≥ limit <;> simp [h2] at h
    exact ⟨rfl, by omega, by omega, false, rfl⟩
  | settle o ok => simp [routes] at h
  | restart t => simp [routes] at h

theorem planTake_ended (max : Nat) (late : Bool) (r : Rec) (id : Nat) (h : r.ended = true) :
    (planTake max late r id).1.ended = true := by
  simp [planTake, h]

theorem planSettle_ended (c : Bool) (r : Rec) (id : Nat) (o : Outcome) (h : r.ended = true) :
    (planSettle c r id o).ended = true := by
  unfold planSettle
  split
  · exact h
  · split <;> simp [h]

theorem commit_ended (w : World) (n : Rec) (ok : Bool) (h : w.disk.ended = true)
    (hn : n.ended = true) : (commit w n ok).ended = true := by
  unfold commit
  split
  · exact hn
  · exact h

/-- 規則 2: 保存された終了は戻らない。 -/
theorem ended_stays (max : Nat) (w : World) (e : Event) (h : w.disk.ended = true) :
    (step max w e).disk.ended = true := by
  cases e with
  | take late ok => exact commit_ended w _ ok h (planTake_ended max late _ _ h)
  | settle o ok =>
    simp only [step]
    split
    · exact h
    · exact commit_ended w _ ok h (planSettle_ended _ _ _ _ h)
  | restart t => simpa [step] using h

/-- 規則 4: 指定を付ける時、実際に続けて失敗した回数は上限（2）未満。 -/
theorem route_real_lt (max : Nat) (w : World) (e : Event) (hi : Safe max w)
    (h : routes max w e = true) : w.real < limit := by
  have := (route_needs max w e h).2.2.1
  have := hi.streak_ge
  omega

/-- 規則 5: 指定を付けた run の数は上限を超えない。 -/
theorem routed_le_max (max : Nat) (w : World) (hi : Safe max w) : w.routed ≤ max :=
  Nat.le_trans hi.routed_le hi.turns_le

/-- 規則 3: 決まりは、どの出来事でも保たれる（前提 `legal` の下で）。 -/
theorem safe_step (max : Nat) (w : World) (e : Event) (hl : legal w e) (hi : Safe max w) :
    Safe max (step max w e) := by
  obtain ⟨h1, h2, h3, h4⟩ := hi
  obtain ⟨⟨turns, streak, infl, ended⟩, carried, pending, next, routed, real, known⟩ := w
  simp only at h1 h2 h3 h4
  cases e with
  | restart t => exact ⟨h1, h2, h3, h4⟩
  | take late ok =>
    simp only [step, planTake, commit]
    cases ok <;> cases late <;> cases ended <;>
      simp only [Bool.or_false, Bool.or_true, Bool.false_or, Bool.true_or, Bool.false_and,
        Bool.true_and, Bool.and_false, Bool.and_true, ite_true, ite_false] <;>
      (try (by_cases ht : turns ≥ max <;> by_cases hs : streak ≥ limit <;> simp only [ht, hs, ite_true, ite_false])) <;>
      (constructor <;> simp_all [credit] <;> (try split) <;> omega)
  | settle o ok =>
    simp only [step]
    cases pending with
    | none => exact ⟨h1, h2, h3, h4⟩
    | some id =>
      simp only [planSettle, commit]
      by_cases hin : infl = some id
      · subst hin
        cases known with
        | none =>
          cases o <;> cases ok <;> cases carried <;> cases ended <;>
            (constructor <;> simp_all [credit, reveal] <;> (try split) <;> (try simp_all) <;> omega)
        | some t =>
          have hk := hl id t rfl rfl rfl
          cases o <;> cases t <;> cases ok <;> cases carried <;> cases ended <;>
            simp at hk <;>
            (constructor <;> simp_all [credit, reveal] <;> (try split) <;> (try simp_all) <;> omega)
      · cases ok <;> cases ended <;>
          (constructor <;> simp_all [credit, reveal])

/--
規則 6: 再起動は、保存された記録も、次の発言に指定を付けるかも変えない。
（書き込みの失敗の後に落ちても、落ちなかった時と同じ。メモリだけにある終了は無い。）
-/
theorem restart_same (max : Nat) (w : World) (t late ok : Bool) :
    (step max w (.restart t)).disk = w.disk ∧
      routes max (step max w (.restart t)) (.take late ok) = routes max w (.take late ok) := by
  simp [step, routes]

/-- 規則 7: 書き込みに失敗した出来事は、保存された記録を変えず、指定も付けない。 -/
theorem failed_write_same (max : Nat) (w : World) :
    (∀ late, (step max w (.take late false)).disk = w.disk ∧ routes max w (.take late false) = false) ∧
      (∀ o, (step max w (.settle o false)).disk = w.disk) := by
  refine ⟨fun late => by simp [step, routes, commit], fun o => ?_⟩
  simp only [step]
  split <;> simp [commit]

/-! ## 出来事の並び（実装照合用）: 上限 3 回で長さ 5 まで、上限 1 回で長さ 4 までの並びを全て出す -/

def events : List (String × Event) :=
  [("T", .take false true), ("Tx", .take false false), ("Tl", .take true true),
   ("F", .settle .failed true), ("D", .settle .done true), ("C", .settle .cancelled true),
   ("U", .settle .unknown true), ("Fx", .settle .failed false), ("Dx", .settle .done false),
   ("R", .restart true), ("L", .restart false)]

/-- 並びに入れる出来事: 発言は待っている発言が無い時だけ、結果は待っている発言がある時だけ（`legal` も満たす）。 -/
def allowed (w : World) : Event → Bool
  | .take _ _ => w.pending.isNone
  | .settle o _ =>
    match w.pending with
    | none => false
    | some id =>
      match w.known with
      | some t => decide (w.disk.infl ≠ some id) || decide (o = t) || (w.carried && decide (o = .unknown))
      | none => true
  | .restart tracked => !tracked || decide (w.next ≠ 0)

def bit (b : Bool) : String := if b then "1" else "0"

/-- 1 行: 上限、並び、最後の出来事で指定を付けたか、保存された turns・streak・inflight・終了。 -/
def line (max : Nat) (name : String) (routed : Bool) (w : World) : String :=
  let infl := match w.disk.infl with | some id => toString id | none => "-"
  s!"{max} {name} {bit routed} {w.disk.turns} {w.disk.streak} {infl} {bit w.disk.ended}"

partial def walk (max depth : Nat) (name : String) (w : World) : IO Unit := do
  if depth = 0 then return
  for (n, e) in events do
    if allowed w e then
      let name' := if name.isEmpty then n else s!"{name}.{n}"
      let w' := step max w e
      IO.println (line max name' (routes max w e) w')
      walk max (depth - 1) name' w'

def main : IO Unit := do
  walk 3 5 "" init
  walk 1 4 "" init
