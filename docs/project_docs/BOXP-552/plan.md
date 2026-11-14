# BOXP-552: 衝突リスクの記録のみモードと検証README票別化

元設計: vault `Projects/task-board-conflict-aware-scheduling/design.md`（BOXP-550）。Owner は「A: 記録のみモード＋共有 README の票別分割」を選択。

## 変えないもの

- 票の起動候補・lock・PR ゲートの判定・レーン遷移・merge・継続/失敗予算・並列上限。
- 既存 run の停止や再 queue はしない。制御（L2/L3）の導入は別承認。

## 1. 記録のみモード（`docker/codex-workspace/task-board/task_board_conflict.bb`）

記録先: `<CODEX_TASK_BOARD_ROOT>/conflict-observe/events.jsonl`（追記のみ、`conflict-observe/v1`）。

| 段階 | いつ | 何を記録するか |
|---|---|---|
| pre（着手前） | runner が run を開始した直後 | 票の repo、本文に書かれたキー、既知の集中領域の語から求めた領域キー。本文そのものは保存しない |
| declared（調査後） | 担当が `declare` を実行したとき（任意、プロンプトで1行案内） | 担当が宣言した領域キー |
| pr（PR後） | PR ゲートを評価した直後 | PR の実際の変更ファイル、そこから求めたキー、ゲートの成否と失敗したゲート名 |

領域キー: `code:<repo>:<dir>` / `spec:<名前>` / `deploy:<配備対象>` / `res:<資源>`。`code` 同士は同じ repo でパスが前方一致すれば重なりとみなす。

runner 側の差し込みは3か所だけで、いずれも例外・タイムアウトをログに出して握りつぶす。PR 情報の取得は 30 秒で打ち切り、別スレッドで行うのでゲートや遷移を待たせない。`CODEX_TASK_BOARD_CONFLICT_OBSERVE=off` で記録と案内を止められる（既定は記録する。lolice 側の設定変更は不要）。

### 評価（`report`）

同じ時期に開いていた票の組について、段階ごとに次を出す。

- 当たり: merge 衝突ゲートの失敗を、その段階のキーの重なりで予測できていたか。
- 見逃し: 実際に同じファイルを触って衝突したのに、キーでは重ならなかった件数。
- 無駄な直列化: キーは重なったが、実際の変更ファイルは重ならなかった組の割合。
- 仮の待ち: 予測で重なった組を直列にしていたら後発の票が待った時間（上限の見積り）。領域キー別にも出す。
- 宣言の当たり外れ: PR の変更ファイルのうち宣言したキーに含まれる割合、触られなかった宣言キー。

## 2. `apps/kohako-studio/verify/home/README.md` の票別分割

- README には共通の実行手順と「説明は `docs/<script名>.md` に書き、README へ追記しない」という決まりだけを残す。一覧は持たない（一覧も追記の競合源になるため）。
- 各検証スクリプトの説明は `docs/<script名>.md` へ原文のまま移す。
- `check-docs.sh` で、スクリプトと説明ファイルの対応と README の行数上限を確かめる。

## 3. 配備と観測

1. 通常の CI・codex review を通して merge。codex-workspace イメージの自動更新で反映される（lolice の変更なし）。
2. 配備後、実際の run で `events.jsonl` に pre / pr の記録が増えることを確認する。
3. 実記録の開始日時を基点に **約3日後** の初回評価を Codex Cron の単発ジョブとして実予約し、読み戻して票へ記録する（Owner 指示 TD-01。当初の1〜2週間を置き換え）。
4. 初回評価では、3日で分かったことと、件数不足で未確定のことを分けて報告する。期間が過ぎただけで成功とはしない。

## 取り消し方

- 記録を止める: `CODEX_TASK_BOARD_CONFLICT_OBSERVE=off`。
- 完全に戻す: この PR を revert（記録ファイルは残しても runner の動作に影響しない）。
