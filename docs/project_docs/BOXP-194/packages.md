# BOXP-194 パッケージ候補・配布物の事前検証

検証日時: 2026-09-29 UTC。本番ホスト、ホスト APT 設定、cluster、workflow dispatch を変更せずに行った外部配布物の調査記録である。

## 結論

| 対象 | 現行設定 | 公式上流の v1.36 最新 patch | APT の厳密 revision |
| --- | --- | --- | --- |
| Kubernetes | `1.36.1` / `1.36.1-1.1` | `v1.36.5` | `1.36.5-1.1` |
| CRI-O | `1.36.1`（worker image は `1.36.1-1.1`） | `v1.36.6` | `1.36.6-3.1` |

Kubernetes と CRI-O の patch は一致しない。Kubernetes `1.36.5` と CRI-O `1.36.6` はそれぞれの v1.36 系最新 official release であり、同一 patch へ丸めてはならない。現行 `1.36.1` から変更するかは、互換性、本番 preflight、作業窓、復旧計画の承認後に決める。

上流 release の確認元は [Kubernetes releases](https://github.com/kubernetes/kubernetes/releases) と [CRI-O releases](https://github.com/cri-o/cri-o/releases) の GitHub API である。`tag_name` を v1.36 に限定して列挙し、降順先頭がそれぞれ [Kubernetes v1.36.5](https://github.com/kubernetes/kubernetes/releases/tag/v1.36.5) と [CRI-O v1.36.6](https://github.com/cri-o/cri-o/releases/tag/v1.36.6) であることを確認した。取得時刻は 2026-09-29T09:25:38Z UTC である。

10:25 UTCに公式Git refとrelease APIを再確認した。Kubernetes `v1.36.5`のannotated tagは
`2bbef7e8ec09524ece1462001981a850e381b93f`、peeled commitは
`ad950d1cc78b0183c476bd4d3f1934c104229727`。CRI-O `v1.36.6`のtag/commitはそれぞれ
`a145eef01f2d3a17a29e606a208c9d672246d2aa` / `9209fd24af47bd91ffa36f0d47edb7729783be00`。
release APIのv1.36系先頭も同じtagだった。よって技術候補をKubernetes `1.36.5-1.1`、
CRI-O `1.36.6-3.1`へ固定する。ただし運用Goを意味せず、dispatch直前にも再確認する。

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

`registry.k8s.io` はCodex Podからのmanifest requestを`asia-northeast1-docker.pkg.dev`へ307 redirectしたが、
redirect先へのTCP connectionがtimeoutした。そこで実際にimageを消費するノードのCRI-O経路で
候補tagをpullし、`crictl inspecti`の`repoDigests`とimage IDを記録した。これはimage cacheへの
非破壊な追加であり、Pod再作成、manifest変更、control-plane更新は行っていない。

| image | 実解決arch | RepoDigests（index / architecture manifest。出力順はruntime依存） | image ID |
|---|---|---|---|
| kube-apiserver:v1.36.5 | arm64 | `4b3e69973a1d58d3c1f670d3477a9b9f14a03a271823113e8e0c9a333eb84f48`, `fd2aeee57db21e3e988ae7845dd549f8fdc036a3de985dc70aad4a69ad8ceb5a` | `54bb97b57920cdc06fcded2c46a3b29681ddf841602f9b1bb35c0c63c40c9029` |
| kube-controller-manager:v1.36.5 | arm64 | `15f8587dc75f4f473bcff3c514193f192924e1e087936556bec94b5c087a32c3`, `2d717af134451db77ea053c3426bc82edc0e55415eb36e1260313c636ebe9a4d` | `8e3df1f43fc0b1a788ab900fa25fe46c3470c86e6885346209656ed66978107e` |
| kube-scheduler:v1.36.5 | arm64 | `3804f66442962cefbe11fcd5330d5e7a797bfb3dc8535c322d005637b404a85f`, `a09834fd62d185544da5ab50c137af000a72b933098fbdda822d391df1566ea0` | `c92947fa85446661bd58f061bc43b86e7ec268e3c52c91bcdd684fbfbf771e8f` |
| kube-proxy:v1.36.5 | arm64 | `5f180e85f05b5b0949fc9d2886ca536c2aa8b8a3b8302b58e7d49c4a645f97a9`, `69a64a13f7159f977d9be0b63c915d1814edd281e2514d2a22bd9a5536237a0a` | `cb6ced62b0f2d15f4950756e2d42073e301a79a03ec6fa2e64015bf8a99d79d2` |
| kube-proxy:v1.36.5 | amd64 | `54f6c76e0413be01177617704c8b6e2c291a4ec2226a944216b62d5ac1d625df`, `5f180e85f05b5b0949fc9d2886ca536c2aa8b8a3b8302b58e7d49c4a645f97a9` | `a83c93aedd6acfab8933b1e95ad2f47ba024acb3f247919688f075cc992e23e3` |
| pause:3.10.2 | arm64 | `a433214620b407678934ebd69690a9ed6066247231eacfba181fab20dbc3dbf1`, `f548e0e8e3dc1896ca956272154dde3314e8cc4fde0a57577ee9fa1c63f5baf4` | `3884a337192318652b28de0de1aeb07f446a14f220feb5066f03e93f23ea3b60` |
| pause:3.10.2 | amd64 | `412c4a7219cb8a299a37337f3d87810c5340095322e15594a1637785adad0f17`, `f548e0e8e3dc1896ca956272154dde3314e8cc4fde0a57577ee9fa1c63f5baf4` | `4a83b15d3ecfe0d916b2d0a7991bc2854a629b8097017c2ee1ff65b30ae4c07c` |

`kube-proxy`と`pause`は両architectureで共通RepoDigestが一致し、architecture固有digestと
image IDが異なることを確認した。control-plane imageは実配置先のarm64で解決した。
`coredns/coredns:v1.14.2`は既にclusterのdesired imageと一致し、arm64 cacheのRepoDigestsは
`3c5a66ca0d50fbd3ddb862857ce2a01a9d74dd409aea4b1fde83a9c68c598754`と
`e7e6440cfd1e919280958f5b5a6ab2b184d385bba774c12ad2a9e1e4183f90d9`だった。

`kubeadm` の候補 list に `etcd:3.6.8-0` が含まれても、稼働中の stacked etcd image を更新してよい根拠にはならない。今回の既存 role は `--etcd-upgrade=false` で etcd を保持する方針であり、候補 list の etcd tag はその方針と異なる自動更新対象ではない。shanghai-1は既存3.6.4、shanghai-2/3は既存3.6.8で、member healthとsnapshot/restoreは`observation.md`に記録した。3.6.8-0 arm64 cacheのRepoDigestsは`397189418d1a00e500c0605ad18d1baf3b541a1004d768448c367e48071622e5`と`82bf8bc50b9a953f8b477adb63f12637229d8044e85b21501a3c6a4be59afbb8`。本票ではetcd imageを変更しない。

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
本記録のpackage検証は配布物と空のpackage状態でのbase OS依存解決までである。上記の
container pullは実ノードのcache追加とdigest実解決に限り、本番dry-run、package install、
Pod再作成、workflow dispatchは行っていない。
