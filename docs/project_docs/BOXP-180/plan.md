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
