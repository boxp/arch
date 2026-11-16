# BOXP-207: 未実行 apply の棚卸し

2026-10-01 11:30 UTC 時点。GitHub API の read-only 照会と git の履歴だけで作成した。terraform plan は実行していない。

## 数え方

- 対象は 2026-07-30 以降の `apply` run のうち実行されなかったもの 501 件（`action_required` 224 件、jobs 0 件の `failure` 277 件）。
- 各 run の head commit が変更したファイルから tfaction target（`tfaction.yaml` のあるディレクトリ）を割り出した。`apps/lolice-member-portal/**` は `tfaction-root.yaml` の `test_workflow` に従い `terraform/cloudflare/b0xp.io/lolice-member-portal` として数えた。
- target を 1 つも変更していない run は 108 件で、実行されていても apply 対象がない。残り 393 件が延べ 415 target を変更していた。
- 「カバー済み」は、未実行 run より後に、同じ target を変更した commit の `apply` run が success していることを指す。tfaction の apply は PR の plan（その時点の設定全体と実環境の差分）を適用するので、後続の apply が成功していれば、それ以前の未適用分も一緒に適用されている。ただし後続 PR の branch が未適用の commit を取り込む前に plan されていた場合は当てはまらないため、厳密な確認には fresh plan が必要になる。
- 「未カバー」は、未実行 run の後にその target の apply がまだ成功していないもの。

## 結果

- 40 target のうち 23 target はカバー済み。
- 17 target・81 件が未カバー。内容はすべて次のいずれかで、リソース定義の変更は 0 件だった。
  - aqua のツール更新（`aqua/` 配下のみ。terraform 本体や aqua-registry のバージョン）
  - provider のバージョン更新（`.terraform.lock.hcl` と `required_providers` の version）
  - follow-up PR の marker（#12474 の `.tfaction/failed-prs`。元の #12468 は 2026-08-20 の apply 失敗で、同 target は 2026-08-30 に apply が成功している）
- したがって、実 apply が必要と判断できるものは見つからなかった。未カバー分は「no-op 見込み」であり、fresh plan での確認はしていない。確認したい場合は [runbook](runbook.md) の「過去の未実行 run の扱い」に従う。

## target ごとの集計

「未実行 run 数」は 2026-07-30 以降の合計。「※」は aqua と lockfile 以外のファイルを含む変更で、内訳は下の一覧を参照。

