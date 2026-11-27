--------------------------- MODULE TaskRunnerLock ---------------------------
(***************************************************************************)
(* BOXP-732: Task Board runner の ticket lock を TLC で限定検証するモデル。   *)
(*                                                                         *)
(* 範囲: Runner 2 台 (A, B)・チケット 1 枚。lock は 1 ファイル。時刻は整数で *)
(* 1 ずつ進み、最後の heartbeat から StaleAfter を超えると期限切れ。        *)
(* TLA+ の交互実行では、ある Runner が手を出さない間は「止まっている」のと *)
(* 同じなので、JVM の一時停止・ネットワーク断・heartbeat thread の遅れは   *)
(* 「その Runner の操作が選ばれない」ことで表す。                          *)
(*                                                                         *)
(* 実装との対応 (docker/codex-workspace/task-board/task_board_runner.bb):   *)
(*   AcqCheck/AcqWrite  acquire-lock!      (GuardedAcquire=TRUE で 1 手)    *)
(*   HbStep/HbWrite     heartbeat-once!    (GuardedHeartbeat=TRUE で 1 手)  *)
(*   Recover            cleanup-stale-locks!                               *)
(*   Commit             run 終了時の lifecycle commit (lane/Notes/summary)  *)
(*   Release            release-lock! (delete-lock-if-matches!)            *)
(*   Abort              (実装になし) FenceCommit=TRUE のときだけ: 所有を失った *)
(*                      run は commit せずに終わる                          *)
(* 下の BOOLEAN 定数を FALSE/TRUE にすると、意図的に壊した版になる。        *)
(***************************************************************************)
EXTENDS Naturals, FiniteSets

CONSTANTS
    Runners,                 \* {A, B}
    NoOwner,                 \* lock がないことを表す model value
    StaleAfter,              \* CODEX_TASK_BOARD_LOCK_STALE_SECONDS に相当 (刻み数)
    MaxTime,                 \* 時計の上限 (状態を有限にするため)
    MaxGrants,               \* lock を付与する回数の上限 (同上)
    CheckOwnerOnHeartbeat,   \* heartbeat 前に same-ticket-lock? を見る
    CheckOwnerOnRelease,     \* 解放前に same-ticket-lock? を見る
    RequireStale,            \* 他 Runner の lock を奪う/消すのは期限切れのときだけ
    GuardedAcquire,          \* 取得の「確認→書き込み」を ticket guard 内で 1 手で行う
    GuardedHeartbeat,        \* heartbeat の「読む→書く」を ticket guard 内で 1 手で行う
    FenceCommit              \* commit 直前に guard 内で所有を確かめる (実装は FALSE)

VARIABLES
    now,      \* 現在時刻
    lock,     \* lock ファイルの中身 [owner, grant, hb]。owner = NoOwner ならファイルなし
    grants,   \* これまでに付与した lock の通し番号 (run-id に相当)
    st,       \* run の段階: "idle" | "acqRead" | "work" | "committed"
    held,     \* その Runner が持っているつもりの lock の通し番号 (0 = なし)
    hbSt,     \* heartbeat thread: "off" | "ready" | "read"
    commits,  \* 行われた commit の記録 {[r, grant, ok]} (検査用)
    actor,    \* 直前の操作をした者 (検査用。Runner か "clock")
    tookOver  \* 他 Runner の lock を取得・回収で奪ったことがあるか (検査用)

vars == <<now, lock, grants, st, held, hbSt, commits, actor, tookOver>>

NoLock == [owner |-> NoOwner, grant |-> 0, hb |-> 0]

Stale(l) == l.owner # NoOwner /\ now - l.hb > StaleAfter
Owns(r)  == lock.owner = r /\ lock.grant = held[r]

\* 他 Runner の lock を取得・回収で奪ってよいか (acquire-lock! / cleanup-stale-locks!)
MayTake(r, l) == l.owner # r /\ (Stale(l) \/ ~RequireStale)

