# BOXP-86: codex-workspace dotfiles 同期

## 目的

codex-workspace Pod の共有ホームディレクトリへ `boxp/dotfiles` を安全に同期し、更新後に `setup.sh` を実行する。

## 実施内容

1. codex-workspace イメージに `dotfiles-sync.sh` 同期スクリプトを同梱し、`/opt/codex-workspace/dotfiles-sync.sh` として配置する。
2. `entrypoint.sh` から `boxp` ユーザーかつ `HOME=/home/boxp` で `dotfiles-sync.sh` をバックグラウンドプロセス（`&`）として起動する。サイドカーコンテナは採用しない。同じコンテナ内で実行することでホーム PVC の共有が自然に実現でき、Deployment マニフェストへの追加変更が不要となるため、バックグラウンドプロセス方式を採用した。
3. 同期スクリプトは 300 秒以下の間隔で fetch・fast-forward-only 更新・`setup.sh` 実行のループを継続する。

## 安全性

- `DOTFILES_REPO` 環境変数での上書きを許可せず、許可 URL を `is_valid_dotfiles_url` 関数でハードコードされた正規表現に厳密照合する。
- clone 後にも clone 元 URL を再検証し、不正な場合は clone を削除して終了する。
- ローカルの追跡済み変更または履歴分岐がある場合は同期と `setup.sh` 実行を中止する。
- 更新は fast-forward のみを許可し、`reset --hard`・強制 checkout・`clean` は行わない。
- 同期・`setup.sh` の失敗でも workspace 本体（even-terminal / sshd）を停止させない。
