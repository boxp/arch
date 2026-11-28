/-!
# コハコの家: 端末へ 1 タップで地図を開く試験の依頼のモデル (BOXP-752)

仕様（Obsidian の Projects/kohako-device-delegation/trial-spec.md「決まり」2・4・5・6）から起こした規則。実装の写しではない。
規則の日本語説明・実装との対応・省いたものは同じディレクトリの README.md にある。Lean 本体だけを使う。

- 証明の検査:       `lean DeviceTrialModel.lean`
- 操作の並びの生成: `lean --run DeviceTrialModel.lean > cases.txt`
-/

set_option linter.unusedVariables false

/-- 依頼 1 件の保存された状態。 -/
inductive St | pending | opened | expired | cancelled
  deriving DecidableEq, Repr

/-- 依頼 1 件。`late`: 期限（作ってから 2 分）を過ぎた。 -/
structure Req where
  st : St
  late : Bool
  deriving DecidableEq, Repr

/-- 全体。`stopped`: 停止スイッチ。`reqs`: 作った順の依頼（添字が依頼の番号）。 -/
structure W where
  stopped : Bool
  reqs : List Req
  deriving DecidableEq, Repr

/-- 操作。`restart` は BFF の再起動（保存された状態から作り直す）。 -/
inductive Ev
  | create
  | openR (i : Nat)
  | cancel (i : Nat)
  | stop
  | resume
  | tick
  | restart
  deriving DecidableEq, Repr

/-- 操作の結果。 -/
inductive Res | ok | stopped | exists_ | opened | expired | cancelled | none_
  deriving DecidableEq, Repr

/-- 決まり 5: 期限を過ぎた待ちは、見た時に期限切れになる。 -/
def expire (r : Req) : Req :=
  if r.st = .pending ∧ r.late = true then { r with st := .expired } else r

def norm (w : W) : W := { w with reqs := w.reqs.map expire }

/-- 決まり 6: 停止で待ちを取消にする。 -/
def cancelP (r : Req) : Req :=
  if r.st = .pending then { r with st := .cancelled } else r

def code : St → Res
  | .pending => .ok
  | .opened => .opened
  | .expired => .expired
  | .cancelled => .cancelled

/-- 待ちの依頼 i を `to` にする（決まり 4 の「開く」と、本人の「やめる」）。 -/
def settle (w : W) (i : Nat) (to : St) : W × Res :=
  let v := norm w
  match v.reqs[i]? with
  | none => (v, .none_)
  | some r =>
    if r.st = .pending then ({ v with reqs := v.reqs.set i { r with st := to } }, .ok)
    else (v, code r.st)

def step (w : W) : Ev → W × Res
  | .create =>
    let v := norm w
    if v.stopped then (v, .stopped)
    else if v.reqs.any (fun r => r.st = .pending) then (v, .exists_)
    else ({ v with reqs := v.reqs ++ [⟨.pending, false⟩] }, .ok)
  | .openR i => settle w i .opened
  | .cancel i => settle w i .cancelled
  | .stop => let v := norm w; ({ stopped := true, reqs := v.reqs.map cancelP }, .ok)
  | .resume => ({ w with stopped := false }, .ok)
  | .tick => ({ w with reqs := w.reqs.map (fun r => { r with late := true }) }, .ok)
  | .restart => (w, .ok)

def init : W := ⟨false, []⟩

def run (w : W) : List Ev → W
  | [] => w
  | e :: es => run (step w e).1 es

/-! ## 性質 -/

/-- 決まりの不変条件: 停止中は待ちが無く、待ちは高々 1 件。 -/
def Good (w : W) : Prop :=
  (w.stopped = true → ∀ r ∈ w.reqs, r.st ≠ .pending) ∧
    ∀ (i j : Nat) (a b : Req), w.reqs[i]? = some a → w.reqs[j]? = some b →
      a.st = .pending → b.st = .pending → i = j

theorem lt_of_get {l : List Req} {i : Nat} {a : Req} (h : l[i]? = some a) : i < l.length :=
  (List.getElem?_eq_some_iff.mp h).1

theorem get_append {l m : List Req} {i : Nat} {a : Req} (h : l[i]? = some a) : (l ++ m)[i]? = some a := by
  rw [List.getElem?_append_left (lt_of_get h)]; exact h

theorem get_set_self {l : List Req} {i : Nat} {a b : Req} (h : l[i]? = some a) : (l.set i b)[i]? = some b := by
  simp [lt_of_get h]

theorem expire_pending (r : Req) : (expire r).st = .pending → r.st = .pending := by
  unfold expire; split <;> simp_all

theorem cancelP_not_pending (r : Req) : (cancelP r).st ≠ .pending := by
  unfold cancelP; split <;> simp_all

