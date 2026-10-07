# BOXP-217: lolice / インフラ月次セキュリティ診断 runbook

毎月1日に Recurring Event `monthly-security-audit` が Backlog へ起票する診断チケットの実行手順。
codex-workspace（Task Board runner / claude-fable）が人手なしで一通り実行できることを前提にする。

目的は「設定の棚卸し」と、**公開面に露出しているコンポーネントが既知の悪用済み脆弱性（n-day）を抱えたまま稼働していないか**を毎月検出し、修正までの期間を短くすること。2026年の国内大規模漏えいはゼロデイではなく n-day（公開済み脆弱性の未修正）が主な侵入口であり、本診断では n-day カテゴリを最優先にする。

## 0. 前提

- 実行環境: codex-workspace Pod（`kubectl` は ServiceAccount `codex-workspace` の read-only 権限、`gh` は `boxp` の認証、`bb`、`trivy`、`curl`）。
- 参照リポジトリ: `boxp/arch`（本 runbook・スクリプト・terraform）、`boxp/lolice`（Kubernetes manifest）。
- 書き込みは行わない。NetworkPolicy 等の修正は個別チケットで扱う。

## 1. 診断項目一覧と判定基準

| # | カテゴリ | 項目 | 取得方法 | 判定・緊急度 |
| --- | --- | --- | --- | --- |
| 0 | **n-day / 既知脆弱性** | 露出コンポーネント（Argo CD, Grafana, Longhorn, cloudflared, Tailscale, Kubernetes Dashboard/Kong, TiDB, dex, kube-vip, kube-apiserver, Prometheus, Loki）の稼働 image tag と upstream 最新版・GHSA・CISA KEV の照合 | スクリプト §0 | **Critical**: KEV 掲載 CVE に該当、または公開 PoC / 悪用報告ありの CVE に該当、または無認証で到達可能な RCE に該当。**High**: GHSA critical/high で稼働版が未修正。**Medium**: パッチ版遅れのみ。`judgement=unknown` は手動確認 |
| 0 | n-day | GitHub Dependabot open alerts（boxp/arch, boxp/lolice） | スクリプト §11 | **High**: severity high/critical。Medium 以下は Notes |
| 0 | n-day | `trivy image` で稼働イメージの既知 CVE（fix あり） | §3.2 | **High**: CRITICAL が 1 件以上（fix あり）。HIGH のみは Medium |
| 0 | n-day | ノード kernel / apt 更新（KEV に Linux kernel が毎月追加されている） | §3.4 | **High**: KEV 掲載 kernel CVE の該当版を稼働。Medium: security update 未適用あり |
| 1 | クラスタ構成 | Kubernetes / CRI-O / ノード OS 版数 | スクリプト §1 | Medium: サポート切れ minor。BOXP-190（四半期 upgrade planning）へ連携 |
| 1 | クラスタ構成 | kube-apiserver flags（audit log、admission、anonymous-auth 等） | スクリプト §2 | Medium: `--audit-log-path` 未設定、`--enable-admission-plugins` に PodSecurity 等が無い。High: `--anonymous-auth=true` 明示、`--authorization-mode` に AlwaysAllow |
| 1 | クラスタ構成 | cluster-admin ClusterRoleBinding | スクリプト §8 | **High**: 前月から subject が増えた。既定（`system:masters`, `kubeadm:cluster-admins`, `longhorn-support-bundle`）は記録のみ |
| 2 | workload hardening | PSA enforce 未設定 namespace | スクリプト §5 | Medium。外部露出 ns（hitohub/argocd/monitoring/kube-dashboard）は High 寄り |
| 2 | workload hardening | privileged / hostNetwork / hostPID / hostPath Pod | スクリプト §6 | **High**: 想定外の ns / workload が増えた、または `kubectl debug` の残骸（node-debugger）が存在。想定内（longhorn, calico, kube-system, intel-device-plugins, codex-workspace docker）は記録のみ |
| 2 | workload hardening | `:latest` / タグなし image | スクリプト §7 | **High**（版数追従が検証不能） |
| 2 | workload hardening | digest 未固定 image | スクリプト §7 | Low（件数のみ記録） |
| 2 | workload hardening | NetworkPolicy 未適用 namespace | スクリプト §9 | Medium。argocd の repo-server/redis/server NetworkPolicy 不在は **High 以上**（CVE-2026-15416 の唯一の緩和策） |
| 3 | 外部公開面 | LoadBalancer / NodePort / Tailscale Service | スクリプト §3.1 | Medium: 前月から増えた Service。High: 認証なしの管理 UI が LAN LB に新規露出 |
| 3 | 外部公開面 | cloudflared を持つ namespace と版数 | スクリプト §3.2, §4 | High: `:latest`。Medium: 版数混在 |
| 3 | 外部公開面 | Cloudflare Tunnel あり・Access なし terraform dir | スクリプト §3.4 | **High**: 公開意図のない管理系 UI。公開意図あり（ゲームサーバ、公開 Web）は Notes に理由を記録 |
| 3 | 外部公開面 | Tailscale credential | BOXP-200 の四半期イベントで扱う。本診断は参照のみ | - |
| 4 | Argo CD | OutOfSync / Degraded / Unknown application | スクリプト §10 | Medium: 長期間 OutOfSync（drift が放置されている） |

