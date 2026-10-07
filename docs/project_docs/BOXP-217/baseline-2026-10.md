# BOXP-217 初回セキュリティ診断ベースライン（2026-10）

- 実施日: 2026-10-07（codex-workspace、claude-fable）
- 実行: `bb scripts/security-audit/security_audit.bb --out /tmp/report.md --images-out /tmp/images.txt`（KEV feed 2026-10-04 版、1734 entries）。codex review 指摘（収集失敗の fail-fast、全稼働タグ評価、GHSA 取得失敗の明示、vulnerable range 解釈）を反映した版で再実行し、判定結果は同じ
- 本書は runbook §3 の線引きに従い、Secret / credential / ノード内部 IP / ECR アカウント ID を含めない。

## 判定サマリ

| 緊急度 | 項目 | 対応 |
| --- | --- | --- |
| **Critical** | Argo CD repo-server / redis / server の NetworkPolicy を lolice が `$patch: delete` で削除したまま `v3.5.4` を稼働。CVE-2026-15416（repo-server `GenerateManifest` 無認証 RCE、2026-07-14 公開）の upstream 公式緩和策が未適用。KEV は未掲載だが「無認証到達可能な RCE」の基準で Critical | **BOXP-218** 起票（repo boxp/lolice, priority high） |
| **High** | boxp/arch Dependabot high 2 件: ansible-core CVE-2026-11332（`ansible/uv.lock`）、source-map-js CVE-2026-93749（`apps/video-rotator`）。medium 1 件: ansible CVE-2025-14010 | **BOXP-219** 起票（repo boxp/arch, priority high） |
| **High** | `cloudflare/cloudflared:latest` が argocd/cloudflared-api と boxp-home/cloudflared の 2 件。加えて longhorn-system は非公式タグ `1517-bb29a0e19437`、argocd の 2 Deployment に NET_ADMIN 付与 | **BOXP-220** 起票（repo boxp/lolice, priority high） |
| High→Medium | `default` ns に `kubectl debug node` の残骸 `node-debugger-*` Pod 5 件（hostNetwork/hostPID/hostIPC/hostPath、2026-06-30 / 07-04 作成、phase Failed）。Failed で実行中ではないため実害は低いが、host 権限を持つ Pod spec が残っている | 次回診断までに `kubectl delete pod -n default -l <node-debugger>` 相当で掃除する（BOXP-217 Notes に記録、boxp 対応） |
| Medium | Cloudflare Tunnel あり・Access application なしの terraform dir: `even-g2-lab`, `hitohub/prod`, `minecraft`。hitohub/prod は公開 Web サービス、minecraft はゲームサーバ（Access 非対応の TCP）で公開意図ありと推定。even-g2-lab は要確認 | Notes 記録。even-g2-lab の公開意図を boxp に確認し、意図なしなら High に格上げ |
| Medium | PSA enforce 未設定 namespace: Pod を持つ 27 ns（argocd, monitoring, prod/stage-hitohub, kube-dashboard, longhorn-system, palserver 等）。enforce ありは bastion / calico-* / codex-workspace / tailscale-operator / tigera-operator のみ | Notes 記録。露出 ns（hitohub, argocd, monitoring, kube-dashboard）から `warn`→`enforce baseline` を段階導入する方針を次回診断で再評価 |
| Medium | kube-apiserver: `--audit-log-path` / `--audit-policy-file` 未設定、`--enable-admission-plugins=NodeRestriction` のみ、`--allow-privileged=true`、`--encryption-provider-config` 未設定 | Notes 記録。BOXP-190（upgrade planning）で kubeadm ClusterConfiguration へ audit 設定を足す検討 |
| Medium | NetworkPolicy 未適用 namespace: Pod を持つ 27 ns（argocd / monitoring / calico 系以外すべて）。GlobalNetworkPolicy 0 件 | Notes 記録 |
| Medium | upstream 版遅れ: Longhorn v1.9.1（latest v1.13.0）、Kubernetes Dashboard API 1.3.0（api/v1.14.0）、Kong 3.6（3.9.3）、TiDB v7.5.1（v7.5.8、LTS 系列内）、Loki 3.4.2（v3.7.8）、Kubernetes v1.36.1（v1.37.1）、Grafana 13.2.2（v13.2.3）、Tailscale v1.102.4（v1.102.5）、Prometheus v3.14.0（v3.15.0） | Notes 記録。GHSA で稼働版に未修正の advisory は 0 件。TiDB / Kong はメジャー遅れのため追従方針を BOXP-217 Notes で決める |
| Medium | Argo CD: OutOfSync = arc-controller, descheduler, prometheus-operator, prometheus-operator-crd, reloader。Degraded = hermes-agent。Unknown = tidb-operator。ark-survival-ascended は status 無し | Notes 記録 |
| Low | digest 未固定 image 91 / 97（ユニーク） | 件数のみ記録 |

