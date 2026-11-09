# BOXP-456: インフラ図の定期更新 (2026-11-06 の差分)

## 差分と判断

| 差分 | 判断 | 根拠 |
|---|---|---|
| kohako-studio (Application / Namespace / Deployment / ClusterIP Service / NetworkPolicy / RBAC) | 図へ反映 | public repo boxp/lolice `argoproj/kohako-studio/`、live で Deployment 1/1 |
| kohako-studio の ExternalSecret `kohako-hermes-api-key` | 独立ノードにせず Hermes 経路の根拠のみ | 値は読まない |
| `kohako-studio.b0xp.io` (DNS / Tunnel / Access 本人限定) | 図へ反映 | `terraform/cloudflare/b0xp.io/even-g2-lab/` |
| langfuse-mcp-readonly (Deployment / ClusterIP) | Langfuse に反映 | `argoproj/langfuse/mcp-readonly-proxy.yaml`、live 1/1 |
| llama-server 停止→稼働 | 状態を修正 | live 1/1 |
| strata-server 稼働→停止 | 状態を修正 | live 0/0、manifest replicas 0 (GPU 共用) |
| 全体図 Access application の削除 | 反映済み (BOXP-435) | 基準のみ更新 |
| `promote-portfolio-production.yml`、`build-kohako-studio-image.yml`、longhorn 設定 | 基準のみ更新 | 図の要素の粒度外 |

## 公開境界の整合 (TD-01)

最新の Owner 承認: lineage 一般公開 (BOXP-430)、全体図一般公開 (BOXP-435 TD-04)、portfolio 本番は両図のカードとサムネイルを掲載 (BOXP-442 TD-01)。
`publish.bb` の配備後検査「本番に全体図の語が無いこと」は承認前の前提で、現在は必ず失敗する。本番が配信を続けていること (HTTP 200) の確認へ直し、README の権限境界を現承認へ合わせる。
本番 portfolio の再配備 (サムネイル更新) はこの手順では行わない。

## 手順

1. staging で edn を直し `publish.bb build`
2. 修正版 `publish.bb deploy` / `promote`
3. 基準 `iac-baseline.json` と lineage サムネイル、publish.bb / README の修正を PR にして CI・review・merge
4. `refresh.bb accept --ticket BOXP-456`、`schedule-infra-diagram-refresh.yml` を実行し無差分を確認
