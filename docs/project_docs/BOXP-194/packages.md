# BOXP-194 パッケージ候補・配布物の事前検証

検証日時: 2026-09-29 UTC。本番ホスト、ホスト APT 設定、cluster、workflow dispatch を変更せずに行った外部配布物の調査記録である。

## 結論

| 対象 | 現行設定 | 公式上流の v1.36 最新 patch | APT の厳密 revision |
| --- | --- | --- | --- |
| Kubernetes | `1.36.1` / `1.36.1-1.1` | `v1.36.5` | `1.36.5-1.1` |
| CRI-O | `1.36.1`（worker image は `1.36.1-1.1`） | `v1.36.6` | `1.36.6-3.1` |

Kubernetes と CRI-O の patch は一致しない。Kubernetes `1.36.5` と CRI-O `1.36.6` はそれぞれの v1.36 系最新 official release であり、同一 patch へ丸めてはならない。現行 `1.36.1` から変更するかは、互換性、本番 preflight、作業窓、復旧計画の承認後に決める。

上流 release の確認元は [Kubernetes releases](https://github.com/kubernetes/kubernetes/releases) と [CRI-O releases](https://github.com/cri-o/cri-o/releases) の GitHub API である。`tag_name` を v1.36 に限定して列挙し、降順先頭がそれぞれ [Kubernetes v1.36.5](https://github.com/kubernetes/kubernetes/releases/tag/v1.36.5) と [CRI-O v1.36.6](https://github.com/cri-o/cri-o/releases/tag/v1.36.6) であることを確認した。取得時刻は 2026-09-29T09:25:38Z UTC である。

## 署名済み APT 索引

| 配布元 | source | `InRelease` の署名鍵 fingerprint | 署名日時 (UTC) | 結果 |
| --- | --- | --- | --- | --- |
| Kubernetes | `https://pkgs.k8s.io/core:/stable:/v1.36/deb/` | `DE15B14486CD377B9E876E1A234654DA9A296436` | 2026-09-23 18:59:53 | `gpgv`: Good signature |
| CRI-O | `https://download.opensuse.org/repositories/isv:/cri-o:/stable:/v1.36/deb/` | `85B67D5C50100B1AC8CEFE49CBA9C85640A2B579` | 2026-09-22 08:40:51 | `gpgv`: Good signature |

各 `Release.key` を `gpg --dearmor` した一時 keyring と同じ配布元の `InRelease` を用い、`gpgv --keyring <keyring> <InRelease>` で検証した。索引取得には `APT_CONFIG` を先読みさせた一時 root（source、keyring、lists、cache、status を全て一時ディレクトリに指定）だけを使った。`/etc/apt`、`/var/lib/apt`、`/var/cache/apt`、dpkg database は変更していない。

取得時刻は 2026-09-29T09:25:38Z UTC。保存した配布物の SHA-256 は Kubernetes `InRelease`: `1b51686a90ff3c9e5101cb1f155cd2cf75e06fbc70e46074c1379dbeac910686`、CRI-O `InRelease`: `64d8e3b2450630aa2971ed4f00e4507160b0712146bcd7df7d952a66349313e5` である。APT が署名検証後に保存した圧縮 `Packages.lz4` は Kubernetes: `3300ac54588c75c4a7c373c9d956b7df96a6db503b3df24cd4f8e6d2dbb8ea7c`、CRI-O: `a2e852b71cb205e22ec19b446a79b484bc4c3d861ebd120a41f01a6bf12e413a` である。

## amd64 / arm64 の実解決とハッシュ

両 architecture について、上記の署名済み一時索引から exact revision を `apt-get download` し、実際に取得した `.deb` の SHA-256 と `dpkg-deb -f` の package/version/architecture を `Packages` 索引の fields と照合した。全 8 配布物が一致した。

| package | revision | amd64 SHA-256 | arm64 SHA-256 |
| --- | --- | --- | --- |
| kubeadm | `1.36.5-1.1` | `bbb6899335ca6890be4c007e10c66303f68281d342f2e7345db9c03cd5175da9` | `d08b7af27b50d539d91d9c5af69f73feff0e59455fe74d478e0a009cc2bdf260` |
| kubelet | `1.36.5-1.1` | `dd46254567ee60672c0737a4b5392fae7f3419a876ab6885c48178501ac2fd64` | `946ae8079938f6be46ec48ff317005d03c87de09a5b557627f348a11c080e0ef` |
| kubectl | `1.36.5-1.1` | `e633cdbcb535b0fdf8bd9aa643cfd0ad080889fddb6794d2af0bbaaf110e7956` | `65cdaa8817b252ef493768ba8976b292eccddcfd3d5e9b6d24bbb67ec58027fb` |
| cri-o | `1.36.6-3.1` | `eab2589f0e6ce4a2f64eec531932ef9f04b9e530233ce2d1cab0c451f6c00e66` | `f3331b9bf9a0de8d59d50b26efdfe37f6e91c33dabcf334455832f8010f3aafb` |

確認した `Filename` は各配布元の `amd64/` または `arm64/` 下の同名 `.deb` である。`cri-o` は `systemd-sysv`, `systemd`, `iptables`、`kubelet` は `kubernetes-cni (>= 1.2.0)`, `mount`, `util-linux`, `libc6` を要求する。

本番 OS 情報に合わせて、公式 Ubuntu archive と上記二つの署名済み external repository だけを一時 APT root に設定し、空の dpkg status で `apt-get --simulate install` を実行した。Jammy amd64（golyat-1〜3: Ubuntu 22.04.5）、Noble amd64（golyat-4: Ubuntu 24.04.4）、Noble arm64（shanghai-1〜3: Armbian-unofficial 25.08.0-trunk / Noble）の全 3 target で exit 0 となった。各 target で `cri-o=1.36.6-3.1`、`kubeadm/kubelet/kubectl=1.36.5-1.1`、`kubernetes-cni=1.9.1-1.1` が正しい architecture と release から解決された。arm64 binary を実行してはいない。

この solver は本番 package database、held package、`*-updates`、node 固有の third-party source、実インストール後の service 起動を再現しない。そのため base OS 依存の解決は確認済みだが、本番 installation の成功や runtime 互換性の根拠にはしない。

## kubeadm が選ぶ control-plane image と digest 状態

取得した amd64 `kubeadm_1.36.5-1.1_amd64.deb` を一時展開し、未インストールのまま `kubeadm config images list --kubernetes-version v1.36.5` を実行した。

```
registry.k8s.io/kube-apiserver:v1.36.5
registry.k8s.io/kube-controller-manager:v1.36.5
registry.k8s.io/kube-scheduler:v1.36.5
registry.k8s.io/kube-proxy:v1.36.5
registry.k8s.io/coredns/coredns:v1.14.2
registry.k8s.io/pause:3.10.2
registry.k8s.io/etcd:3.6.8-0
```

`registry.k8s.io` は manifest request を `asia-northeast1-docker.pkg.dev` へ 307 redirect したが、この環境から redirect 先への TCP connection が 30 秒で timeout した。Docker daemon は利用できるが Buildx は未導入で、`docker manifest inspect` も registry 接続を完了できなかった。独立して Google Artifact Registry の `us-central1` / `europe-west4` endpoint も connection timeout（5 秒、exit 28）だった。このため上記 7 image の manifest-list / per-architecture digest は未確認であり、digest pin の根拠にはできない。

`kubeadm` の候補 list に `etcd:3.6.8-0` が含まれても、稼働中の stacked etcd image を更新してよい根拠にはならない。今回の既存 role は `--etcd-upgrade=false` で etcd を保持する方針であり、候補 list の etcd tag はその方針と異なる自動更新対象ではない。現行 etcd image / digest、既存 snapshot、quorum 状態は本調査の対象外で未確認である。digest と etcd 方針の検証が完了するまで、image の変更や pull は行わない。

## 再現コマンドの要点

```bash
# 一時 root の apt.conf で Dir, source list, keyring, lists, cache, status を一時パスへ固定する。
APT_CONFIG="$tmp/apt.conf" apt-get -o APT::Architecture=amd64 update
APT_CONFIG="$tmp/apt.conf" apt-get -o APT::Architecture=arm64 update
( cd "$tmp/debs/amd64"; APT_CONFIG="$tmp/apt.conf" apt-get -o APT::Architecture=amd64 download kubeadm=1.36.5-1.1 kubelet=1.36.5-1.1 kubectl=1.36.5-1.1 cri-o=1.36.6-3.1 )
( cd "$tmp/debs/arm64"; APT_CONFIG="$tmp/apt.conf" apt-get -o APT::Architecture=arm64 download kubeadm=1.36.5-1.1 kubelet=1.36.5-1.1 kubectl=1.36.5-1.1 cri-o=1.36.6-3.1 )
for deb in "$tmp"/debs/*/*.deb; do
  sha256sum "$deb"
  dpkg-deb -f "$deb" Package Version Architecture
done
```

`apt-get download` は出力ファイル名が architecture を含むだけでなく同名 revision の上書きを避けるため、architecture ごとに別の作業 directory で実行する。

隔離solverは各target専用のsource/statusと `APT::Architecture` を指定して
`apt-get --simulate install kubeadm=1.36.5-1.1 kubelet=1.36.5-1.1 kubectl=1.36.5-1.1 cri-o=1.36.6-3.1`
を実行した。APT設定の無効化先 `etc/apt/-/` が存在しない警告は残るが、全3 targetのexitは0。
本記録の検証は配布物と空のpackage状態でのbase OS依存解決までであり、本番 dry-run、
package install、container pull、cluster 操作、snapshot / etcd 検証、workflow dispatch は行っていない。
