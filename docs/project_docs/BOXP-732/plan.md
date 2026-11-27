# BOXP-732: Task Runner のロックと停止・再開を TLA+ / TLC で限定検証する

前段: [BOXP-650](../BOXP-650/plan.md)（Lean のモデルと再生テスト。今回の比較の基準）

## 結論

- Runner 2 台・チケット 1 枚の ticket lock を TLA+ で書き、TLC で **全ての交互実行** を調べた（7 版 × 6 性質 = 42 検査）。
  結果は、**TLC を動かす前に書いた期待値と small・large の 2 つの大きさで全て一致**した。
- **Lean・既存テストになかった知見が 2 つ**:
  1. **lock を失った旧 Runner が、そのまま run の終了処理（lane 移動・Notes・summary）をする**。TLC が 7 手の反例を出し、
     隔離環境の実 runner でも再現した（旧 Runner A が、lock が Runner B のものになった後にカードを Done へ移し、
     Notes に「finished with result done」を書いた）。heartbeat は所有の変化に気づくが、止めるのは heartbeat だけ。
  2. **`with-ticket-lock-guard` を `heartbeat-once!` か `acquire-lock!` から外しても、Lean の再生テスト（24,207 本）は検出しない**
     （不一致 0）。TLC は 2 つとも反例を出す。Lean のモデルは操作を 1 つずつ一瞬で行うので、guard が要る場面がそもそも作れない。
- lock の規則そのもの（期限内の lock を他人が消さない・heartbeat は持ち主だけ・正しく持っているのは 1 台）は、
  **実装どおりの版で全て成り立った**（large で 146,769 状態を全探索）。壊した 5 版は全て反例が出た。
- 1 の直し方（commit 直前に guard 内で所有を確かめる）は `fenced` 版としてモデル上で確かめただけで、**実装は変えていない**。
  直すかどうか、agent の作業の重なり（下の C2）をどう扱うかは Owner の別判断。

## 何をどこまでやったか

| 置いたもの | 中身 |
|---|---|
| `tests/codex-workspace/tla-lock-model/TaskRunnerLock.tla` | モデルと性質（219 行）。BOOLEAN 定数 6 個で版を切り替える |
| `tests/codex-workspace/tla-lock-model/run-tlc.sh` | 版 × 性質を TLC にかけ `expected.tsv` と比べる。tla2tools.jar v1.7.4 を sha256 固定 |
| `tests/codex-workspace/tla-lock-model/expected.tsv` | 期待値 42 件。モデルと実装を読んで、TLC を動かす前に書いた |
| `tests/codex-workspace/tla-lock-model/repro-stale-runner-commit.sh` | 知見 1 を実 runner で再現する観察用スクリプト（一時ディレクトリだけを使う） |
| `tests/codex-workspace/tla-lock-model/README.md` | 版・性質・結果・扱わないもの・再現手順 |

- runner の実装、既存のテスト、CI（workflow・必須 check）は **変えていない**。TLC はどの workflow からも呼ばない。
- 本番の runner・実チケット・実 lock には触れていない。不良版・変異版は run workspace のコピーと一時ディレクトリだけで動かした。
- 仕様の変更はない（lock の規則の正本は `lock-model/README.md` の規則表のまま）。今回は検証だけで新しい振る舞いを足していないので、
  仕様 → モデル → テスト → 実装の順序のうち「実装」は対象外。知見 1 を直すなら、先に規則表へ「所有を失った run は終了処理をしない」を足すところから始める。

## 版と結果

`○` = 実装と同じ、`×` = 意図的に壊した所。

| 版 | heartbeat 所有確認 | 解放 所有確認 | 奪うのは期限切れだけ | 取得 guard | heartbeat guard | commit 前の所有確認 | L1 | L2 | L3 | C1 | C2 | S1 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `impl` | ○ | ○ | ○ | ○ | ○ | ×（実装もなし） | ok | ok | ok | **違反** | 違反 | 違反 |
| `fenced` | ○ | ○ | ○ | ○ | ○ | ○（案） | ok | ok | ok | ok | 違反 | 違反 |
| `bad-hb-owner` | × | ○ | ○ | ○ | ○ | × | 違反 | 違反 | ok | 違反 | 違反 | 違反 |
| `bad-release-owner` | ○ | × | ○ | ○ | ○ | × | 違反 | ok | ok | 違反 | 違反 | 違反 |
| `bad-take-fresh` | ○ | ○ | × | ○ | ○ | × | 違反 | ok | ok | 違反 | 違反 | 違反 |
| `bad-acquire-unguarded` | ○ | ○ | ○ | × | ○ | × | 違反 | ok | ok | 違反 | 違反 | 違反 |
| `bad-hb-unguarded` | ○ | ○ | ○ | ○ | × | × | 違反 | ok | ok | 違反 | 違反 | 違反 |

