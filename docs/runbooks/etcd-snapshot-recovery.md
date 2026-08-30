# etcd snapshot backup / recovery runbook

## 自動化の契約

`.github/workflows/etcd-snapshot-backup.yml` は毎日 UTC 02:17 に実行される。`shanghai-1` の静的 etcd Pod で snapshot を作成し、`etcdctl snapshot status`、Longhorn PVC 上の非空確認を通過したデータだけを AWS S3 `s3://arch-etcd-snapshots/scheduled/` に保存する。S3 はクラスタ・Longhorn とは別障害ドメインであり、SSE-S3、versioning、30 日 retention が Terraform で強制される。

workflow は S3 から最新 snapshot を runner の一時ディレクトリに download し、`etcdutl snapshot restore` を一時 data-dir に実行する。この検証は本番 etcd Pod、member、`/var/lib/etcd` を変更しない。失敗時は同名の未解決 GitHub Issue を 1 件だけ作成する。

## 目標値

- RPO: 24 時間以内（毎日の成功 snapshot）。upgrade 前 snapshot は補助的な追加保護であり、これを置き換えない。
- RTO: 120 分。障害宣言、snapshot 選定、承認済み restore、control plane の健全性確認を含む目標であり、実測は四半期ごとの演習で更新する。

## 復元手順（承認必須）

1. incident commander の承認を得て、全 control plane の kubelet を停止し、稼働 member と snapshot の revision を記録する。quorum が残る場合は restore より member repair を優先する。
2. 対象 snapshot を S3 の version ID 付きでダウンロードし、隔離ホストで `etcdutl snapshot status` と `etcdutl snapshot restore --data-dir <temporary-dir>` を再実行する。
3. cluster の member 構成、`initial-cluster`、advertise peer URL を現在の障害計画と照合する。`ansible/roles/kubernetes_upgrade/tasks/rollback.yml` は自動実行しない。
4. 承認後のみ、停止中の etcd data dir をタイムスタンプ付きに退避して restore 出力と入れ替え、kubelet を 1 台ずつ起動する。各台で endpoint health、member list、Kubernetes API、workload を確認する。
5. 復旧不能または revision 選定誤りなら kubelet を再停止し、退避済み data dir へ戻す。手順・時刻・使用した S3 object version を incident 記録へ残す。

live restore、member 操作、production apply はこの runbook 単独では承認されない。
