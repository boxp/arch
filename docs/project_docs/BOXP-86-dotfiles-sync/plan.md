# BOXP-86: codex-workspace dotfiles 同期

## 目的

codex-workspace Pod の共有ホームディレクトリへ `boxp/dotfiles` を安全に同期し、更新後に `setup.sh` を実行する。

## 実施内容

1. codex-workspace イメージに dotfiles 同期スクリプトを同梱する。
2. Deployment に共有ホームボリュームを利用する同期 sidecar を追加する。
3. シェル構文・Kubernetes マニフェストを検証し、各リポジトリでレビュー、コミット、PR を作成する。

## 安全性

- `origin` が `boxp/dotfiles` であることを確認する。
- ローカルの追跡済み変更または履歴分岐がある場合は同期とセットアップを中止する。
- 更新は fast-forward のみを許可する。
