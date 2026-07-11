# BOXP-100 Novel Board runner 実装計画

## 目的

Obsidian vault に Task Board とは独立した Novel Board と runner を追加し、要件整理、初稿・改稿、人間レビュー、承認済み完成版の配置をカード単位で自動化する。Novel Board のレーンを状態の source of truth とし、既存 Task Board runner と日次小説 cron のファイルや挙動は変更しない。

## 対象リポジトリ

- `boxp/arch`: Novel Board runner、vault seed、テスト、仕様・運用文書、codex-workspace image への同梱。
- `boxp/lolice`: codex-workspace Deployment へ独立した `novel-board-runner` sidecar を追加。
- Obsidian vault: Git 管理外のため、PR に含める seed と同一内容の `Boards/Novel Board.md` を初期作成する。既存ファイルがある場合は上書きしない。

## 実装順序

1. 最新の Task Board runner、配備 manifest、日次小説 cron、完成版ディレクトリを棚卸しする。
2. `spec.md` で状態遷移、状態別責務、管理ノート、保存先、assignee、lock・再起動・失敗・冪等性を確定する。
3. `arch` に Novel Board seed と独立 runner を実装する。
4. black-box 統合テストで主要遷移、human review point、再開、assignee route、SFW/NSFW、重複防止、lock/restart を検証する。
5. `lolice` に sidecar、preStop、Pod UID owner、永続 root、運用手順を追加する。
6. vault を seed と同じ空 Board で初期化し、既存 Task Board、cron、既存小説が変更されていないことを確認する。
7. 両リポジトリの focused test と manifest render を実行し、コミット、push、相互参照する draft PR を作成する。

## 変更境界

- `Boards/Task Board.md` と `Tickets/` は読み書きしない。
- Novel Board の管理ノートは `Novels/`、作業中原稿とログは `/home/boxp/.novel-board/` に置き、完成版フォルダから分離する。
- `Done` でのみ、承認済み原稿を完成版フォルダへ一度だけコピーする。
- 既存の日次小説 cron prompt、既存小説、既存添付画像を変更しない。
- Novel Board runner は Task Board runner と別 process、別 root、別 lock、別環境変数を使う。

## 検証項目

- `Backlog -> Draft` で仕様・アウトラインのみ生成し、本文を書かない。
- `Draft` と `Review` は未アサインまたは人間担当で停止する。
- 対応 agent を割り当てた `Draft -> In Progress`、`Review -> In Progress` と、原稿準備後の `In Progress -> Review`。
- `Review -> Done` は人間によるカード移動のみ。runner は Review から Done へ移動しない。
- `Done` の SFW/NSFW 振り分け、上書き禁止、再走査時の重複防止、管理ノートの完成版リンク。
- Task Board と同じ Codex assignee・reasoning suffix、`fable`、追加 `pi` の CLI route。未知 assignee は非起動で理由を記録。
- active/stale lock、異常終了、lane/status 不一致、再起動後の lane 優先。
- `kubectl kustomize argoproj/codex-workspace` の成功と sidecar の security/resource/PVC 設定。

## Rollout

1. `arch` PR を merge して Novel runner を含む image を生成する。
2. image updater 反映後に `lolice` PR を merge し、存在する image path を参照する sidecar を追加する。
3. Pod rollout 後、空 Novel Board、runner log、owner/lock root、Task Board runner と cron の継続稼働を確認する。
4. 問題時は先に `lolice` の sidecar 差分を revert する。Novel runner の root と work は退避し、既存 Task Board や完成版を削除しない。
