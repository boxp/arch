# BOXP-701 インフラ図の定期更新

- lolice の BOXP-690 計画と live の Application・namespace を確認し、撤去済み TiDB Operator を両図から除く。
- Prometheus PVC の manifest と live の 120Gi を確認し、既存の Longhorn 接続の容量を更新する。
- 固定した arch / lolice の収集結果を基準にし、生成・ブラウザ検査後に両図と portfolio を配備、実 URL と公開境界を確認する。
- 基準と lineage サムネイルを PR に含め、CI・レビュー後に merge し、配備確認後に live 基準を更新して定期チェックを再実行する。

## 配備確認と基準更新の順序

- 基準はこの PR のマージまで進まない。マージ前の 2026-11-24 に両図の配備と実 URL の照合を完了した。
- lineage の配備 [run 45468137028](https://github.com/boxp/arch/actions/runs/45468137028)、全体図の配備 [run 45468315501](https://github.com/boxp/arch/actions/runs/45468315501) は成功。両 URL の HTML SHA-256 はそれぞれ `192e952e95b7b251a52c06608e5c34faafe2dc92494c46c032113b5a22fb1b09`、`d4a00d8a94ce371513591df7ec587a873f187a5ab452147e3e048898fcb5c007` で、検証済み build と一致した。
- portfolio の stage・本番は [run 45468612537](https://github.com/boxp/arch/actions/runs/45468612537) で成功。正本の promote 時に前版を保存済み。PR マージ後にサムネイルを含む portfolio の配備を再確認し、live 基準 accept と定期チェックを行う。
