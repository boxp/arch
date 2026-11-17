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