TypeOK ==
    /\ now \in 0..MaxTime
    /\ grants \in 0..MaxGrants
    /\ lock.owner \in Runners \cup {NoOwner}
    /\ lock.grant \in 0..MaxGrants
    /\ lock.hb \in 0..now
    /\ st \in [Runners -> {"idle", "acqRead", "work", "committed"}]
    /\ held \in [Runners -> 0..MaxGrants]
    /\ hbSt \in [Runners -> {"off", "ready", "read"}]

Init ==
    /\ now = 0
    /\ lock = NoLock
    /\ grants = 0
    /\ st = [r \in Runners |-> "idle"]
    /\ held = [r \in Runners |-> 0]
    /\ hbSt = [r \in Runners |-> "off"]
    /\ commits = {}
    /\ actor = "clock"
    /\ tookOver = FALSE

NewLock(r) == [owner |-> r, grant |-> grants + 1, hb |-> now]

StartWork(r) ==
    /\ lock' = NewLock(r)
    /\ grants' = grants + 1
    /\ st' = [st EXCEPT ![r] = "work"]
    /\ held' = [held EXCEPT ![r] = grants + 1]
    /\ hbSt' = [hbSt EXCEPT ![r] = "ready"]
    /\ tookOver' = (tookOver \/ lock.owner \notin {NoOwner, r})

\* 取得。lock がない、または奪ってよい lock なら新しい lock を書く。
\* GuardedAcquire=FALSE では「確認」と「書き込み」の間に他の操作が入れる。
AcqCheck(r) ==
    /\ st[r] = "idle"
    /\ grants < MaxGrants
    /\ lock.owner = NoOwner \/ MayTake(r, lock)
    /\ actor' = r
    /\ IF GuardedAcquire
          THEN /\ StartWork(r)
               /\ UNCHANGED <<now, commits>>
          ELSE /\ st' = [st EXCEPT ![r] = "acqRead"]
               /\ UNCHANGED <<now, lock, grants, held, hbSt, commits, tookOver>>

AcqWrite(r) ==
    /\ st[r] = "acqRead"
    /\ grants < MaxGrants
    /\ actor' = r
    /\ StartWork(r)
    /\ UNCHANGED <<now, commits>>

