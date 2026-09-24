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
