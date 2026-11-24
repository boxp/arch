# BOXP-701 インフラ図の定期更新

- lolice の BOXP-690 計画と live の Application・namespace を確認し、撤去済み TiDB Operator を両図から除く。
- Prometheus PVC の manifest と live の 120Gi を確認し、既存の Longhorn 接続の容量を更新する。
- 固定した arch / lolice の収集結果を基準にし、生成・ブラウザ検査後に両図と portfolio を配備、実 URL と公開境界を確認する。
- 基準と lineage サムネイルを PR に含め、CI・レビュー後に merge し、配備確認後に live 基準を更新して定期チェックを再実行する。
