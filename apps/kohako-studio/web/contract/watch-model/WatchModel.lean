/-!
# コハコの家: 画面を一緒に見て呼びかけに返事する試作の状態のモデル (BOXP-779)

仕様（Obsidian の Projects/kohako-home/watch-together-spec.md「決まり」1・3・5・7・8 と状態遷移）から起こした規則。
実装の写しではない。日本語の説明・実装との対応・省いたものは同じディレクトリの README.md にある。Lean 本体だけを使う。

- 証明の検査:       `lean WatchModel.lean`
- 操作の並びの生成: `lean --run WatchModel.lean > cases.txt`
-/

set_option linter.unusedVariables false

/-- 状態。 -/
inductive Ph | off | starting | watching | transcribing | asking | replying
  deriving DecidableEq, Repr

/-- 認識結果の中身。`yes` = 呼びかけあり、`busy` = 呼びかけありだが通常会話の応答待ち、`no` = 呼びかけ無し。 -/
inductive Heard | yes | busy | no
  deriving DecidableEq, Repr

/-- 出来事。`fresh = false` は、止める前の回が始めた処理の遅れた結果。 -/
inductive Ev
  | start                       -- 本人が「一緒に見る」
  | stop                        -- やめる・共有停止・マイク終了
  | utter                       -- 発話が区切れた
  | ready (fresh : Bool)        -- 画面とマイクが取れた
  | fail (fresh : Bool)         -- 取得・認識・送信の失敗
  | heard (fresh : Bool) (h : Heard)
  | replied (fresh : Bool)      -- 呼びかけへの返事が届いた
  | spoken (fresh : Bool)       -- 読み上げが終わった
  deriving DecidableEq, Repr

/-- 出来事に対して画面がすること。 -/
inductive Eff | none | acquire | release | transcribe | discard | send | busy | error | speak
  deriving DecidableEq, Repr

def step : Ph → Ev → Ph × Eff
  | .off, .start => (.starting, .acquire)
  | .off, .stop => (.off, .none)
  | _, .stop => (.off, .release)
  | .watching, .utter => (.transcribing, .transcribe)
  | .starting, .ready true => (.watching, .none)
  | .starting, .fail true => (.off, .release)
  | .transcribing, .fail true => (.watching, .error)
  | .asking, .fail true => (.watching, .error)
  | .transcribing, .heard true .yes => (.asking, .send)
  | .transcribing, .heard true .busy => (.watching, .busy)
  | .transcribing, .heard true .no => (.watching, .discard)
  | .asking, .replied true => (.replying, .speak)
  | .replying, .spoken true => (.watching, .none)
  | s, _ => (s, .none)

def run (s : Ph) : List Ev → Ph
  | [] => s
  | e :: es => run (step s e).1 es

/-- 並びの各出来事で画面がしたこと。 -/
def effects (s : Ph) : List Ev → List Eff
  | [] => []
  | e :: es => (step s e).2 :: effects (step s e).1 es

def isStart : Ev → Bool
  | .start => true
  | _ => false

/-! ## 定理 -/

/-- 決まり 3・5: 送る（画面 1 枚と認識文）のは、聞き取り中に今の回の「呼びかけあり」が届いた時だけ。 -/
theorem send_only_on_call (s : Ph) (e : Ev) (h : (step s e).2 = .send) :
    s = .transcribing ∧ e = .heard true .yes := by
  cases s <;> cases e <;> simp_all [step] <;> (try split at h) <;> simp_all

/-- 決まり 3: 呼びかけの無い認識結果・遅れた結果では送らない。 -/
theorem no_call_no_send (s : Ph) (f : Bool) (h : Heard) (hh : h ≠ .yes) :
    (step s (.heard f h)).2 ≠ .send := by
  intro hs
  exact hh ((Ev.heard.inj (send_only_on_call s _ hs).2).2)

/-- 決まり 7: 読み上げるのは送った呼びかけの返事を待っている時だけ。 -/
theorem speak_only_when_asking (s : Ph) (e : Ev) (h : (step s e).2 = .speak) :
    s = .asking ∧ e = .replied true := by
  cases s <;> cases e <;> simp_all [step] <;> (try split at h) <;> simp_all

/-- 決まり 7: 返事待ち（asking）へ入るのは送った時だけ。 -/
theorem asking_by_send (s : Ph) (e : Ev) (hs : s ≠ .asking) (h : (step s e).1 = .asking) :
    (step s e).2 = .send := by
  cases s <;> cases e <;> simp_all [step] <;> (try split at h) <;> simp_all