/-- 終わった依頼（開いた・期限切れ・取消）は `expire` でも `cancelP` でも変わらない。 -/
theorem expire_final (r : Req) (h : r.st ≠ .pending) : (expire r).st = r.st := by
  unfold expire; split <;> simp_all

theorem cancelP_final (r : Req) (h : r.st ≠ .pending) : (cancelP r).st = r.st := by
  unfold cancelP; split <;> simp_all

theorem good_init : Good init := by
  unfold Good; simp [init]

theorem good_norm (w : W) (h : Good w) : Good (norm w) := by
  obtain ⟨h1, h2⟩ := h
  refine ⟨fun hs r hr => ?_, fun i j a b ha hb pa pb => ?_⟩
  · simp only [norm, List.mem_map] at hr
    obtain ⟨r0, hr0, rfl⟩ := hr
    exact fun hp => h1 hs r0 hr0 (expire_pending r0 hp)
  · simp only [norm, List.getElem?_map, Option.map_eq_some_iff] at ha hb
    obtain ⟨a0, ha0, rfl⟩ := ha
    obtain ⟨b0, hb0, rfl⟩ := hb
    exact h2 i j a0 b0 ha0 hb0 (expire_pending _ pa) (expire_pending _ pb)

theorem good_settle (w : W) (i : Nat) (to : St) (ht : to ≠ .pending) (h : Good w) :
    Good (settle w i to).1 := by
  have hn := good_norm w h
  unfold settle
  dsimp only
  generalize norm w = v at hn ⊢
  obtain ⟨h1, h2⟩ := hn
  split
  · exact ⟨h1, h2⟩
  · rename_i r hr
    split
    · rename_i hp
      refine ⟨fun hs x hx => ?_, fun a b x y hx hy px py => ?_⟩
      · exact absurd hp (h1 hs r (List.mem_of_getElem? hr))
      · simp only [List.getElem?_set] at hx hy
        split at hx <;> split at hy
        · omega
        · simp only [Option.ite_none_right_eq_some, Option.some.injEq] at hx
          obtain ⟨_, rfl⟩ := hx; exact absurd px ht
        · simp only [Option.ite_none_right_eq_some, Option.some.injEq] at hy
          obtain ⟨_, rfl⟩ := hy; exact absurd py ht
        · exact h2 a b x y (by simp_all) (by simp_all) px py
    · exact ⟨h1, h2⟩

/-- 規則（決まり 2・6）: どの操作の後も、停止中は待ちが無く、待ちは高々 1 件。 -/
theorem good_step (w : W) (e : Ev) (h : Good w) : Good (step w e).1 := by
  cases e with
  | create =>
    have hn := good_norm w h
    simp only [step]
    generalize norm w = v at hn
    split
    · exact hn
    · split
      · exact hn
      · rename_i hs hany
        obtain ⟨h1, h2⟩ := hn
        have hnone : ∀ r ∈ v.reqs, r.st ≠ .pending := by
          intro r hr hp; exact hany (List.any_eq_true.mpr ⟨r, hr, by simp [hp]⟩)
        refine ⟨fun hs' => absurd hs' hs, fun i j a b ha hb pa pb => ?_⟩
        simp only [List.getElem?_append, List.getElem?_singleton] at ha hb
        split at ha <;> split at hb
        · exact absurd pa (hnone a (List.mem_of_getElem? ha))
        · exact absurd pa (hnone a (List.mem_of_getElem? ha))
        · exact absurd pb (hnone b (List.mem_of_getElem? hb))
        · split at ha <;> split at hb <;> simp_all <;> omega
  | openR i => exact good_settle w i .opened (by decide) h
  | cancel i => exact good_settle w i .cancelled (by decide) h
  | stop =>
    refine ⟨fun _ r hr => ?_, fun i j a b ha hb pa _ => ?_⟩
    · simp only [step, List.mem_map] at hr
      obtain ⟨r0, _, rfl⟩ := hr
      exact cancelP_not_pending _
    · simp only [step, List.getElem?_map, Option.map_eq_some_iff] at ha
      obtain ⟨a0, _, rfl⟩ := ha
      exact absurd pa (cancelP_not_pending _)
  | resume =>
    obtain ⟨_, h2⟩ := h
    exact ⟨fun hs => by simp [step] at hs, h2⟩
  | tick =>
    obtain ⟨h1, h2⟩ := h
    refine ⟨fun hs r hr => ?_, fun i j a b ha hb pa pb => ?_⟩
    · simp only [step, List.mem_map] at hr hs
      obtain ⟨r0, hr0, rfl⟩ := hr
      exact h1 hs r0 hr0
    · simp only [step, List.getElem?_map, Option.map_eq_some_iff] at ha hb
      obtain ⟨a0, ha0, rfl⟩ := ha
      obtain ⟨b0, hb0, rfl⟩ := hb
      exact h2 i j a0 b0 ha0 hb0 pa pb
  | restart => exact h

