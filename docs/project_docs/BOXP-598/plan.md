# BOXP-598 Longhorn バックアップの旧版ライフサイクル

## 目的

`boxp-longhorn-backup` はバージョニングが有効で旧版を消す設定がない。Longhorn が保持世代外の block を削除しても S3 に旧版として残り、課金が続く。

## 実測

2026-11-17 の Longhorn CR 読み取り専用調査では、現行バックアップ実データは合計 271.7 GB、うち `codex-workspace-home` は 228.3 GB。`codex-workspace-home` は日次で新規 25〜40 GB をアップロードし、保持 3 世代のため同程度が毎日旧版化する。S3 日額が 11/3 の 0.50 USD から 11/16 の 0.73 USD に増加したことと整合する。

## 変更と判断

`backupstore/` に限定し、旧版を N 日後に削除する。不要な削除マーカーと開始から 7 日を超えた未完了 multipart upload も削除する。復元に使う現行版は削除せず、`hitohub-decommission/` 等の他 prefix には適用しない。

N 日は Owner 判断事項で、2026-11-17 に Owner が 14 日を選択した（候補は 7 / 14 / 30 日）。N 日は誤削除・鍵漏えい時に旧版から戻せる猶予となる。定常の旧版量の目安は N × 日 20〜35 GB で、7 日なら約 140〜245 GB、14 日なら約 280〜490 GB、30 日なら約 0.6〜1.05 TB。

## 確認と戻し方

- tfaction の plan で lifecycle の追加 1 件のみであり、既存資源の変更・削除がないことを確認する。
- 適用後、Owner がコンソールで lifecycle rule を確認し、翌月以降 `aws_cost_day_usd` で S3 日額の頭打ちを確認する。
- この resource を削除する PR で lifecycle を外せる。すでに期限切れで消えた旧版は戻らない。

## 範囲外

Longhorn の保持世代・対象 volume の変更、バックアップ削除、KMS 鍵、Cloudflare/R2。

---

# BOXP-598 追加: S3 使用タイプ別の日次取得（2026-11-26、Owner 選択 B）

## 目的

旧版 14 日対策後も S3 日額が約 1.05 USD/日に留まり、保管量から説明できない月 11〜15 USD がある。既存の BOXP-594 費用取得経路（GitHub Actions OIDC → Cost Explorer → SSM → ESO → aws-cost-metrics → Prometheus/Grafana）に S3 の使用タイプ別（保管・リクエスト・転送など）を毎日加え、主要因を特定する。

## 仕様（例つき）

- 1 回の取得で Cost Explorer を 1 回追加で呼ぶ: 期間 = 取得日の 14 日前〜前日、日別、`SERVICE = Amazon Simple Storage Service` で絞り `USAGE_TYPE` でグループ化、指標は `UnblendedCost` と `UsageQuantity`。続きページは取らない（あれば取得失敗扱い）。
- 保存先 `/lolice/aws-cost/s3_usage`（SecureString、標準 4KB 以内）。形は既存 `daily` と同じ行列: `{schema, snapshot_id, available:true, days, usage_types, values[費用], quantities[使用量]}`。費用上位 10 種＋`Other`。`Other` の使用量は単位が混ざるので null。4KB を超えるなら `quantities` を落とし、それでも超えるなら失敗。
  - 例: 取得日 2024-03-16、A が 03-02 に 1 USD/10、B が 03-15 に 2 USD/5、03-01 は窓外 → `days ["2024-03-02","2024-03-15"]`, `usage_types ["A","B"]`, `values [[1,0],[0,2]]`, `quantities [[10,0],[0,5]]`。
- S3 内訳の取得失敗は本体の snapshot を失敗させない。`{available:false, error_code}` を保存する（金額・本文はログに出さない、エラーコード名のみ）。
- 書込は既存と同じ一括単位（daily → services → s3_usage → summary → status）で、途中失敗時は全て前の値へ戻す。
- 1 回の Cost Explorer リクエスト上限 6 → 7。通常 1 日 3 リクエスト（月約 0.9 USD、+約 0.3 USD）、失敗が続く最悪でも 1 日 21 リクエスト。
- IAM 変更なし（既存 `ce:GetCostAndUsage` Resource `*`、`/lolice/aws-cost/*`）。

Lean モデルは付けない: 状態機械や順序規則のない入出力変換で、直接テストで足りるため。

## 反映順

1. arch（本 PR）: SSM パラメータ作成（tfaction apply、1 add）と取得処理更新。
2. lolice: ESO に `s3_usage.json` を追加し、`aws_cost_s3_usage_type_day_usd` / `aws_cost_s3_usage_type_day_quantity` を出す。SSM 作成前に ESO が参照すると既存 Secret 全体が同期失敗するので、arch apply 後に merge する。
3. 次の定期実行（23:00 UTC）または workflow_dispatch で初回取得 → Grafana で読戻し。

## 戻し方

lolice PR を revert → arch PR を revert（SSM パラメータ削除 1 件）。