- L1 `NoForeignDisplace`: 期限内の lock を持ち主以外が書き換え・削除しない（期限切れなら削除か自分の新しい lock だけ）
- L2 `HeartbeatOnlyOwn`: heartbeat 時刻を進めるのは持ち主だけ
- L3 `AtMostOneRightfulHolder`: 正しく持っている Runner は高々 1 台
- C1 `CommitOnlyByHolder`: 終了処理をするのは、その時点で lock を持っている run だけ
- C2 `SingleWorker`: 同じチケットの run が 2 台で同時に進んでいない
- S1 `NoProgressAfterTakeover`: 空回りの確認（わざと偽の主張。全ての版で違反 = 取り直し後に正しい持ち主が commit まで届く）

### 反例（small、TLC の最短）

| 版・性質 | 並び |
|---|---|
| `impl` C1 | A 取得 → 時計 ×3（A の heartbeat が止まって期限切れ）→ B が取り直す → **A が commit** |
| `bad-hb-owner` L2 | A 取得 → 時計 ×3 → B 取り直す → 時計 → **A の heartbeat が B の lock の時刻を進める** |
| `bad-release-owner` L1 | A 取得 → 時計 ×3 → A commit → B 取り直す → **A の解放が B の lock を消す** |
| `bad-take-fresh` L1 | A 取得 → **B が期限内の lock を奪う** |
| `bad-acquire-unguarded` L1 | A 確認（lock なし）→ B 確認（lock なし）→ A 書く → **B が A の lock を上書き** |
| `bad-hb-unguarded` L1 | A 取得 → 時計 ×3 → A heartbeat の読み（自分の lock）→ B 取り直す → **A が古い自分の lock を書き戻して B の lock を消す** |
| `fenced` C2 | A 取得 → 時計 ×3 → B 取り直す（A はまだ作業中） |

全文は `/home/boxp/verification-artifacts/BOXP-732/tlc-small/`・`tlc-large/`（`<版>.<性質>.out`）。

## Lean のモデル・既存テストとの比較

| 欠陥（TLA+ の版） | TLC | Lean の定理 | Lean の再生テスト（実装へ） | 既存 e2e（lock 関連 10 ケース） |
|---|---|---|---|---|
| heartbeat の所有確認なし | 反例 | 規則 2 `beat_changes_only_own_run` が対応 | 対応する関数の変異を検出（BOXP-650: `heartbeat-once!` の変異 3 件中 3 件。式の置き換えで、所有確認を丸ごと外す変異ではない） | 同 3 件中 2 件（BOXP-650 の 18 ケース） |
| 解放の所有確認なし | 反例 | 規則 3 `release_removes_only_own_run` | 対応する関数の変異を検出（BOXP-650: `delete-lock-if-matches-under-guard!` 2 件中 2 件、`same-ticket-lock?` 5 件中 5 件） | 一部（`test_cross_process_lock_guard_preserves_replacement_lock` は回収側の削除） |
| 期限内の lock を奪う | 反例 | 規則 1 `fresh_unmarked_lock_survives` | 対応する関数の変異を検出（BOXP-650: `cleanup-stale-locks!` 7 件中 6 件など） | `test_mismatched_shutdown_marker_does_not_recover_fresh_lock` ほか |
| 取得の guard なし | 反例 | 表せない（操作が一瞬） | **見逃し**（24,207 本・不一致 0） | **見逃し**（評価できた 8 ケース全て pass。1 件の失敗は再実行 2 回とも pass で偶発） |
| heartbeat の guard なし | 反例 | 表せない | **見逃し**（24,207 本・不一致 0） | **見逃し**（評価できた 8 ケース全て pass） |
| 所有を失った run の終了処理（実装の挙動） | 反例 | モデルに run 本体がない | 対象外 | なし（`repro-stale-runner-commit.sh` で再現） |

- 「所有確認」系の 3 つは Lean の規則と 1 対 1 で、Lean 側でも見つかる。TLA+ が足したのは **割り込み（guard の必要性）** と **run 本体**。
- 逆に、計画停止の印・再起動・owner の状態（Lean の規則 4・6〜9）と、自分の lock を自分で奪わない規則（規則 5）は TLA+ のモデルにない。
  置き換えではなく、違う所を見る上乗せ。