theorem good_run (w : W) (es : List Ev) (h : Good w) : Good (run w es) := by
  induction es generalizing w with
  | nil => exact h
  | cons e es ih => exact ih _ (good_step w e h)

/-- 決まり 2: 停止中は依頼を作らない（並びも変えない、Push も送らない）。 -/
theorem create_stopped (w : W) (h : w.stopped = true) :
    (step w .create).2 = .stopped ∧ (step w .create).1.reqs.length = w.reqs.length := by
  simp [step, norm, h]

/-- 決まり 4: 「開く」が成功するのは、その依頼が待ちで期限内の時だけ。 -/
theorem open_ok (w : W) (i : Nat) :
    (step w (.openR i)).2 = .ok ↔ ∃ r, w.reqs[i]? = some r ∧ r.st = .pending ∧ r.late = false := by
  simp only [step, settle, norm, List.getElem?_map]
  cases hr : w.reqs[i]? with
  | none => simp
  | some r =>
    obtain ⟨st, late⟩ := r
    cases st <;> cases late <;> simp [expire, code]

/-- 決まり 4・5・6: 終わった依頼（開いた・期限切れ・取消）は、どの操作でも同じ状態のまま。 -/
theorem final_stays (w : W) (e : Ev) (i : Nat) (r : Req) (hr : w.reqs[i]? = some r)
    (hf : r.st ≠ .pending) : ∃ r', (step w e).1.reqs[i]? = some r' ∧ r'.st = r.st := by
  have hn : (norm w).reqs[i]? = some (expire r) := by simp [norm, hr]
  have he := expire_final r hf
  have hset : ∀ to, ∃ r', (settle w i to).1.reqs[i]? = some r' ∧ r'.st = r.st := by
    intro to
    simp only [settle, hn]
    have : (expire r).st ≠ .pending := by rw [he]; exact hf
    simp only [this, ite_false]
    exact ⟨_, hn, he⟩
  cases e with
  | create =>
    simp only [step]
    split
    · exact ⟨_, hn, he⟩
    · split
      · exact ⟨_, hn, he⟩
      · exact ⟨_, get_append hn, he⟩
  | openR j =>
    by_cases hij : j = i
    · subst hij; exact hset _
    · simp only [step, settle]
      split
      · exact ⟨_, hn, he⟩
      · split
        · exact ⟨_, by rw [List.getElem?_set_ne hij]; exact hn, he⟩
        · exact ⟨_, hn, he⟩
  | cancel j =>
    by_cases hij : j = i
    · subst hij; exact hset _
    · simp only [step, settle]
      split
      · exact ⟨_, hn, he⟩
      · split
        · exact ⟨_, by rw [List.getElem?_set_ne hij]; exact hn, he⟩
        · exact ⟨_, hn, he⟩
  | stop =>
    refine ⟨cancelP (expire r), by simp [step, norm, hr], ?_⟩
    rw [cancelP_final _ (by rw [he]; exact hf), he]
  | resume => exact ⟨r, by simp [step, hr], rfl⟩
  | tick => exact ⟨{ r with late := true }, by simp [step, hr], rfl⟩
  | restart => exact ⟨r, hr, rfl⟩

theorem final_stays_run (w : W) (es : List Ev) (i : Nat) (r : Req) (hr : w.reqs[i]? = some r)
    (hf : r.st ≠ .pending) : ∃ r', (run w es).reqs[i]? = some r' ∧ r'.st = r.st := by
  induction es generalizing w r with
  | nil => exact ⟨r, hr, rfl⟩
  | cons e es ih =>
    obtain ⟨r1, h1, s1⟩ := final_stays w e i r hr hf
    obtain ⟨r2, h2, s2⟩ := ih _ r1 h1 (by rw [s1]; exact hf)
    exact ⟨r2, h2, s2.trans s1⟩

