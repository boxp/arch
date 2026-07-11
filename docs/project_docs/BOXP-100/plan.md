# BOXP-100 Novel Board runner 実装計画

## 目的

Obsidian vault に Task Board とは独立した Novel Board と runner を追加し、要件整理、初稿・改稿、人間レビュー、承認済み完成版の配置をカード単位で自動化する。Novel Board のレーンを状態の source of truth とし、既存 Task Board runner と日次小説 cron のファイルや挙動は変更しない。

## 対象リポジトリ

- `boxp/arch`: Novel Board runner、vault seed、テスト、仕様・運用文書、codex-workspace image への同梱と `CODEX_WORKSPACE_ROLE=novel-board-runner` の起動契約。
- `boxp/lolice`: codex-workspace Deployment へ上記 image role を使う独立した `novel-board-runner` sidecar を追加。
- Obsidian vault: Git 管理外のため、PR に含める seed と同一内容の `Boards/Novel Board.md` を初期作成する。既存ファイルがある場合は上書きしない。

## 実装順序

1. 最新の Task Board runner、配備 manifest、日次小説 cron、完成版ディレクトリを棚卸しする。
2. `spec.md` で状態遷移、状態別責務、管理ノート、保存先、assignee、lock・再起動・失敗・冪等性を確定する。
3. `arch` に Novel Board seed と独立 runner を実装する。
4. black-box 統合テストで主要遷移、human review point、再開、assignee route、SFW/NSFW、重複防止、lock/restart を検証する。
5. `lolice` に sidecar、preStop、Pod UID owner、永続 root、運用手順を追加する。
6. vault を seed と同じ空 Board で初期化し、既存 Task Board、cron、既存小説が変更されていないことを確認する。
7. 両リポジトリの focused test と manifest render を実行し、コミット、push、相互参照する draft PR を作成する。
8. `arch` の feature branch を手動 image build し、GHCR に公開された immutable SHA tag を確認してから `lolice` manifest に pin する。
9. Pi route は配備済み vision model を明示選択し、管理ノートのローカル画像埋め込みを vault 内に限定して `@image` 入力として渡す。`--mode text` は出力形式だけを指定する。
10. 管理ノートだけに記録された未検証の `published-path` は再利用せず、private publication state と完成版 directory が一致する場合だけ既存公開を確定する。
11. review feedback に対応し、Novel Board 冒頭・各レーンの `#novel-rule` カード・管理ノート template・`Novels/README.md` に手動追加、各レーン、レビュー、公開ルールを明記する。`Backlog` のタイトルだけカードを `NOVEL-N` 正規カードへ冪等 scaffold し、`Templates/Novel Management.md` から管理ノートを生成する。常設 rule card は scaffold 対象から除外する。

## 変更境界

- `Boards/Task Board.md` と `Tickets/` は読み書きしない。
- Novel Board の管理ノートは `Novels/`、作業中原稿とログは `/home/boxp/.novel-board/` に置き、完成版フォルダから分離する。
- `Done` でのみ、承認済み原稿を完成版フォルダへ一度だけコピーする。
- 既存の日次小説 cron prompt、既存小説、既存添付画像を変更しない。
- Novel Board runner は Task Board runner と別 process、別 root、別 lock、別環境変数を使う。
- 通常 workspace では Novel Board role を設定せず、sidecar だけが image entrypoint から `boxp` user で runner loop を起動する。root 起動時は entrypoint が ownership を修復して `boxp` へ切り替え、配備済み sidecar のように既に `boxp` UID なら private root の mode を確定して直接起動する。

## 検証項目

- `Backlog -> Draft` で仕様・アウトラインのみ生成し、本文を書かない。
- `Backlog` の未リンクタイトルカードが既存 ID の次の `NOVEL-N` とテンプレート由来の管理ノートへ変換され、再走査で重複しない。担当省略時は `boxp` となり agent を起動しない。
- `Draft` と `Review` は未アサインまたは人間担当で停止する。
- 対応 agent を割り当てた `Draft -> In Progress`、`Review -> In Progress` と、原稿準備後の `In Progress -> Review`。
- `Review -> Done` は人間によるカード移動のみ。runner は Review から Done へ移動しない。
- `Done` の SFW/NSFW 振り分け、atomic publish、コピー中断からのハッシュ検証付き復旧、上書き禁止、再走査時の重複防止、管理ノートの完成版リンク。
- Task Board と同じ Codex assignee・reasoning suffix、`fable`、追加 `pi` の CLI route。未知 assignee は非起動で理由を記録。
- Pi の `gemma4-26b-vision` 明示選択、Pi ConfigMap mount、vault 内の Obsidian/Markdown 画像埋め込みの `@image` 引数化、vault 外参照の拒否。
- 管理ノートの未検証 `published-path` が既存ファイルを横取りせず、正規の SFW/NSFW destination に公開されること。
- active/stale lock、異常終了、lane/status 不一致、再起動後の lane 優先。
- `kubectl kustomize argoproj/codex-workspace` の成功と sidecar の security/resource/PVC 設定。

## Rollout

1. `arch` PR の手動 build で Novel runner を含む immutable SHA image を生成し、GHCR で参照可能なことを確認する。
2. 公開済み SHA image を `lolice` PR で pin し、両 PR をレビューする。恒久反映では `arch` を先に merge する。
3. Pod rollout 後、空 Novel Board、runner log、owner/lock root、Task Board runner と cron の継続稼働を確認する。
4. 問題時は先に `lolice` の sidecar 差分を revert する。Novel runner の root と work は退避し、既存 Task Board や完成版を削除しない。