### 緊急度と起票ルール

- **Critical**（KEV 掲載 / 公開 PoC あり / 無認証到達可能な RCE）: **月次を待たず即時**に個別チケットを起票する。`priority: high`、`tags: security`、該当 `repo::` を付け Backlog へ。可能なら緩和策（NetworkPolicy、公開停止）を同チケットで先に実施する。
- **High**: 個別チケット（`priority: high`、`tags: security`、`repo::`）を Backlog へ。
- **Medium / Low**: 診断チケットの Notes に記録するだけに留める。3か月連続で同じ Medium が残る場合は High に格上げして個別チケット化する。
- **重複回避**: 起票前に `grep -ril "<キーワード>" /home/boxp/Documents/obsidian-headless/BOXP/Tickets/` で既存チケットを探し、open（backlog/ready/in-progress/review/blocked）なものがあれば新規起票せず、そのチケットの Notes に追記する。
- 起票は `bb ~/.claude/skills/obsidian-task-board/bin/task-board.bb create --vault ... --title ... --summary ... --lane Backlog --priority high --assignee boxp` で行い、frontmatter の `repo` / `tags` を `update` で補う。

## 2. 実行手順

### 2.1 収集スクリプト

```bash
cd /home/boxp/ghq/github.com/boxp/arch   # または run worktree
bb scripts/security-audit/security_audit.bb \
  --out /tmp/security-audit-$(date +%Y-%m).md \
  --images-out /tmp/security-audit-images.txt
```

- 所要時間は約 1 分（GitHub API 呼び出しがほとんど）。
- オプション: `--skip-github`（GitHub API 不可時）、`--skip-kev` / `--kev-file PATH`（KEV JSON を事前取得した場合）、`--arch-root PATH`（terraform の場所）、`--repos owner/a,owner/b`、`--trivy`（§12 で trivy image を全イメージに対して実行。時間がかかるので通常は §3.2 の手順を使う）。
- 出力は Markdown。セクション 0 が n-day 判定、1〜2 がクラスタ構成、3〜4 が露出面、5〜9 が workload hardening、10 が Argo CD、11 が Dependabot、12 が trivy。

### 2.2 n-day 判定（最優先）