/-- 決まり 7: 返事待ち・返事中は、どの出来事でも新しく送らない（二重に送らない）。 -/
theorem no_send_while_busy (s : Ph) (e : Ev) (hs : s = .asking ∨ s = .replying) :
    (step s e).2 ≠ .send := by
  intro h
  have := (send_only_on_call s e h).1
  rcases hs with rfl | rfl <;> cases this

/-- 決まり 3: 認識へ送るのは待機中に発話が区切れた時だけ（認識は同時に 1 件）。 -/
theorem transcribe_only_watching (s : Ph) (e : Ev) (h : (step s e).2 = .transcribe) :
    s = .watching ∧ e = .utter := by
  cases s <;> cases e <;> simp_all [step] <;> (try split at h) <;> simp_all

/-- 決まり 8: どの状態からでも、止めると off になる。動いていた時は取得を手放す。 -/
theorem stop_always (s : Ph) : (step s .stop).1 = .off := by
  cases s <;> rfl

theorem stop_releases (s : Ph) (hs : s ≠ .off) : (step s .stop).2 = .release := by
  cases s <;> simp_all [step]

/-- 決まり 8: 遅れた結果（止める前の回のもの）では何も変わらず、何もしない。 -/
theorem stale_ignored (s : Ph) :
    step s (.ready false) = (s, .none) ∧ step s (.fail false) = (s, .none) ∧
    (∀ h, step s (.heard false h) = (s, .none)) ∧ step s (.replied false) = (s, .none) ∧
    step s (.spoken false) = (s, .none) := by
  refine ⟨?_, ?_, ?_, ?_, ?_⟩ <;> (try intro h) <;> cases s <;> (try cases h) <;> rfl

/-- 決まり 1・8: off では「一緒に見る」以外のどの出来事でも off のまま何もしない。 -/
theorem off_silent (e : Ev) (he : isStart e = false) : step .off e = (.off, .none) := by
  cases e <;> simp_all [isStart, step] <;> (try split) <;> rfl

/-- 決まり 8: 止めた後は、本人が再び始めるまで、どんな並びでも off のまま、取得・認識・送信・読み上げをしない。 -/
theorem stopped_stays_silent (s : Ph) (es : List Ev) (hes : es.all (fun e => !isStart e) = true) :
    run (step s .stop).1 es = .off ∧ (effects (step s .stop).1 es).all (· = .none) = true := by
  rw [stop_always]
  induction es with
  | nil => simp [run, effects]
  | cons e es ih =>
    simp only [List.all_cons, Bool.and_eq_true, Bool.not_eq_true'] at hes
    obtain ⟨h1, h2⟩ := hes
    have := off_silent e h1
    simp only [run, effects, this, List.all_cons, decide_true, Bool.true_and]
    exact ih h2

/-- 決まり 1: 取得を求めるのは off で本人が始めた時だけ。 -/
theorem acquire_only_on_start (s : Ph) (e : Ev) (h : (step s e).2 = .acquire) :
    s = .off ∧ e = .start := by
  cases s <;> cases e <;> simp_all [step] <;> (try split at h) <;> simp_all

/-! ## 操作の並び（実装照合用）: 長さ 4 までの並びを全て出す -/

def events : List (String × Ev) :=
  [("S", .start), ("X", .stop), ("U", .utter), ("R", .ready true), ("F", .fail true),
   ("Y", .heard true .yes), ("B", .heard true .busy), ("N", .heard true .no),
   ("A", .replied true), ("D", .spoken true), ("y", .heard false .yes), ("a", .replied false)]

def phName : Ph → String
  | .off => "off" | .starting => "starting" | .watching => "watching"
  | .transcribing => "transcribing" | .asking => "asking" | .replying => "replying"

def effName : Eff → String
  | .none => "none" | .acquire => "acquire" | .release => "release" | .transcribe => "transcribe"
  | .discard => "discard" | .send => "send" | .busy => "busy" | .error => "error" | .speak => "speak"

/-- 1 行: 並び、各出来事で画面がしたこと、最後の状態。 -/
partial def walk (depth : Nat) (name res : String) (s : Ph) : IO Unit := do
  if depth = 0 then return
  for (n, e) in events do
    let (s', r) := step s e
    let name' := if name.isEmpty then n else s!"{name}.{n}"
    let res' := if res.isEmpty then effName r else s!"{res}.{effName r}"
    IO.println s!"{name'} {res'} {phName s'}"
    walk (depth - 1) name' res' s'

def main : IO Unit := walk 4 "" "" .off
