# BOXP-349 検証記録

2026-10-28 UTC。本run専用arch/lolice worktreeを使用。loliceは読取だけで差分なし。

- 指定 `delegate.py run` はterraで成功。`delegate.py verify` exit 0。状態機械/初期7負例試験を委譲、親が実装を読んで統合し追加transport/6試験と途中取消の復帰試験を実装した。
- `python3 -B -m unittest discover -s tests/qwen-eval -v`: 41件成功。実画像なし、テストは合成/fake API。既存ハーネスと新規試験のSQLite接続にResourceWarningが出るが、試験失敗はない。
- `actionlint .github/workflows/test-codex-task-board-runner.yml`: 成功（既存cacheのactionlintを使用）。`ghalint run`: 成功。
- `git diff --check`: 成功。
- `trivy config --skip-check-update .`: 全体検査完了、既存Dockerfile指摘等が残る。未配備の新権限案についてKSV-0049(MEDIUM: ConfigMap patch権限)も検出。これは必要な受付専用nameへのpatchで、Owner判断対象として残す。抑制は追加していない。更新を省略したcache/embedded checksの検査であり、最新checksの検査成功とは主張しない。
- `codex review -c model=\"gpt-6.1-terra\" --uncommitted`: 独立レビュー実施。CI内のqwen試験未実行というP2指摘は、既存 `tests/codex-workspace/task-board-runner-test.sh` 末尾のdiscover呼出しにより実行されるため不採用。今回の変更はworkflowのpath filterを追加し、qwen変更でも当該runner全体を起動するもの。独立レビューのP1（Qwen開始前の取消で復帰phaseへ入れない）は修正し、fence/stop-gemma後の取消からverify/probeを経てのみreopenできる試験を追加。追加のP2（restore後再起動時のprobe再実行、Qwen稼働phase外でのdispatch）も修正し、再起動時に更新を再送せずfresh probeを必須とする試験と、dispatch phase検査を追加。統合レビューの追加指摘も修正: 実コンストラクタの再起動試験、上書きしない試行別の証跡保存、完了済みdrain取消時のHarness復帰hookを追加。
- `codex exec --model gpt-6.1-terra` で非本文metadataのみのvault owner-summaryを別途レビュー。初期値・Scale条件更新の未検証・rollback時Git整合の説明を補足した。
- read-only実API: local-llm/llama-server=1、stable-diffusion/qwen-image-eval=0、両App Synced、gate=open:BOXP-344-20261028T053334Z。Scaleはmetadata.uid/resourceVersionを返し、replicas=0のときspec={}を返す。この省略をfake APIにも反映して試験した。patch、dry-run patch、scale、GPU切替は実行していない。

## 実施できていないこと

権限付与/配備/実切替・時間短縮の実測/通常Board接続/実原典のlocal処理/新キャラnoteと資料画像は未実施。新権限だけでなく、計画に記載したcallback/lease/fairness/汎用jobの実装も必要。既存BOXP-344の実画像・復帰実績を本票の成果へ転記しない。
