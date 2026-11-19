# BOXP-618 検証記録: `NodeControllerLeaseCircuitBreaker=false` 前提での 1.37 再評価

記録日: 2026-11-19（UTC）。本番クラスタには触れていない（読み取りの確認と、使い捨ての kind だけ）。

## 1. 結論（平易に）

- 「upstream #141572 の修正を待つしかない」は撤回できる。kube-controller-manager（KCM）の
  `NodeControllerLeaseCircuitBreaker` を false にすると、node lifecycle controller は 1.36 と同じ処理経路に戻り、
  #141572 の panic が起きる前提（health 情報が無い node が残る）が作られない。
- ただし gate を入れる順番に**新しい制約**がある。KCM 1.36 は この gate を知らないので、1.36 の KCM に付けると即終了する。
  そのため「各 CP の manifest が 1.37 に作り直される瞬間にだけ付ける」必要がある。
  これを arch の upgrade role に既定無効の仕組みとして用意した（`kubeadm upgrade apply/node --patches`）。
- 残る判断は 1 つ: **BOXP-191 で 1.37 を実施するときに、この gate 無効化を使うかどうか（Owner の受容）**。
  Calico/Longhorn は BOXP-619 側の先行更新、kind 候補 image は v1.37.0 での代替で足りる（下の 4 章）。

## 2. 一次資料での確認

| 確認 | 結果 |
| --- | --- |
| gate の段階 | v1.37.2 / v1.38.0-beta.0 とも Beta・既定 true・`LockToDefault` なし。無効化できる |
| v1.36.6 → v1.37.2 の `pkg/controller/nodelifecycle` 差分 | gate の分岐だけ。gate off のときは `NoopConsistencyStore` になり、short-circuit（node の処理を飛ばす）が起きない。`scheduler` と `util/node` は同一 |
| panic の起点 | gate on で lease cache が古いと `tryUpdateNodeHealth` が short-circuit し、その node の `nodeHealthMap` entry が作られない。その状態で master disruption mode を抜けると `handleDisruption` の `getDeepCopy(...)` が nil を返し、`v.probeTimestamp` で nil 参照（#141572） |
| 公式バイナリ | KCM v1.36.5 は `--feature-gates=NodeControllerLeaseCircuitBreaker=false` で `unrecognized feature gate` を出して終了。v1.37.2 は受け付ける |
| kind v1.37.0 で代わりになるか | v1.37.0...v1.37.2 の差分 75 ファイルに nodelifecycle / consistency / feature 定義は無い。release-1.37 の `pkg/controller/nodelifecycle` の最後の commit は 2026-06-30（1.37.0 より前）。node lifecycle については v1.37.0 と 1.37.2 は同じコード |
| 上流（2026-11-19） | #141572 open、修正 PR #141622 未 merge、最新 patch は v1.37.2、kindest/node の 1.37 系は v1.37.0 のみ |
| 現 IaC | live の kubeadm-config の `controllerManager.extraArgs` は bind-address だけ。arch の `kubernetes_upgrade` role は `kubeadm upgrade apply/node` を `--config`/`--patches` なしで実行していた（gate を入れる手段がなかった）。通常 Apply（`control_plane_metrics.yml`）は manifest の `--bind-address` 行だけを置換するので、付けた gate 行は消さない |

## 3. kind での隔離検証

### 3.1 gate off / on の対照（`verify-kind-gate.sh`、kind v1.37.0、CP 1 + worker 2）

全 node の kubelet を止めて master disruption mode に入れ、戻して抜ける操作を 2 回。2 回目は disruption 中に worker の Node object を消し、再登録させた。

| | gate off | gate on（既定、対照） |
| --- | --- | --- |
| KCM の起動引数 / metric | `--feature-gates=NodeControllerLeaseCircuitBreaker=false` / `kubernetes_feature_enabled{name="NodeControllerLeaseCircuitBreaker"} 0` | 付けない / `... 1` |
| disruption の出入り | Entering/Exiting を 3 回ずつ（起動時を含む）。node 削除・再登録も正常 | 同じ |
| KCM restartCount / panic 行 | 0 / 0 | 0 / 0 |

- 読み方: gate off にしても disruption の出入りや node 再登録は壊れない（退行がない）ことの確認。
- 限界: 対照の gate on でも panic は再現しなかった。#141572 は「lease cache が遅れて short-circuit した node がある」
  ことと「disruption mode を抜ける」ことが重なったときに起きるので、kind の単純な操作では作れない。
  gate off で panic を避けられる根拠は 2 章のコード経路（short-circuit 自体が無くなる）に置く。

### 3.2 kubeadm `--patches` で CP ごとに付ける経路（`verify-kind-kubeadm-patches.sh`、kind v1.36.4 CP 2 台 → 1.37.0）

（結果は 3.2 の追記を参照）

## 4. 残条件の整理（BOXP-191 向け）

| 項目 | 今の扱い |
| --- | --- |
| #141572 | 修正待ちは必須ではなくなった。gate off（1.37.0〜1.37.2 の間だけ）で回避できる。採るかどうかが Owner の判断 |
| gate を入れる順番 | arch の role で、各 CP の `kubeadm upgrade apply/node` のときだけ `--patches` で付ける。1.36 への更新や未評価の minor（1.38 など）に gate を設定したまま進むと pre_checks と upgrade の両方で止まる |
| gate を外す時期 | 修正入りの 1.37.x patch へ上げるとき、または 1.38 へ上げる前に、`kubernetes_upgrade_controller_manager_feature_gates` を空に戻して `kubeadm upgrade` で manifest を作り直す（`--patches` なしの再生成で gate は外れる）。gate が GA/lock されると false は起動失敗になるので、1.38 では必ず再評価する |
| 持続性 | kubeadm-config には gate が残らない。`kubeadm upgrade` を `--patches` なしで手で実行すると外れる。1.37 の間は role の変数を設定したままにしておけば patch 更新でも付き直す |
| Calico / Longhorn | 上流は 1.37 対応済み（BOXP-615 の watch）。lolice 側の順番の更新は BOXP-619 で並行して進める。本票では触らない |
| kind 候補 image | v1.37.0 で代替して妥当（node lifecycle は 1.37.2 と同じコード）。Chainsaw 段階 A では「v1.37.0 で代替」と明記する |
| そのほか 191 の gate | 版の固定・署名検証、etcd 復旧点、作業窓、7 台直列などは BOXP-191 の既存条件のまま。本票では変えていない |

## 5. 再実行のしかた

```bash
KIND=/path/to/kind OUT=/tmp/out docs/project_docs/BOXP-618/verify-kind-gate.sh off
KIND=/path/to/kind OUT=/tmp/out docs/project_docs/BOXP-618/verify-kind-gate.sh on
KIND=/path/to/kind OUT=/tmp/out docs/project_docs/BOXP-618/verify-kind-kubeadm-patches.sh
cd ansible && uv run python -m unittest tests/test_kcm_feature_gate_patches.py -v
```
