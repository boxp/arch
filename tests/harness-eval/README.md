# harness-eval: ハーネス劣化の対照評価（固定課題群）

定義版 `harness-eval/v1-draft`（設計は Obsidian `Projects/ai-operations-observability/redesign.md` 第 3 章、実施票 BOXP-405）。
同じモデル revision・同じ固定課題・同じ安全条件のもとで、必要最小限の prompt（arm A）と現行ハーネスの契約文（arm B）を比べ、ハーネスがモデルの能力を制限していないかを metadata だけで測る。
評価器本体は `docker/codex-workspace/task-board/harness_eval.bb`。

## 配置

- 固定課題の置き場は `docker/codex-workspace/task-board/harness-eval-tasks/`（image に同梱するため docker build context の中に置く）。以下の `tasks/` はこの場所を指す。
- `tasks/Txx/task.edn` — `:id :title :difficulty :requirement :acceptance :allowed-files`。公開・非機密の小課題のみ。
- `tasks/Txx/base/` — 課題の初期状態（自己完結。arch 本体に依存しない）。受入が使うテストも同梱する。
- `tasks/Txx/solution/` — 許可ファイルだけの正解版。偽エージェントの `solve` が使う。
- `tasks/Txx/accept.sh <trial-dir>` — 独立受入。試行ディレクトリ内のファイルとテストだけを見る（exit 0 = 合格）。許可外の変更検査は評価器が `git status` で行う。
- `fake_agent.bb` — CI 用の偽エージェント。`HARNESS_EVAL_FAKE_MODE`（solve / noop / break / sleep / garbage / error）と `HARNESS_EVAL_FAKE_ARM_B_MODE` で劣化あり/なしを再現する。
- `test_harness_eval.bb` — fixture テスト（CI の remaining suite）。

## 課題の追加

1. `tasks/Tnn/` に `task.edn` / `base/` / `solution/` / `accept.sh` を置く（base は 6 ファイル程度まで）。
2. `accept.sh` が pristine な `base/` では失敗し、`solution/` を重ねると成功することを確認する。
3. 秘密・個人情報・実 URL を含めない。課題数は予算上限（10）以内。

## 注意

CI は偽エージェントだけを使い、実モデルを呼ばない。実モデルでの初回評価（≤ 60 試行、既存 subscription 内）は Owner の別判断。

既に `budget.edn` か試行記録がある `--out` への `plan` は拒否します。中断した計画の再開は同じ `--out` への `run` で行い、新しい計画には新しい `--out` を使ってください。
