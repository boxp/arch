# BOXP-536: iikanji 廃止・専用インフラ撤去・リポジトリ archive

## 調査結果（2026-11-13）

| 資源 | 管理 | 状態 | 扱い |
|---|---|---|---|
| `cloudflare_pages_project.iikanji`（`boxp-iikanji`） | arch `terraform/cloudflare/b0xp.io/portfolio/pages.tf`（同ファイルの portfolio 用 Pages は共有のため残す） | `boxp-iikanji.pages.dev` は 522（配信実体なし） | 削除 |
| `cloudflare_pages_domain.iikanji_subdomain`（`iikanji.b0xp.io`） | 同上 | 522 | 削除 |
| `cloudflare_dns_record.iikanji`（CNAME `iikanji.b0xp.io`） | arch `dns.tf` | 522 | 削除 |
| GitHub repo `boxp/iikanji` | GitHub | Actions secrets なし・deploy は失敗続き・Releases なし | archive（コード/履歴は保持） |

- iikanji 専用 secrets / variables / webhooks / environments は存在しない。
- `b0xp.io`/`www.b0xp.io` の DNS レコード（同 working directory）は共有資源なので変更しない。
- 保全が必要なデータ: なし（静的サイト。ソースは archive された repo に残る）。
- `boxp/arch` の `apps/portfolio/src/content/skills.json` と `boxp/b0xp.io` の `src/content/skills.json` が evidence として `boxp/iikanji` を参照するが、archive 後もリンクは有効なため対象外（報告のみ）。

## 手順

1. arch PR で上記 3 resource を削除（tfaction plan で destroy 3 件のみを確認）。
2. merge → tfaction apply で Cloudflare から削除、`iikanji.b0xp.io` が解決しないことを確認。
3. `gh repo archive boxp/iikanji` で archive し、`archived=true` を確認。
