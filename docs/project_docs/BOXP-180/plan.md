# BOXP-180: etcd snapshot 定期取得・隔離保管・復元検証

## 方針

- GitHub Actions を毎日 UTC 02:17 に実行し、`shanghai-1` の静的 etcd Pod から snapshot を作成する。
- 既存の Longhorn PVC で一次確認した後、GitHub Actions runner に fetch し、クラスタとは別障害ドメインの AWS S3 `arch-etcd-snapshots` へ保存する。
- S3 は Terraform で public access block、SSE-S3、versioning、30 日 lifecycle を定義済み。workflow は S3 暗号化属性も確認する。
- S3 の最新 snapshot を CI runner の一時ディレクトリで `etcdutl snapshot restore` し、本番 etcd、member、`/var/lib/etcd` には一切変更を加えない。
- snapshot/status、S3 upload/encryption、restore のいずれかが失敗した場合は、重複を避けた GitHub Issue を作成して通知する。

## 完了条件と検証

1. Ansible role の Molecule test で PVC 検証済み snapshot の controller fetch を検証する。
2. `ansible-lint` と `actionlint` で automation/config を検証する。
3. runbook に RPO/RTO、restore、rollback と production 操作の承認境界を明記する。

## レビュー対応

- Molecule の controller 側取得先は `prepare.yml` でシナリオ開始時に削除する。`converge.yml` 内で削除すると idempotence pass が二度目の fetch を必ず変更扱いにするため、準備フェーズに限定する。
- Cloudflare Access 経由の SSH 前に既存 Aqua 定義の `cloudflared` を導入し、alert job の `gh issue` 呼び出しは `GITHUB_REPOSITORY` を明示する。
- 隔離バックアップの controller fetch が成功したら、control plane の再ステージ用ファイルを削除する。Longhorn PVC と controller 側コピーは保持し、日次実行で control plane のディスクを消費しないことを Molecule で検証する。
- 復元検証は固定の etcdutl image を使わず、snapshot を生成した static etcd Pod の image を controller 側メタデータとして同時に記録し、その image で実行する。Molecule は取得・記録される image を検証し、workflow はその値を restore job へ渡す。
