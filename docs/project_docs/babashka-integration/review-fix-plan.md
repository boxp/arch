# PR #6923 レビュー対応計画

## レビューコメント

### boxp (オーナー)
> openclawコンテナ内だけでいいです。node側へのインストールは不要です

### Codex (自動レビュー)
> babashka のダウンロードURLが linux-amd64 固定

## 修正内容

### 1. Ansible babashkaロールの削除
Babashkaはopenclawコンテナ内でのみ必要。Ansibleロール（ノードへのインストール）は不要。

削除対象:
- `ansible/roles/babashka/defaults/main.yml`
- `ansible/roles/babashka/meta/main.yml`
- `ansible/roles/babashka/tasks/main.yml`
- `ansible/roles/babashka/molecule/default/molecule.yml`
- `ansible/roles/babashka/molecule/default/converge.yml`
- `ansible/roles/babashka/molecule/default/prepare.yml`
- `ansible/roles/babashka/molecule/default/verify.yml`

### 2. Dockerfileは維持（openclawコンテナ用）
`docker/openclaw/Dockerfile` のbabashkaインストール部分はそのまま維持。
CIは `linux/amd64` 固定のため、amd64ハードコードは現時点で問題なし。
