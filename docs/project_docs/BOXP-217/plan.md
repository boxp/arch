# BOXP-217: 月次セキュリティ診断（lolice / インフラ）の整備計画

## 目的

lolice cluster と周辺インフラ（Cloudflare Tunnel/Access、Tailscale、GitHub 依存）を対象に、月次で機械的に実行できるセキュリティ診断を Recurring Events 経由で毎月起票し、Critical/High だけを個別チケット化する運用を作る。2026 年に国内で相次いだ n-day（公開済み脆弱性の未修正）起因の漏えいを踏まえ、露出コンポーネントの版数追従と CISA KEV / GHSA 照合を最優先項目にする。

## 方針

1. **収集は read-only の Babashka スクリプト 1 本**（`scripts/security-audit/security_audit.bb`）に集約する。kubectl / gh / curl だけで動き、Markdown レポートを出す。既存の codex-workspace RBAC（cluster 全体 get/list）で完結し、書き込み権限を追加しない。
2. **n-day 判定を機械化**する。露出面のコンポーネント catalog（image repo → upstream GitHub repo）を持ち、`releases/latest`・`security-advisories`・KEV JSON を突合して「稼働版に未修正の GHSA があるか」「KEV 掲載 CVE に該当するか」を表にする。
3. **trivy はツール導入のみ**。codex-workspace Dockerfile の ARG と Renovate regex manager（既存の kubectl 等と同じ方式）、および `aqua/imports/trivy.yaml`（CLAUDE.md が `trivy config .` を前提にしているため）の両方で版数を追従させる。全イメージの `trivy image` は時間がかかるため、runbook では露出イメージに絞る手順にし、スクリプトの `--trivy` はオプション扱いにする。
4. **kube-bench は見送り**。arm64 control-plane で hostPID Job を作る権限が codex-workspace に無いため、apiserver flag の手動チェックリストをスクリプト §2 に組み込んで代替する。
5. **起票ルール**は Recurring Event の Ticket Template と runbook の両方に書く。Critical（KEV / 公開 PoC / 無認証到達可能）は月次を待たず即時起票、High は個別チケット、Medium 以下は Notes のみ、既存チケットは grep で重複回避。

## 変更内容（boxp/arch）

- `scripts/security-audit/security_audit.bb`: 新規。
- `aqua/imports/trivy.yaml`: `aquasecurity/trivy@v0.75.0`（checksums は CI の update-aqua-checksums が追記）。
- `docker/codex-workspace/Dockerfile`: `ARG TRIVY_VERSION=0.75.0` と GitHub release からのインストール。
- `renovate.json5`: `TRIVY_VERSION` の github-releases regex manager。
- `docs/project_docs/BOXP-217/runbook.md`: 診断項目・判定基準・起票ルール・ログに残してよい情報の線引き・kube-bench 判断。
- `docs/project_docs/BOXP-217/baseline-2026-10.md`: 初回診断のベースライン。

## 変更内容（Obsidian vault）

- `Infrastructure/Recurring Events/Events/monthly-security-audit.md`: cron `0 9 1 * *`、lead-days 7、assignee claude-fable、repo `boxp/arch boxp/lolice`。
- 初回診断で Critical/High と判定した項目の個別チケット。

## 検証

- スクリプトを実クラスタで実行し、全セクションが出力されること。
- `recurring_events.bb dry-run` で `monthly-security-audit` が `not-yet`（当日）／`candidate`（`--today 2026-10-26`）となり `invalid` でないこと。
- trivy v0.75.0 を同じ URL から取得して `trivy image` が動くこと。

## 残作業

- 翌月 1 日分（2026-10-25 以降の `recurring-events-apply`）で診断チケットが Backlog に起票されることを確認して本チケットを閉じる。
