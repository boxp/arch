# BOXP-394: arch / lolice / even-g2-lab への ADR と regomark 導入

## 目的

Owner の決定に従い、3 repo に ADR と regomark による構造検査、Rego lint を導入し、main の CI まで検証する。

## 方針

- ツール: regomark v0.3.0 (内蔵 OPA v1.22.0)、OPA v1.22.0、Regal v0.43.0。上流の配布は checksum のみで署名はないため、checksum で固定する
- policy: 記事と regomark README の規則を基に独自実装する。参照先の policy は AGPL-3.0 またはライセンス表記なしのため流用しない
- 共通化: boxp/arch を正本とし、`.regomark/shared.sha256` の一致を必須検査にする。正本との差は warning で知らせる。新しい bot や権限は導入しない
- 必須 check への統合
  - arch: `test.yaml` の `adr` job を `status-check` に集約。`adr.yaml` で main と検査定義の PR を実行
  - lolice: `chainsaw.yaml` の `adr` job を `status-check` に集約。`adr.yaml` で main を実行
  - even-g2-lab: required context を増やさないため `test` job の step に統合。`adr.yml` で main を実行
- 版の追跡: arch は aqua、lolice と even-g2-lab は `.regomark/tools.env` を Renovate の regex manager で追跡する
- 意味検査: warn 専用で必須 CI では動かさない。local の `--judge` と、既存 Secret がある repo の手動 workflow だけを入口にする
- 既存の Rego には新しい lint を適用しない。現状の違反数は owner summary に棚卸しする

## 検証

1. ローカルで `.regomark/check.sh` (opa check/fmt/test、Regal、regomark、e2e)
2. PR で既存 CI と review gate
3. merge 後に main の run を読み戻す
4. 構造違反の検証 PR で必須 check が失敗することを確認し、merge せず閉じる
5. 本番 Apply や rollout が起動していないことを確認する