| target | 未実行 run 数 | 未カバー | 未カバー分の内容 | 最後に成功した apply | 判定 |
| --- | --- | --- | --- | --- | --- |
| `terraform/aws/ark-ascended-server` | 11 | 6 | ツール更新(aqua) lockfile  | 2026-08-29 | no-op 見込み |
| `terraform/aws/ark-discord-bot` | 11 | 6 | ツール更新(aqua) lockfile  | 2026-08-29 | no-op 見込み |
| `terraform/aws/codex-workspace` | 11 | 6 | ツール更新(aqua) lockfile  | 2026-08-29 | no-op 見込み |
| `terraform/aws/even-g2-lab` | 11 | 6 | ツール更新(aqua) lockfile  | 2026-08-29 | no-op 見込み |
| `terraform/aws/external-secrets-operator` | 11 | 6 | ツール更新(aqua) lockfile  | 2026-08-29 | no-op 見込み |
| `terraform/aws/github-actions-ansible` | 11 | 6 | ツール更新(aqua) lockfile  | 2026-08-29 | no-op 見込み |
| `terraform/aws/gpu-worker-images` | 11 | 6 | ツール更新(aqua) lockfile  | 2026-08-29 | no-op 見込み |
| `terraform/aws/hitohub/prod` | 12 | 7 | ※ ツール更新(aqua) lockfile  | 2026-08-30 | no-op 見込み |
| `terraform/aws/hitohub/stage` | 11 | 6 | ツール更新(aqua) lockfile  | 2026-08-30 | no-op 見込み |
| `terraform/aws/k8s-ecr-token-updater` | 10 | 0 | - | 2026-10-01 | カバー済み |
| `terraform/aws/longhorn` | 9 | 0 | - | 2026-10-01 | カバー済み |
| `terraform/aws/openclaw` | 10 | 0 | - | 2026-10-01 | カバー済み |
| `terraform/aws/orange-pi-images` | 11 | 0 | - | 2026-10-01 | カバー済み |
| `terraform/aws/palserver` | 10 | 0 | - | 2026-10-01 | カバー済み |
| `terraform/aws/tfaction` | 11 | 0 | - | 2026-10-01 | カバー済み |
| `terraform/aws/users` | 10 | 0 | - | 2026-10-01 | カバー済み |
| `terraform/cloudflare/b0xp.io/argocd` | 13 | 0 | - | 2026-10-01 | カバー済み |
| `terraform/cloudflare/b0xp.io/bastion` | 13 | 0 | - | 2026-10-01 | カバー済み |
| `terraform/cloudflare/b0xp.io/codex-workspace` | 11 | 0 | - | 2026-10-01 | カバー済み |
| `terraform/cloudflare/b0xp.io/even-g2-lab` | 12 | 0 | - | 2026-10-01 | カバー済み |
| `terraform/cloudflare/b0xp.io/grafana` | 14 | 0 | - | 2026-10-01 | カバー済み |
| `terraform/cloudflare/b0xp.io/hermes-agent` | 12 | 0 | - | 2026-10-01 | カバー済み |
| `terraform/cloudflare/b0xp.io/hitohub/prod` | 12 | 0 | - | 2026-10-01 | カバー済み |
| `terraform/cloudflare/b0xp.io/hitohub/stage` | 12 | 0 | - | 2026-10-01 | カバー済み |
| `terraform/cloudflare/b0xp.io/k8s` | 10 | 6 | ツール更新(aqua) lockfile ※  | 2026-08-30 | no-op 見込み |
| `terraform/cloudflare/b0xp.io/kubernetes-dashboard` | 12 | 0 | - | 2026-10-01 | カバー済み |
| `terraform/cloudflare/b0xp.io/lolice-member-portal` | 10 | 0 | - | 2026-10-01 | カバー済み |
| `terraform/cloudflare/b0xp.io/longhorn` | 12 | 0 | - | 2026-10-01 | カバー済み |
| `terraform/cloudflare/b0xp.io/minecraft` | 13 | 0 | - | 2026-10-01 | カバー済み |
| `terraform/cloudflare/b0xp.io/moltworker` | 8 | 4 | ツール更新(aqua)  | 2026-08-30 | no-op 見込み |
| `terraform/cloudflare/b0xp.io/openclaw` | 11 | 0 | - | 2026-10-01 | カバー済み |
| `terraform/cloudflare/b0xp.io/portfolio` | 8 | 4 | ツール更新(aqua)  | 2026-08-30 | no-op 見込み |
| `terraform/cloudflare/b0xp.io/prometheus-operator` | 9 | 0 | - | 2026-10-01 | カバー済み |
| `terraform/cloudflare/b0xp.io/stable-diffusion` | 10 | 0 | - | 2026-10-01 | カバー済み |
| `terraform/cloudflare/b0xp.io/video-rotator` | 7 | 3 | ツール更新(aqua)  | 2026-08-29 | no-op 見込み |
| `terraform/cloudflare/boxp.tk` | 7 | 3 | ツール更新(aqua)  | 2026-08-29 | no-op 見込み |
| `terraform/cloudflare/boxp.tk/hitohub/prod` | 6 | 2 | ツール更新(aqua)  | 2026-08-29 | no-op 見込み |
| `terraform/cloudflare/boxp.tk/hitohub/stage` | 7 | 2 | ツール更新(aqua)  | 2026-08-29 | no-op 見込み |
| `terraform/cloudflare/boxp.tk/portfolio` | 7 | 2 | ツール更新(aqua)  | 2026-08-29 | no-op 見込み |
| `terraform/tailscale/lolice` | 8 | 0 | - | 2026-10-01 | カバー済み |

## 未カバーの run 一覧

