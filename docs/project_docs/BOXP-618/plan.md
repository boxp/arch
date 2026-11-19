# BOXP-618: Kubernetes 1.37 を機能無効化前提で再評価し真の残条件を確定する

## 目的

BOXP-191（lolice の 1.37 更新）の保留理由のうち「upstream kubernetes#141572 の修正待ち」を、
`NodeControllerLeaseCircuitBreaker=false`（kube-controller-manager の feature gate 無効化）を前提に再評価する。
今回は再評価・安全な準備・隔離検証だけを行う。本番 Kubernetes/CRI-O の 1.37 更新 dispatch、
本番の controller gate 変更、新しい課金・権限は含まない。

## 方針

1. 一次資料で確認する
   - v1.36.6 と v1.37.2 の `pkg/controller/nodelifecycle` を比較し、gate を切ったときの経路を確かめる。
   - 公式バイナリで、1.36 と 1.37 の KCM が `--feature-gates=NodeControllerLeaseCircuitBreaker=false` を受け付けるか確かめる。
2. kind で隔離検証する（本番には触れない）
   - `verify-kind-gate.sh off|on`: kind v1.37.0 で gate off / 既定 on を比べ、全ノード kubelet 停止による full disruption の出入りと、
     disruption 中の Node 削除・再登録を 2 回まわして KCM の panic / 再起動を見る。
   - `verify-kind-kubeadm-patches.sh`: kind v1.36.4（CP 2 台）を `kubeadm upgrade apply/node --patches` で 1.37.0 に上げ、
     CP ごとに manifest が 1.37 になるときだけ gate が付くこと、混在中も 1.36 KCM が落ちないこと、kubeadm-config に残らないことを見る。
3. 安全な準備として arch の `kubernetes_upgrade` role に gate 投入手段を足す（既定は無効で、今の動作は変わらない）
   - `kubernetes_upgrade_controller_manager_feature_gates`（既定 `{}`）を設定したときだけ、
     `kubeadm upgrade apply/node` に `--patches` を付け、KCM の command に `--feature-gates=...` を 1 要素足す JSON patch を置く。
   - 対象 minor（既定 `["1.37"]`）以外への更新で gate が設定されていたら pre_checks と upgrade の両方で止める
     （1.36 の KCM は未知の gate で即終了するため。1.38 で gate が GA/lock/削除されたときにも止める）。
   - 本番で有効にするかどうか（group_vars に値を入れるか）は BOXP-191 の実施判断に残す。
4. 結果を BOXP-191 の正本と、BOXP-590 の blocker 台帳の「実行するときの前提」欄へ反映する。

## 検証

- `ansible/tests/test_kcm_feature_gate_patches.py`（既定は no-op、1.37 のときの JSON patch、1.36/1.38・型不正の拒否）
- `cd ansible && uv run ansible-lint`、既存 unittest 全件
- kind 検証の結果は `validation.md` に記録する

## 並行作業との関係

- BOXP-619（Calico/Longhorn の先行更新）とは触る場所が違う（本票は arch の upgrade role と docs だけ）。
- BOXP-615 の blocker watch の解除条件（正式 patch の CHANGELOG に修正が載る）は変えない。gate 回避は watch とは別の「実行時の前提」として扱う。