## n-day 照合結果（§0）

| component | running | upstream latest | GHSA affecting running | KEV 該当 |
| --- | --- | --- | --- | --- |
| Argo CD | v3.5.4 | v3.5.4 | 0 | なし（CVE-2026-15416 は GHSA 本体未登録・KEV 未掲載。argo-helm GHSA-47m3-95c7-g2g8 high として NetworkPolicy 不在を指摘） |
| Grafana | 13.2.2 | v13.2.3 | 0 | なし（KEV の CVE-2021-43798 / CVE-2021-39226 は 8.x で修正済み） |
| Longhorn manager | v1.9.1 | v1.13.0 | 0 | なし |
| cloudflared | 2026.10.0 / latest / 1517-bb29a0e19437 | 2026.10.0 | 0（GHSA 2 件は installer のローカル権限昇格で container には非該当） | なし |
| Tailscale operator / proxy | v1.102.4 | v1.102.5 | 0 | なし |
| Kubernetes Dashboard API | 1.3.0 | api/v1.14.0 | 0 | なし |
| Kong | 3.6 | 3.9.3 | 0 | なし |
| TiDB | v7.5.1 | v7.5.8 | 0 | なし |
| dex | v2.45.1 | v2.45.1 | 0（GHSA-7qjx-gp9h-65qj token-exchange endpoint の AllowedConnectors 未適用は patched_versions 無し。Argo CD の dex は token-exchange を使わないため影響なしと判断） | なし |
| kube-vip | v1.2.4 | v1.2.4 | 0 | なし |
| kube-apiserver | v1.36.1 | v1.37.1 | 0 | なし |
| Prometheus | v3.14.0 | v3.15.0 | 0 | なし |
| Loki | 3.4.2 | v3.7.8 | 0 | なし |

訂正: BOXP-217 Context では CVE-2026-42880 を repo-server RCE として記載していたが、GHSA-3v3m-wc6v-x4x3（CVE-2026-42880）および GHSA-c7mp-5hg2-gfh8（CVE-2026-43824）はいずれも ServerSideDiff 経由の Secret 平文露出で 3.2.11 / 3.3.9 修正済み。repo-server 無認証 RCE は CVE-2026-15416 で、v3.5.4 を含む全版で NetworkPolicy による緩和が前提。

Linux kernel: KEV に 2026-08〜09 で追加された kernel CVE（CVE-2026-53266, CVE-2025-39964, CVE-2025-39682, CVE-2026-53362）に対する稼働 kernel（golyat 5.15.0-181/185, 6.8.0-124、shanghai 6.12.35）の該当可否は未確認。runbook §2.4 の手順で次回から Ubuntu Security Tracker 照合を行う。apt security update 件数は codex-workspace からノードへの SSH 経路がなく未確認。

## クラスタ構成（§1〜2）

- Kubernetes v1.36.1（golyat-4 のみ v1.36.2）、CRI-O 1.36.1/1.36.2。ノード OS: golyat-1/2/3 Ubuntu 22.04.5（kernel 5.15.0-181/185）、golyat-4 Ubuntu 24.04.4（6.8.0-124）、shanghai-1/2/3 Armbian noble（6.12.35）。
- control-plane は shanghai-1/2/3（スクリプトの role 列は label 値が空のため初回は誤って worker 表示。修正済み）。
- kube-apiserver: `--authorization-mode=Node,RBAC`、`--enable-admission-plugins=NodeRestriction`、audit log / anonymous-auth / encryption-provider-config 未設定、`--allow-privileged=true`。

## 外部公開面（§3〜4）

- LAN LoadBalancer: ark-survival-ascended（7777/7778/27015 UDP, 27020 TCP）、codex-workspace（22, 3456 TCP, 60001 UDP）、kube-dashboard（443）、local-llm llama-server（8080）、monitoring grafana（80）、palserver / palserver-2（8211 UDP）。
- NodePort: even-g2-lab / prod-hitohub / stage-hitohub の cloudflared metrics（2000）、kube-dashboard kong manager（8002/8445）、prod/stage hitohub back-end（8080）/ frontend（3000）。
- Tailscale: argocd-server（loadBalancerClass tailscale）。
- cloudflared 稼働 ns: argocd, bastion, boxp-home, even-g2-lab, hermes-agent, k8s, kube-dashboard, longhorn-system, monitoring, stage-hitohub（prod-hitohub は NodePort 経由で別 ns から tunnel）。
- Tunnel terraform dir 13 件のうち Access application なし: even-g2-lab, hitohub/prod, minecraft。