| target | run 作成 (UTC) | 表示 | PR | 内容 |
| --- | --- | --- | --- | --- |
| `terraform/aws/ark-ascended-server` | 2026-09-08T07:53 | [action_required](https://github.com/boxp/arch/actions/runs/34201651698) | #12794 | dependency hashicorp/terraform to v1.16.1 |
| `terraform/aws/ark-ascended-server` | 2026-09-08T20:18 | [action_required](https://github.com/boxp/arch/actions/runs/34274008553) | #12829 | dependency aquaproj/aqua-registry to v4.558.1 |
| `terraform/aws/ark-ascended-server` | 2026-09-10T13:39 | [action_required](https://github.com/boxp/arch/actions/runs/34484006866) | #12870 | dependency aquaproj/aqua-registry to v4.559.0 |
| `terraform/aws/ark-ascended-server` | 2026-09-29T05:02 | [action_required](https://github.com/boxp/arch/actions/runs/36524342480) | #12913 | dependency hashicorp/terraform to v1.16.4 |
| `terraform/aws/ark-ascended-server` | 2026-09-30T02:11 | [failure (jobs 0)](https://github.com/boxp/arch/actions/runs/36658679361) | #12987 | dependency aquaproj/aqua-registry to v4.569.0 |
| `terraform/aws/ark-ascended-server` | 2026-10-01T04:54 | [action_required](https://github.com/boxp/arch/actions/runs/36817255371) | #13054 | terraform aws to v6.66.0 |
| `terraform/aws/ark-discord-bot` | 2026-09-08T11:03 | [action_required](https://github.com/boxp/arch/actions/runs/34218696274) | #12795 | dependency hashicorp/terraform to v1.16.1 |
| `terraform/aws/ark-discord-bot` | 2026-09-08T20:21 | [action_required](https://github.com/boxp/arch/actions/runs/34274299021) | #12830 | dependency aquaproj/aqua-registry to v4.558.1 |
| `terraform/aws/ark-discord-bot` | 2026-09-10T13:42 | [action_required](https://github.com/boxp/arch/actions/runs/34484320126) | #12871 | dependency aquaproj/aqua-registry to v4.559.0 |
| `terraform/aws/ark-discord-bot` | 2026-09-29T05:08 | [action_required](https://github.com/boxp/arch/actions/runs/36524785061) | #12914 | dependency hashicorp/terraform to v1.16.4 |
| `terraform/aws/ark-discord-bot` | 2026-09-30T03:28 | [action_required](https://github.com/boxp/arch/actions/runs/36664541428) | #12988 | dependency aquaproj/aqua-registry to v4.569.0 |
| `terraform/aws/ark-discord-bot` | 2026-10-01T06:22 | [action_required](https://github.com/boxp/arch/actions/runs/36824474354) | #13056 | terraform aws to v6.66.0 |
| `terraform/aws/codex-workspace` | 2026-09-08T11:04 | [action_required](https://github.com/boxp/arch/actions/runs/34218737543) | #12796 | dependency hashicorp/terraform to v1.16.1 |
| `terraform/aws/codex-workspace` | 2026-09-08T20:21 | [action_required](https://github.com/boxp/arch/actions/runs/34274303985) | #12831 | dependency aquaproj/aqua-registry to v4.558.1 |
| `terraform/aws/codex-workspace` | 2026-09-10T13:42 | [action_required](https://github.com/boxp/arch/actions/runs/34484334708) | #12872 | dependency aquaproj/aqua-registry to v4.559.0 |
| `terraform/aws/codex-workspace` | 2026-09-29T05:13 | [action_required](https://github.com/boxp/arch/actions/runs/36525173229) | #12915 | dependency hashicorp/terraform to v1.16.4 |
| `terraform/aws/codex-workspace` | 2026-09-30T03:28 | [action_required](https://github.com/boxp/arch/actions/runs/36664579987) | #12989 | dependency aquaproj/aqua-registry to v4.569.0 |
| `terraform/aws/codex-workspace` | 2026-10-01T06:23 | [action_required](https://github.com/boxp/arch/actions/runs/36824498839) | #13057 | terraform aws to v6.66.0 |
| `terraform/aws/even-g2-lab` | 2026-09-08T11:04 | [action_required](https://github.com/boxp/arch/actions/runs/34218728709) | #12797 | dependency hashicorp/terraform to v1.16.1 |
| `terraform/aws/even-g2-lab` | 2026-09-08T20:21 | [action_required](https://github.com/boxp/arch/actions/runs/34274341409) | #12832 | dependency aquaproj/aqua-registry to v4.558.1 |
| `terraform/aws/even-g2-lab` | 2026-09-10T13:46 | [action_required](https://github.com/boxp/arch/actions/runs/34484795006) | #12873 | dependency aquaproj/aqua-registry to v4.559.0 |
| `terraform/aws/even-g2-lab` | 2026-09-29T05:18 | [action_required](https://github.com/boxp/arch/actions/runs/36525539139) | #12916 | dependency hashicorp/terraform to v1.16.4 |
| `terraform/aws/even-g2-lab` | 2026-09-30T03:28 | [action_required](https://github.com/boxp/arch/actions/runs/36664562744) | #12991 | dependency aquaproj/aqua-registry to v4.569.0 |
| `terraform/aws/even-g2-lab` | 2026-10-01T06:23 | [action_required](https://github.com/boxp/arch/actions/runs/36824501842) | #13058 | terraform aws to v6.66.0 |
| `terraform/aws/external-secrets-operator` | 2026-09-08T11:04 | [action_required](https://github.com/boxp/arch/actions/runs/34218766242) | #12798 | dependency hashicorp/terraform to v1.16.1 |
| `terraform/aws/external-secrets-operator` | 2026-09-08T20:21 | [action_required](https://github.com/boxp/arch/actions/runs/34274325302) | #12833 | dependency aquaproj/aqua-registry to v4.558.1 |
| `terraform/aws/external-secrets-operator` | 2026-09-10T13:47 | [action_required](https://github.com/boxp/arch/actions/runs/34484807044) | #12874 | dependency aquaproj/aqua-registry to v4.559.0 |
| `terraform/aws/external-secrets-operator` | 2026-09-29T05:23 | [action_required](https://github.com/boxp/arch/actions/runs/36525960545) | #12917 | dependency hashicorp/terraform to v1.16.4 |
| `terraform/aws/external-secrets-operator` | 2026-09-30T03:29 | [action_required](https://github.com/boxp/arch/actions/runs/36664591554) | #12992 | dependency aquaproj/aqua-registry to v4.569.0 |
| `terraform/aws/external-secrets-operator` | 2026-10-01T06:23 | [action_required](https://github.com/boxp/arch/actions/runs/36824554391) | #13059 | terraform aws to v6.66.0 |
| `terraform/aws/github-actions-ansible` | 2026-09-08T11:04 | [action_required](https://github.com/boxp/arch/actions/runs/34218798332) | #12799 | dependency hashicorp/terraform to v1.16.1 |
| `terraform/aws/github-actions-ansible` | 2026-09-09T02:04 | [action_required](https://github.com/boxp/arch/actions/runs/34301720699) | #12834 | dependency aquaproj/aqua-registry to v4.558.1 |
| `terraform/aws/github-actions-ansible` | 2026-09-10T13:47 | [action_required](https://github.com/boxp/arch/actions/runs/34484851160) | #12875 | dependency aquaproj/aqua-registry to v4.559.0 |
| `terraform/aws/github-actions-ansible` | 2026-09-29T05:29 | [action_required](https://github.com/boxp/arch/actions/runs/36526403160) | #12918 | dependency hashicorp/terraform to v1.16.4 |
| `terraform/aws/github-actions-ansible` | 2026-09-30T03:29 | [action_required](https://github.com/boxp/arch/actions/runs/36664610158) | #12993 | dependency aquaproj/aqua-registry to v4.569.0 |
| `terraform/aws/github-actions-ansible` | 2026-10-01T06:23 | [action_required](https://github.com/boxp/arch/actions/runs/36824546849) | #13060 | terraform aws to v6.66.0 |
| `terraform/aws/gpu-worker-images` | 2026-09-08T11:04 | [action_required](https://github.com/boxp/arch/actions/runs/34218759099) | #12800 | dependency hashicorp/terraform to v1.16.1 |
| `terraform/aws/gpu-worker-images` | 2026-09-09T02:04 | [action_required](https://github.com/boxp/arch/actions/runs/34301713076) | #12835 | dependency aquaproj/aqua-registry to v4.558.1 |
| `terraform/aws/gpu-worker-images` | 2026-09-10T13:51 | [action_required](https://github.com/boxp/arch/actions/runs/34485326833) | #12876 | dependency aquaproj/aqua-registry to v4.559.0 |
| `terraform/aws/gpu-worker-images` | 2026-09-29T05:34 | [action_required](https://github.com/boxp/arch/actions/runs/36526781650) | #12919 | dependency hashicorp/terraform to v1.16.4 |
| `terraform/aws/gpu-worker-images` | 2026-09-30T03:29 | [action_required](https://github.com/boxp/arch/actions/runs/36664599862) | #12994 | dependency aquaproj/aqua-registry to v4.569.0 |
| `terraform/aws/gpu-worker-images` | 2026-10-01T06:23 | [action_required](https://github.com/boxp/arch/actions/runs/36824560814) | #13061 | terraform aws to v6.66.0 |
| `terraform/aws/hitohub/prod` | 2026-09-08T11:10 | [action_required](https://github.com/boxp/arch/actions/runs/34219275517) | #12474 | follow-up PR の marker（`.tfaction/failed-prs`） |
| `terraform/aws/hitohub/prod` | 2026-09-08T11:14 | [action_required](https://github.com/boxp/arch/actions/runs/34219681414) | #12801 | dependency hashicorp/terraform to v1.16.1 |
| `terraform/aws/hitohub/prod` | 2026-09-09T02:04 | [action_required](https://github.com/boxp/arch/actions/runs/34301767399) | #12836 | dependency aquaproj/aqua-registry to v4.558.1 |
| `terraform/aws/hitohub/prod` | 2026-09-10T13:51 | [action_required](https://github.com/boxp/arch/actions/runs/34485322921) | #12877 | dependency aquaproj/aqua-registry to v4.559.0 |
| `terraform/aws/hitohub/prod` | 2026-09-29T05:40 | [action_required](https://github.com/boxp/arch/actions/runs/36527264225) | #12920 | dependency hashicorp/terraform to v1.16.4 |
| `terraform/aws/hitohub/prod` | 2026-09-30T03:29 | [action_required](https://github.com/boxp/arch/actions/runs/36664605991) | #12995 | dependency aquaproj/aqua-registry to v4.569.0 |
| `terraform/aws/hitohub/prod` | 2026-10-01T06:24 | [action_required](https://github.com/boxp/arch/actions/runs/36824574574) | #13062 | terraform aws to v6.66.0 |
| `terraform/aws/hitohub/stage` | 2026-09-08T11:15 | [action_required](https://github.com/boxp/arch/actions/runs/34219719910) | #12802 | dependency hashicorp/terraform to v1.16.1 |
| `terraform/aws/hitohub/stage` | 2026-09-09T02:04 | [action_required](https://github.com/boxp/arch/actions/runs/34301722681) | #12837 | dependency aquaproj/aqua-registry to v4.558.1 |
| `terraform/aws/hitohub/stage` | 2026-09-10T22:48 | [action_required](https://github.com/boxp/arch/actions/runs/34539259991) | #12878 | dependency aquaproj/aqua-registry to v4.559.0 |
| `terraform/aws/hitohub/stage` | 2026-09-29T05:46 | [action_required](https://github.com/boxp/arch/actions/runs/36527720041) | #12921 | dependency hashicorp/terraform to v1.16.4 |
| `terraform/aws/hitohub/stage` | 2026-09-30T03:33 | [action_required](https://github.com/boxp/arch/actions/runs/36664948462) | #12996 | dependency aquaproj/aqua-registry to v4.569.0 |
| `terraform/aws/hitohub/stage` | 2026-10-01T06:24 | [action_required](https://github.com/boxp/arch/actions/runs/36824610308) | #13063 | terraform aws to v6.66.0 |
| `terraform/cloudflare/b0xp.io/k8s` | 2026-09-08T16:06 | [action_required](https://github.com/boxp/arch/actions/runs/34248966463) | #12817 | dependency hashicorp/terraform to v1.16.1 |
| `terraform/cloudflare/b0xp.io/k8s` | 2026-09-09T18:31 | [action_required](https://github.com/boxp/arch/actions/runs/34389521587) | #12854 | dependency aquaproj/aqua-registry to v4.558.1 |
| `terraform/cloudflare/b0xp.io/k8s` | 2026-09-11T20:40 | [action_required](https://github.com/boxp/arch/actions/runs/34645469664) | #12894 | dependency aquaproj/aqua-registry to v4.559.0 |
| `terraform/cloudflare/b0xp.io/k8s` | 2026-09-29T19:09 | [failure (jobs 0)](https://github.com/boxp/arch/actions/runs/36617253809) | #12947 | dependency hashicorp/terraform to v1.16.4 |
| `terraform/cloudflare/b0xp.io/k8s` | 2026-09-29T22:11 | [failure (jobs 0)](https://github.com/boxp/arch/actions/runs/36638100093) | #12965 | terraform random to v3.9.1 |
| `terraform/cloudflare/b0xp.io/k8s` | 2026-09-30T05:31 | [action_required](https://github.com/boxp/arch/actions/runs/36673767680) | #13013 | dependency aquaproj/aqua-registry to v4.569.0 |
| `terraform/cloudflare/b0xp.io/moltworker` | 2026-09-08T16:12 | [action_required](https://github.com/boxp/arch/actions/runs/34249629095) | #12822 | dependency hashicorp/terraform to v1.16.1 |
| `terraform/cloudflare/b0xp.io/moltworker` | 2026-09-09T18:35 | [action_required](https://github.com/boxp/arch/actions/runs/34389984761) | #12859 | dependency aquaproj/aqua-registry to v4.558.1 |
| `terraform/cloudflare/b0xp.io/moltworker` | 2026-09-29T19:10 | [failure (jobs 0)](https://github.com/boxp/arch/actions/runs/36617311122) | #12952 | dependency hashicorp/terraform to v1.16.4 |
| `terraform/cloudflare/b0xp.io/moltworker` | 2026-09-30T05:31 | [action_required](https://github.com/boxp/arch/actions/runs/36673799383) | #13018 | dependency aquaproj/aqua-registry to v4.569.0 |
| `terraform/cloudflare/b0xp.io/portfolio` | 2026-09-08T20:17 | [action_required](https://github.com/boxp/arch/actions/runs/34273954160) | #12824 | dependency hashicorp/terraform to v1.16.1 |
| `terraform/cloudflare/b0xp.io/portfolio` | 2026-09-10T00:58 | [action_required](https://github.com/boxp/arch/actions/runs/34423559280) | #12861 | dependency aquaproj/aqua-registry to v4.558.1 |
| `terraform/cloudflare/b0xp.io/portfolio` | 2026-09-29T19:15 | [failure (jobs 0)](https://github.com/boxp/arch/actions/runs/36617906626) | #12954 | dependency hashicorp/terraform to v1.16.4 |
| `terraform/cloudflare/b0xp.io/portfolio` | 2026-09-30T09:40 | [action_required](https://github.com/boxp/arch/actions/runs/36697648356) | #13022 | dependency aquaproj/aqua-registry to v4.569.0 |
| `terraform/cloudflare/b0xp.io/video-rotator` | 2026-09-29T10:13 | [failure (jobs 0)](https://github.com/boxp/arch/actions/runs/36554253175) | #12944 | dependency aquaproj/aqua-registry to v4.568.0 |
| `terraform/cloudflare/b0xp.io/video-rotator` | 2026-09-30T09:41 | [action_required](https://github.com/boxp/arch/actions/runs/36697678099) | #13025 | dependency aquaproj/aqua-registry to v4.569.0 |
| `terraform/cloudflare/b0xp.io/video-rotator` | 2026-09-30T10:15 | [action_required](https://github.com/boxp/arch/actions/runs/36701281107) | #13035 | dependency hashicorp/terraform to v1.16.4 |
| `terraform/cloudflare/boxp.tk` | 2026-09-29T09:29 | [action_required](https://github.com/boxp/arch/actions/runs/36549490550) | #12925 | dependency aquaproj/aqua-registry to v4.568.0 |
| `terraform/cloudflare/boxp.tk` | 2026-09-30T09:41 | [action_required](https://github.com/boxp/arch/actions/runs/36697699501) | #13026 | dependency aquaproj/aqua-registry to v4.569.0 |
| `terraform/cloudflare/boxp.tk` | 2026-09-30T10:15 | [action_required](https://github.com/boxp/arch/actions/runs/36701251387) | #13036 | dependency hashicorp/terraform to v1.16.4 |
| `terraform/cloudflare/boxp.tk/hitohub/prod` | 2026-09-30T09:42 | [action_required](https://github.com/boxp/arch/actions/runs/36697797767) | #13027 | dependency aquaproj/aqua-registry to v4.569.0 |
| `terraform/cloudflare/boxp.tk/hitohub/prod` | 2026-09-30T10:15 | [action_required](https://github.com/boxp/arch/actions/runs/36701330463) | #13037 | dependency hashicorp/terraform to v1.16.4 |
| `terraform/cloudflare/boxp.tk/hitohub/stage` | 2026-09-30T09:42 | [action_required](https://github.com/boxp/arch/actions/runs/36697807194) | #13028 | dependency aquaproj/aqua-registry to v4.569.0 |
| `terraform/cloudflare/boxp.tk/hitohub/stage` | 2026-09-30T10:15 | [action_required](https://github.com/boxp/arch/actions/runs/36701337505) | #13038 | dependency hashicorp/terraform to v1.16.4 |
| `terraform/cloudflare/boxp.tk/portfolio` | 2026-09-30T09:41 | [action_required](https://github.com/boxp/arch/actions/runs/36697757537) | #13029 | dependency aquaproj/aqua-registry to v4.569.0 |
| `terraform/cloudflare/boxp.tk/portfolio` | 2026-09-30T10:15 | [action_required](https://github.com/boxp/arch/actions/runs/36701306958) | #13039 | dependency hashicorp/terraform to v1.16.4 |