1. §0 の表で **KEV 列に CVE があるコンポーネント**を確認する。あれば無条件 Critical。
2. `GHSA affecting running` が 1 以上の行は、詳細表の `patched versions` と稼働 tag を見て未修正か確認する。severity critical/high なら High（公開 PoC があれば Critical）。
3. `judgement=unknown` の行は patched_versions が機械判定できなかったもの。GHSA の `vulnerable_version_range` を手で読む。
4. スクリプトは GitHub repo の GHSA しか見ない。以下は手動で補完する:
   - Argo CD: `gh api repos/argoproj/argo-cd/security-advisories?state=published --jq '.[0:10][] | [.ghsa_id,.cve_id,.severity,.published_at[:10],.summary]|@tsv'` に加え、Helm chart 側 `gh api repos/argoproj/argo-helm/security-advisories`（NetworkPolicy 関連）。
   - Red Hat / NVD にしか載らない CVE: `gh api "/advisories?cve_id=CVE-XXXX-YYYY"` で GHSA 化されているか確認し、無ければ `https://access.redhat.com/hydra/rest/securitydata/cve/CVE-XXXX-YYYY.json` を参照。
   - KEV の vendor/product 列は部分一致なので、Grafana の 2021 年 CVE のように稼働版で修正済みのものも並ぶ。`KEV (CVE in GHSA, not fixed for running)` 列が空なら稼働版への該当はない。
5. 露出しているが catalog にないコンポーネント（hitohub、ゲームサーバ、even-g2-lab の自前イメージ）は §4 の image tag を見て、ベースイメージ更新が止まっていないか（ECR の SHA タグが数か月変わっていない等）を記録する。

### 2.3 trivy image

```bash
trivy --version
# 露出 namespace の稼働イメージだけを対象にする（全 97 件は 30 分以上かかる）
grep -E "argocd|grafana|cloudflared|longhorn-manager|dashboard-api|kong|pingcap/tidb|dexidp|tailscale|hitohub" /tmp/security-audit-images.txt > /tmp/trivy-targets.txt
export TRIVY_DB_REPOSITORY=ghcr.io/aquasecurity/trivy-db:2   # mirror.gcr.io が到達不能なため
while read -r img; do
  trivy image --quiet --severity CRITICAL,HIGH --ignore-unfixed --scanners vuln --format table "$img" | head -40
done < /tmp/trivy-targets.txt
```

- 判定: CRITICAL（fix あり）が 1 件以上 → High。HIGH のみ → Medium。
- private ECR イメージは `aws ecr get-login-password` 相当の認証がないと pull できないので失敗する。失敗は Notes に「未スキャン」と記録し、公開イメージ側のベースイメージ版数で代替判断する。
- **DB 取得の既知問題（2026-10-07 確認）**: trivy 0.75 の既定 DB ソース先頭 `mirror.gcr.io` が codex-workspace から到達不能（TCP timeout）で、`failed to download vulnerability DB` になる。`--db-repository ghcr.io/aquasecurity/trivy-db:2`（必要なら `--java-db-repository ghcr.io/aquasecurity/trivy-java-db:1`）を付けると ghcr.io から取得できる。環境変数 `TRIVY_DB_REPOSITORY=ghcr.io/aquasecurity/trivy-db:2` でも同じ。
- それでも DB 更新が失敗する場合: 別環境で `trivy image --download-db-only --cache-dir /tmp/trivy-cache` を実行し、`/tmp/trivy-cache` をコピーしてから `trivy image --skip-db-update --cache-dir /tmp/trivy-cache ...` を使う。
- `trivy k8s`: codex-workspace の RBAC は read-only で `kubectl get` 相当の権限はあるため `trivy k8s --report summary --include-namespaces argocd,monitoring` は動くが、node 収集（node-collector Job 作成）には権限がない。`--disable-node-collection` を付ける。
- `trivy config`: IaC の設定ミス検出。`cd boxp/arch && trivy config --severity HIGH,CRITICAL terraform/`、`cd boxp/lolice && trivy config --severity HIGH,CRITICAL argoproj/`。結果は Medium 扱いで Notes に件数だけ記録する。