## workload hardening（§5〜9）

- privileged / host* Pod（想定内）: calico-node / csi-node-driver / calico-typha、codex-workspace（docker dind）、intel-gpu-exporter / plugin、kube-system（etcd, apiserver, controller-manager, scheduler, kube-proxy, kube-vip-ds, local-volume-provisioner）、longhorn-system（manager, csi-*, instance-manager, engine-image, backup Job）、argocd cloudflared ×2（NET_ADMIN）、local-llm llama-server（hostPath）。想定外: default/node-debugger-* ×5。
- cluster-admin ClusterRoleBinding: `cluster-admin`（system:masters）、`kubeadm:cluster-admins`、`longhorn-support-bundle`（longhorn-system SA）。

## trivy image（露出イメージ 10 件、CRITICAL/HIGH、fix あり）

実行: `trivy image --skip-db-update --severity CRITICAL,HIGH --ignore-unfixed --scanners vuln`（DB は `--db-repository ghcr.io/aquasecurity/trivy-db:2` で取得。既定の mirror.gcr.io は到達不能だった）。

| image | CRITICAL (fix あり) | HIGH (fix あり) | CRITICAL の CVE |
| --- | --- | --- | --- |
| quay.io/argoproj/argocd:v3.5.4 | 2 | 113 | CVE-2025-68121 |
| docker.io/grafana/grafana:13.2.2 | 0 | 104 | - |
| docker.io/cloudflare/cloudflared:2026.10.0 | 0 | 2 | - |
| docker.io/cloudflare/cloudflared:latest | 0 | 2 | - |
| longhornio/longhorn-manager:v1.9.1 | 12 | 128 | CVE-2025-68121, CVE-2026-33186, SUSE-SU-2025:02536-1, SUSE-SU-2025:3676-1, SUSE-SU-2026:0309-1, SUSE-SU-2026:2076-1 |
| docker.io/kubernetesui/dashboard-api:1.3.0 | 2 | 46 | CVE-2024-24790, CVE-2025-68121 |
| kong:3.6 | 0 | 7 | - |
| pingcap/tidb:v7.5.1 | 3 | 253 | CVE-2024-24790, CVE-2025-68121, CVE-2026-33186 |
| ghcr.io/dexidp/dex:v2.45.1 | 5 | 128 | CVE-2025-68121, CVE-2026-31789, CVE-2026-33186 |
| tailscale/k8s-operator:v1.102.4 | 0 | 4 | - |

- 繰り返し出る CRITICAL は Go 標準ライブラリ / 依存ライブラリ由来: CVE-2025-68121（crypto/tls session resumption、GHSA 上は medium。trivy は NVD 評価で critical 表示）、CVE-2026-33186（gRPC-Go `:path` 先頭スラッシュ欠落による authz bypass）、CVE-2024-24790（net/netip IPv4-mapped）、CVE-2026-31789（OpenSSL OCTET STRING→hex 変換）。いずれも 2026-10-04 時点で KEV 未掲載。
- 判定: Argo CD は upstream latest（v3.5.4）でも CRITICAL が残るため、upstream のリリース待ち（Medium、`--ignore-unfixed` でも fix 有りと出るのは Go toolchain 更新待ち）。Longhorn v1.9.1 / TiDB v7.5.1 / dex / dashboard-api は **版数遅れ由来**で、上記「Medium: upstream 版遅れ」の追従で解消する想定。CRITICAL が稼働面で直接 exploitable かは個別評価が必要なため、初回は High ではなく Medium として Notes 記録とし、BOXP-220 / 次回診断で再評価する。
- 未スキャン: hitohub / ark / even-g2-lab の private ECR イメージ（認証なしで pull 不可）。ベースイメージの更新状況は lolice 側 Dockerfile で確認する。

## 次回（2026-11）診断での確認ポイント

1. BOXP-218 完了により argocd ns の NetworkPolicy が 9 件になっているか。
2. BOXP-220 完了により `:latest` が 0 件か。
3. node-debugger Pod が掃除されているか。
4. even-g2-lab tunnel の公開意図が確認されたか。
5. KEV に Argo CD / Grafana / cloudflared / Tailscale / Kubernetes が追加されていないか（スクリプト §0 の KEV 列）。