- 「見逃し」の 2 行は、実装の `heartbeat-once!` / `acquire-lock!` から `with-ticket-lock-guard` を外したコピーに、
  Lean の再生テストと lock 関連 e2e を流して測った（差分は `/home/boxp/verification-artifacts/BOXP-732/lean-replay/`）。

## 知見 1 の再現（実装）

`repro-stale-runner-commit.sh`: 一時ディレクトリの vault・root で runner の `tick` を 1 回動かし、偽の codex が作業している間に、
実装と同じ ticket guard（FileLock）を取って lock を Runner B の新しい lock に置き換える。結果:

- lock は B のまま（A の `release-lock!` は所有を確かめるので消さない。L1 が実装で成り立つことの例）
- A の run の summary は `:status :succeeded` `:result "done"`、カードは `status::done`、Notes に A の「finished with result done」

単純化: B の取り直しは `acquire-lock!` を通さず lock ファイルを直接書いた（`close-stale-lock!` が A の run を interrupted にする処理は通らない）。
実際の運用で起きるには、A の heartbeat が 180 秒止まる（JVM や Pod の一時停止、PVC への書き込みの遅れ）必要がある。
普段は Pod が 1 つずつ入れ替わり計画停止の印で引き継ぐので、起きる頻度は未確認。

直し方の候補（**未実施**、Owner の判断が要る）:
- 終了処理の lifecycle commit の先頭で、ticket guard の中で `same-ticket-lock?` を確かめ、違えば何も書かずに終える（モデルの `fenced`）。
  TLC 上は C1 が成り立つ。
- それでも C2（agent の作業の重なり）は残る。agent が PR を push する・vault を書くのは lock の外なので、lease 方式の lock では止められない。
  heartbeat が所有の変化に気づいたら agent を止める、などは別の設計が要る。

## 検査範囲と前提

- Runner 2 台、チケット 1 枚、lock の付与は最大 3 回（large は 4 回）、時計は 0〜7（large は 0〜10）、期限は 2 刻み（large は 3）。
  この範囲の **全ての交互実行** を TLC が調べ終えている（small で正しい版 16,667〜25,360 状態、large で 91,587〜146,769 状態）。
- guard 内の処理は 1 手で、guard は本当に排他になると仮定している（JVM 内 `locking` と PVC 上の `FileLock` の正しさは見ていない）。
- モデルの操作と実装の関数の対応は人が読んで決めた。Lean の再生テストのような自動照合はない。
- 活性（いつか必ず取れる）は見ていない。

## 保守負担（実測）

| 項目 | 値 |
|---|---|
| 道具 | JRE（Temurin 21、展開後 約 150MB）＋ tla2tools.jar 4.5MB。Lean（約 3GB）より小さい |
| モデル | 219 行（Lean の lock モデルは 394 行）。生成物はない（期待値 42 行だけ） |
| 1 回の検査 | small 約 45 秒、large 約 2 分 40 秒（2CPU） |
| 最初のモデル化と初回の反例 | 実装を読み終えてから約 15 分 |
| 変更 1 回 | 検査用の変数（`tookOver`）を足し、期待値・性質・全版の再検査まで約 5 分 |

- 期待値を TLC の出力から写さない決まりは `expected.tsv` で守れるが、モデルと実装の対応がずれても自動では気づけない。
  実装を変えた PR で TLA+ のモデルを直す仕組みはない（必須 CI にしていないため）。
- 必須 CI にする、他の箇所へ広げる、知見 1 を直す、はどれも本票の範囲外。

## 計測結果の置き場所

`/home/boxp/verification-artifacts/BOXP-732/`（vault の外）: `tlc-small/`・`tlc-large/`（TLC の全出力と結果表）、
`repro/output.txt`（知見 1 の再現）、`lean-replay/`（guard を外した差分と再生結果）、`e2e/`（lock 関連 e2e の結果）。

### lock 関連 e2e の測り方

`task-board-runner-cases.txt` のうち lock・計画停止を扱う 10 ケースを、原本と guard を外した 2 版の隔離コピー
（`docker/codex-workspace` と `tests/codex-workspace` のコピー）で 1 件ずつ動かした。2 ケースは原本でも失敗したので除外した:
`test_planned_shutdown_lock_recovers_immediately`（5 秒以内の時間判定。負荷平均 7.5 の環境で 11〜13 秒）と
`test_cross_vault_lock_isolation`（コピーに `docker/hermes-agent` が無い）。
残り 8 ケースは 2 版とも pass。`acq-unguarded` で 1 回だけ落ちた `test_sigterm_stops_in_flight_agent_and_keeps_lock_for_next_owner` は、
再実行 2 回とも pass（原本も 2 回 pass）なので偶発と判断した。