### 2.4 ノード OS / kernel

```bash
# ノード kernel は §1 に出る。KEV の Linux kernel 追加分を確認する
curl -fsSL https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json \
  | jq -r '.vulnerabilities[] | select(.vendorProject=="Linux") | select(.dateAdded >= "'$(date -d '-35 days' +%Y-%m-%d)'") | [.cveID,.dateAdded,.shortDescription]|@tsv'
```

- 該当 CVE が稼働 kernel（Ubuntu 22.04: 5.15.x、24.04: 6.8.x、Armbian noble: 6.12.x）に影響するかは Ubuntu Security Tracker（`https://ubuntu.com/security/CVE-XXXX-YYYY`）で確認する。影響あり・未修正なら High。
- apt 更新状況は `cd boxp/arch/ansible && uv run ansible all -m shell -a "apt list --upgradable 2>/dev/null | grep -c security"` 相当で確認する（codex-workspace からノードへの SSH 経路がない場合は boxp に依頼し Notes に「未確認」と記録）。

### 2.5 kube-bench について（判断記録）

- kube-bench は control-plane（shanghai-1/2/3, arm64）上で `hostPID: true` + `/etc/kubernetes` の hostPath mount を持つ Job として動かす必要がある。codex-workspace の ServiceAccount は Job 作成権限を持たず、PSA `privileged` の namespace も必要になるため、**月次診断の自動実行経路には導入しない**（2026-10-07 判断）。
- 代替として §2 の kube-apiserver flags チェックリストをスクリプトに組み込んだ。年次で boxp が手動で `kube-bench run --targets master` を実行する場合は、結果の summary のみ診断チケット Notes に貼る。

### 2.6 結果の記録

1. レポート本体は chat/ログに全文を貼らず、各セクションの件数と High 以上の項目だけを診断チケット Notes に記録する。
2. 前月ベースライン（`docs/project_docs/BOXP-217/baseline-YYYY-MM.md` または前月診断チケットの Notes）との差分（増えた露出 Service、増えた privileged Pod、新しい GHSA/KEV）を書く。
3. Critical/High は §1 の起票ルールで個別チケットにし、チケット ID を Notes に残す。
4. 月次レポートをリポジトリに残したい場合は `docs/project_docs/BOXP-217/baseline-YYYY-MM.md` として PR を出す。

## 3. ログに含めてはいけない情報

| 記録してよい | 記録してはいけない |
| --- | --- |
| image repo / tag / digest、CVE / GHSA ID、namespace 名、Service 名と port 番号、terraform ディレクトリ名、ノード名と kernel 版 | Secret 本文・`kubectl get secret -o yaml` の出力、Cloudflare Tunnel token / Access service token、Tailscale auth key / OAuth client、`kubeconfig`、AWS credential |
| apiserver flag の値（path やモード名） | ノード内部 IP の一覧（スクリプトは出力しない。`kubectl get nodes -o wide` を貼らない） |
| Dependabot alert の package / CVE / manifest path | ECR のアカウント ID を含む image URL は public な Notes/PR に貼る前にアカウント ID 部分をマスクする |
| trivy の CVE 件数と CVE ID | trivy の `--format json` 全文（パッケージ全列挙が長いだけでなく内部パスを含む） |

迷ったら「GitHub の public repo に書いても問題ないか」で判断する。vault はプライベートだが、PR（boxp/arch は public）に含める baseline は上記に従う。

## 4. 参照

- 元チケット: BOXP-217
- Recurring Event: vault `Infrastructure/Recurring Events/Events/monthly-security-audit.md`
- スクリプト: `scripts/security-audit/security_audit.bb`
- 初回ベースライン: `docs/project_docs/BOXP-217/baseline-2026-10.md`
- 関連: BOXP-177（etcd metrics 公開の修正）、BOXP-200（Tailscale credential 棚卸し）、BOXP-190（Kubernetes upgrade planning）
