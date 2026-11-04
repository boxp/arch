# BOXP-404 技術基準

基準は main d9918e319。単一 `test` ジョブ、タイムアウト 20 分。直近完了 run の全体 17分22秒〜19分37秒、runner 8分03秒〜8分37秒、localllm-docs 5分29秒〜6分33秒、novel-runner 2分26秒〜2分47秒（チケット記載の GitHub 実測）。ローカル測定と GitHub 上の時間は比較対象を区別する。

14 コマンド: delegation、task-board-runner、task-board-events、ai-ops-ledger、ai-subscription-usage、BOXP-360 tools、localllm-docs、localllm-source-check、novel_board_runner、novel-board-runner、recurring-events、autonomy-policy、autonomy-control、vault-writer。runner は元のトップレベル呼出し 127 件と qwen-eval unittest を含む。元の呼出し順は `tests/codex-workspace/task-board-runner-cases.txt` に保存。変更前の Git 版から抽出した一覧と完全一致を確認した。

ケースは主に `mktemp -d` で個別の vault、state、fake executable を持つ。shard は別 GitHub runner で実行し、プロセス・ポート・ファイル・lock を共有しない。競合試験自体の並列プロセスはそのまま維持。SIGTERM の 2 秒 grace、lock 回復やポーリングは検証対象なので変更しない。ケースごとの経過秒を出力する。qwen-eval は shard 0 で 1 回実行する。

GitHub rules API の main 必須 check は `status-check`（ruleset 2 件）。既存 `test` 名も維持。matrix の結果は全子ジョブが成功した場合のみ success となり、集約では success のみ受理する。既存の paths、read 権限、固定 checkout、secret 非使用を維持。画像 workflow は `docker/codex-workspace/**` 等を対象とし、本変更のファイルは一致しない。PR 14459 は AI Ops の変更中であり、その runtime source は変更しない。

## ローカル検証（2026-11-04）

`env -i PATH="$PATH" HOME="$HOME"` で同時に 4 グループを実行。残り 12 suite は 242 秒、localllm-docs は 771 秒、runner shard 1 は 449 秒で成功。shard 0 は 366 秒で既存の shutdown finalize 待機時間検査が失敗（`early=true`）。該当ケース単独では 24 秒で成功し、shard 0 の全体再実行も 445 秒で成功した。再実行した shard 0 と初回 shard 1 の成功ログの `CASE` を一覧と多重集合で照合し、127 ケース各 1 回、qwen-eval 1 回を確認。shard 0 は 64 ケース＋qwen、shard 1 は 63 ケース。再実行は初回の失敗を取り消す証拠ではなく、並列負荷と時間依存の不安定性は GitHub 上で複数回検証が必要。

ローカル遅いケースの例: shard 0 の Review 廃止契約 40 秒、reasoning routing 35 秒、複数 PR の budget 24 秒、shard 1 の budget 境界 52 秒。ローカルは共有マシンであり GitHub Actions の短縮時間として扱わない。ログは作業時 `/tmp/boxp404-clean/` に保存。initial の AI Ops suite は実サービス環境変数の継承で失敗したため、環境を消去して実行し直した。通常の GitHub CI、main 実行、queue 時間、消費 runner 時間と複数回の安定性は未測定。