/-- 決まり 4: 開いた後は、どんな操作の並びの後でも、同じ依頼をもう一度は開けない。 -/
theorem open_once (w : W) (i : Nat) (es : List Ev) (h : (step w (.openR i)).2 = .ok) :
    (step (run (step w (.openR i)).1 es) (.openR i)).2 ≠ .ok := by
  obtain ⟨r, hr, hp, hl⟩ := (open_ok w i).mp h
  have hopen : (step w (.openR i)).1.reqs[i]? = some { expire r with st := .opened } := by
    simp only [step, settle, norm, List.getElem?_map, hr, Option.map_some]
    have : (expire r).st = .pending := by simp [expire, hl, hp]
    simp only [this, ite_true]
    have hn : (List.map expire w.reqs)[i]? = some (expire r) := by simp [hr]
    exact get_set_self hn
  obtain ⟨r', h', s'⟩ := final_stays_run _ es i _ hopen (by simp)
  intro hok
  obtain ⟨r'', h'', p'', _⟩ := (open_ok _ i).mp hok
  rw [h'] at h''
  cases h''
  simp_all

/-- 期限を過ぎた印（`late`）は、どの操作でも消えない。 -/
theorem late_stays (w : W) (e : Ev) (i : Nat) (r : Req) (hr : w.reqs[i]? = some r)
    (hl : r.late = true) : ∃ r', (step w e).1.reqs[i]? = some r' ∧ r'.late = true := by
  have hn : (norm w).reqs[i]? = some (expire r) := by simp [norm, hr]
  have he : (expire r).late = true := by unfold expire; split <;> simp_all
  have hset : ∀ to, ∃ r', (settle w i to).1.reqs[i]? = some r' ∧ r'.late = true := by
    intro to
    simp only [settle, hn]
    split
    · exact ⟨_, get_set_self hn, he⟩
    · exact ⟨_, hn, he⟩
  cases e with
  | create =>
    simp only [step]
    split
    · exact ⟨_, hn, he⟩
    · split
      · exact ⟨_, hn, he⟩
      · exact ⟨_, get_append hn, he⟩
  | openR j | cancel j =>
    by_cases hij : j = i
    · subst hij; exact hset _
    · simp only [step, settle]
      split
      · exact ⟨_, hn, he⟩
      · split
        · exact ⟨_, by rw [List.getElem?_set_ne hij]; exact hn, he⟩
        · exact ⟨_, hn, he⟩
  | stop =>
    refine ⟨cancelP (expire r), by simp [step, norm, hr], ?_⟩
    unfold cancelP; split <;> simp_all
  | resume => exact ⟨r, by simp [step, hr], hl⟩
  | tick => exact ⟨{ r with late := true }, by simp [step, hr], rfl⟩
  | restart => exact ⟨r, hr, hl⟩

theorem late_stays_run (w : W) (es : List Ev) (i : Nat) (r : Req) (hr : w.reqs[i]? = some r)
    (hl : r.late = true) : ∃ r', (run w es).reqs[i]? = some r' ∧ r'.late = true := by
  induction es generalizing w r with
  | nil => exact ⟨r, hr, hl⟩
  | cons e es ih =>
    obtain ⟨r1, h1, l1⟩ := late_stays w e i r hr hl
    exact ih _ r1 h1 l1

/-- 決まり 5: 期限（tick）の時にあった依頼は、その後どの順で操作しても開けない。 -/
theorem late_never_opens (w : W) (i : Nat) (es : List Ev) (hi : i < w.reqs.length) :
    (step (run (step w .tick).1 es) (.openR i)).2 ≠ .ok := by
  have ht : (step w .tick).1.reqs[i]? = some { w.reqs[i] with late := true } := by
    simp [step, List.getElem?_map, List.getElem?_eq_getElem hi]
  obtain ⟨r', h', l'⟩ := late_stays_run _ es i _ ht rfl
  intro hok
  obtain ⟨r'', h'', _, l''⟩ := (open_ok _ i).mp hok
  rw [h'] at h''
  cases h''
  simp_all

/-! ## 操作の並び（実装照合用）: 依頼 0・1・2 を指す長さ 4 までの並びを全て出す -/

def events : List (String × Ev) :=
  [("C", .create), ("O0", .openR 0), ("O1", .openR 1), ("O2", .openR 2),
   ("X0", .cancel 0), ("X1", .cancel 1), ("X2", .cancel 2),
   ("S", .stop), ("U", .resume), ("T", .tick), ("R", .restart)]

def resName : Res → String
  | .ok => "ok" | .stopped => "stopped" | .exists_ => "exists" | .opened => "opened"
  | .expired => "expired" | .cancelled => "cancelled" | .none_ => "none"

def stName : St → String
  | .pending => "P" | .opened => "O" | .expired => "E" | .cancelled => "X"

def bit (b : Bool) : String := if b then "1" else "0"

/-- 1 行: 並び、各操作の結果、最後に見た時の停止と各依頼の状態（見た時の期限切れを反映）。 -/
def line (name res : String) (w : W) : String :=
  let v := norm w
  let sts := String.join (v.reqs.map (fun r => stName r.st))
  s!"{name} {res} {bit v.stopped} {if sts.isEmpty then "-" else sts}"

partial def walk (depth : Nat) (name res : String) (w : W) : IO Unit := do
  if depth = 0 then return
  for (n, e) in events do
    let (w', r) := step w e
    let name' := if name.isEmpty then n else s!"{name}.{n}"
    let res' := if res.isEmpty then resName r else s!"{res}.{resName r}"
    IO.println (line name' res' w')
    walk (depth - 1) name' res' w'

def main : IO Unit := walk 4 "" "" init
