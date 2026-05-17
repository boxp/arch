# Orange Pi Image Build Kubernetes Version Fix

## 背景

`Build Orange Pi Zero 3 Images` workflow が `kubelet=1.34.0-1.1` の install で失敗している。

原因は node playbook の `kubernetes_version` が `1.35.1`、`kubernetes_package_version` が `1.34.0-1.1` になっており、role が `kubernetes_version` から `pkgs.k8s.io/core:/stable:/v1.35/deb/` を参照するため、v1.35 repo 内で v1.34 package を探していること。

## 方針

緊急復旧用 image build を優先し、Orange Pi control-plane 用 playbook の `kubernetes_version` を現行 cluster の v1.34 系に合わせる。

## 作業

1. `ansible/playbooks/control-plane.yml` の `kubernetes_version` を `1.34.0` に戻す。
2. `ansible/playbooks/node-shanghai-{1,2,3}.yml` の `kubernetes_version` を `1.34.0` に戻す。
3. 既存の `kubernetes_package_version: "1.34.0-1.1"` は維持する。
4. Ansible lint を実行して構文・lint の破壊がないことを確認する。
5. `Build Orange Pi Zero 3 Images` workflow を `shanghai-1` で再実行する。