\* heartbeat 1 回。所有が変わっていれば heartbeat thread を止める (heartbeat! の stop?)。
\* 実装では stop? は heartbeat を止めるだけで、run 本体 (st) は "work" のまま続く。
HbStep(r) ==
    /\ st[r] = "work"
    /\ hbSt[r] = "ready"
    /\ actor' = r
    /\ IF Owns(r) \/ (~CheckOwnerOnHeartbeat /\ lock.owner # NoOwner)
          THEN IF GuardedHeartbeat
                  THEN /\ lock' = [lock EXCEPT !.hb = now]
                       /\ UNCHANGED hbSt
                  ELSE /\ hbSt' = [hbSt EXCEPT ![r] = "read"]
                       /\ UNCHANGED lock
          ELSE /\ hbSt' = [hbSt EXCEPT ![r] = "off"]
               /\ UNCHANGED lock
    /\ UNCHANGED <<now, grants, st, held, commits, tookOver>>

\* GuardedHeartbeat=FALSE のときの書き込み: 読んだときの自分の lock に時刻を入れて書き戻す。
HbWrite(r) ==
    /\ hbSt[r] = "read"
    /\ actor' = r
    /\ lock' = [owner |-> r, grant |-> held[r], hb |-> now]
    /\ hbSt' = [hbSt EXCEPT ![r] = "ready"]
    /\ UNCHANGED <<now, grants, st, held, commits, tookOver>>

\* 他 Runner の期限切れ lock の回収 (tick 先頭の cleanup-stale-locks!)。
Recover(r) ==
    /\ lock.owner # NoOwner
    /\ MayTake(r, lock)
    /\ actor' = r
    /\ tookOver' = TRUE
    /\ lock' = NoLock
    /\ UNCHANGED <<now, grants, st, held, hbSt, commits>>

\* run の終わりの lifecycle commit (lane 移動・Notes・summary)。
\* 実装は所有を確かめずに行う。FenceCommit=TRUE なら所有しているときだけ。
Commit(r) ==
    /\ st[r] = "work"
    /\ FenceCommit => Owns(r)
    /\ actor' = r
    /\ commits' = commits \cup {[r |-> r, grant |-> held[r], ok |-> Owns(r), afterTakeover |-> tookOver]}
    /\ st' = [st EXCEPT ![r] = "committed"]
    /\ UNCHANGED <<now, lock, grants, held, hbSt, tookOver>>

\* FenceCommit=TRUE のときだけ: 所有を失った run は commit も解放もせずに終わる。
Abort(r) ==
    /\ FenceCommit
    /\ st[r] = "work"
    /\ ~Owns(r)
    /\ actor' = r
    /\ st' = [st EXCEPT ![r] = "idle"]
    /\ held' = [held EXCEPT ![r] = 0]
    /\ hbSt' = [hbSt EXCEPT ![r] = "off"]
    /\ UNCHANGED <<now, lock, grants, commits, tookOver>>

\* 解放 (release-lock!)。自分の lock のときだけ消す。
Release(r) ==
    /\ st[r] = "committed"
    /\ actor' = r
    /\ lock' = IF Owns(r) \/ ~CheckOwnerOnRelease THEN NoLock ELSE lock
    /\ st' = [st EXCEPT ![r] = "idle"]
    /\ held' = [held EXCEPT ![r] = 0]
    /\ hbSt' = [hbSt EXCEPT ![r] = "off"]
    /\ UNCHANGED <<now, grants, commits, tookOver>>

Tick ==
    /\ now < MaxTime
    /\ now' = now + 1
    /\ actor' = "clock"
    /\ UNCHANGED <<lock, grants, st, held, hbSt, commits, tookOver>>

Next ==
    \/ Tick
    \/ \E r \in Runners :
          AcqCheck(r) \/ AcqWrite(r) \/ HbStep(r) \/ HbWrite(r)
          \/ Recover(r) \/ Commit(r) \/ Abort(r) \/ Release(r)

Spec == Init /\ [][Next]_vars

-----------------------------------------------------------------------------
(* 検査する性質 *)

\* L1: 期限内の lock を、持ち主以外が書き換え・削除しない。期限切れの lock を
\*     持ち主以外が変えるときは、削除するか、自分の新しい lock にするだけ。
NoForeignDisplace ==
    [][ (lock # NoLock /\ lock' # lock /\ actor' # lock.owner)
          => /\ Stale(lock)
             /\ \/ lock' = NoLock
                \/ lock'.owner = actor' /\ lock'.grant > lock.grant ]_vars

\* L2: lock の heartbeat 時刻を進めるのは、その lock の持ち主だけ。
HeartbeatOnlyOwn ==
    [][ (lock # NoLock /\ lock'.grant = lock.grant /\ lock'.hb # lock.hb)
          => actor' = lock.owner ]_vars

\* L3: lock を持っているつもりで正しい Runner は高々 1 台 (lock が 1 ファイルなので
\*     成り立つはずの確認用)。
AtMostOneRightfulHolder ==
    Cardinality({r \in Runners : st[r] # "idle" /\ Owns(r)}) <= 1

\* C1: lifecycle commit をするのは、その時点で lock を持っている run だけ。
CommitOnlyByHolder == \A c \in commits : c.ok

\* C2: 同じチケットの run が 2 台で同時に進んでいない (agent の作業の重なりがない)。
\*     lease 方式の lock では期限切れ後の旧 Runner の作業を止められないので、
\*     FenceCommit=TRUE でも成り立たないはず (限界の確認)。
SingleWorker == Cardinality({r \in Runners : st[r] \in {"work", "committed"}}) <= 1

\* S1 (空回りの確認): 「期限切れの取り直しの後に、正しい持ち主が commit まで進む」ことは
\*    起きない、とわざと主張する。どの版でも違反 (= その並びに届く) になるのが期待値。
\*    ok になったら、モデルがそこまで届いておらず、他の ok も意味が薄い。
NoProgressAfterTakeover == ~\E c \in commits : c.ok /\ c.afterTakeover
=============================================================================
