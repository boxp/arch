# BOXP-188: Task Board runnerのGPT-6 Astra対応

## 実装方針

- `codex-astra`を`gpt-6-astra`に対応させる。
- モデル別のreasoning許可リストを設け、Astraのsuffixはチケットの契約どおりlow/medium/highのみ受け付ける。
- Astra向け委譲ポリシーを通常名とreasoning suffix付きの両方に付与し、fableにもAstraへの経路を記載する。
- 内蔵テストとshell統合テストでモデル選択、全許可suffix、拒否suffix、ポリシーを検証する。
- Codexレビューと検証を終えてPRを作成する。

## 追加モデルについての調査（2026-09-24）

[OpenAI公式モデル一覧](https://developers.openai.com/api/docs/models)にはGPT-6 Astra、Sol、Lunaが掲載されており、[GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna)も存在する。
ただし、この実行環境のCodexモデルカタログでGPT-6として確認できたのはAstraのみ。APIのモデル公開とこのCodex環境での利用可否は別なので、本PRでは受け入れ条件にあるAstra対応を実装する。既存assigneeのモデルを暗黙に変更しない。Sol/Lunaを追加する際はCodex利用可否とassignee命名を確認する。

Astra自体の利用可能reasoning設定とrunnerで許可するsuffixは区別する。本PRのlow/medium/high制限はチケットの明示的な受け入れ条件に基づく。

## 調査時の差異

チケットに既存と記載されたAstra用shellテストは指定worktreeには存在しなかったため、本PRで追加する。

## 検証環境の補足

- 統合テストの初回実行は既存のFable子プロセス停止チェックで失敗。停止済みsleepがコンテナPID 1の下にゾンビとして残るため、Linuxの`PR_SET_CHILD_SUBREAPER`を設定した一時ラッパーで孤児プロセスを回収して再実行する。テスト本体のassertionは維持する。
- Trivyは環境に未導入だったため公式releaseを一時ディレクトリに取得。チェック定義のダウンロードが進まなかったため`trivy config --skip-check-update .`で同梱定義を使用した。終了コード0だが、変更対象外のDockerfileに13件（HIGH 5、LOW 8）の指摘があるため、指摘なしという意味ではない。

## 検証結果

- `bb docker/codex-workspace/task-board/task_board_runner.bb test`: 全件成功。
- subreaperラッパー配下で`bash tests/codex-workspace/task-board-runner-test.sh`: 全件成功（`task-board-runner tests passed`、終了コード0）。
- `codex review -c 'model="gpt-5.6-terra"' --uncommitted`: 指摘なし。
- `git diff --check`: 成功。

## PR競合の解消（2026-09-24）

- PR #12902 の競合ゲート失敗を受け、既存PR headへ最新mainをmergeした。
- mainにもAstraのモデル割り当て、reasoning制限、専用policyとsuffix対応、内蔵テストが追加されていたため、mainの実装を採用した。Astraの進捗ログには実際のagent名をsourceとして指定する改善を保持した。
- 自動マージで同名のAstra policy統合テストが重複したため1つに統合し、low/medium/high全てのpolicyとreasoning引数を検証する。FableのAstra案内のassertionも保持した。
- Terraにrunnerの競合解消を委譲し、親がshellテスト統合と最終確認を担当した。
- 再検証: 内蔵テストとsubreaper配下のshell統合テストが全件成功（終了コード0）。Terraによる最終差分レビューは `CODEX_REVIEW_RESULT: clean`。`git diff --check`も成功。
- Trivyは同梱定義で再実行し終了コード0。変更対象外のDockerfileの13件（HIGH 5/LOW 8）は引き続き検出される。
