# BOXP-213: 更新中のAPI readyz連続記録とHalt連動

## 背景

BOXP-194 Decision Packet（Obsidian: `Projects/lolice-k8s-1.36-upgrade/research/boxp-194-low-resource-cp-20261006/decision-packet-20261006`）の
停止条件H2は「runnerからのVIP経由readyz失敗、または更新中ノード以外のapiserver 2台以上の直接readyz失敗が3分以上継続」で、
主判定はrunnerが30秒間隔で記録するreadyzである。改善候補A2（readyz連続記録・Halt連動・artifact保存）はG6として
更新再開の前提になっているが、既存の `upgrade-k8s.yml` と `kubernetes_upgrade` roleにあるreadyz確認は各CP更新直後の1回限りで、
定期実行・保存・Halt連動は存在しない。

## 現状の読み取り

- `.github/workflows/upgrade-k8s.yml` は `target_node` 1台ずつのdispatchのみ許可（`all` は拒否）。
  各 `upgrade-*` jobはGitHub-hosted runnerからbastion（cloudflared）経由でSSHし、ansible-playbookを実行する。
- CP jobのSSH configには更新対象CPのIPしか登録されない。worker jobは対象workerとdrain delegate（shanghai-2）のみ。
- `post-check` jobは `health_check` tag（Node Ready / kubelet version / pressure / etcd health）を1回実行して終わる。
- runnerはノード網（192.168.10.0/24）へ直接HTTPできないため、readyz probeはSSH経由で非更新CP上から `curl` する必要がある。

## 方針（最小実装）

1. `scripts/upgrade-k8s/readyz-watch.sh`（runner側bash、本番側へ何も配置しない）
   - 対象: VIP（`cluster_vip`）と3 CP直接の `https://<ip>:6443/readyz`。
   - 30秒間隔で、更新中ノード以外のCPのうちSSHできた1台をprobe hostにして4対象を `curl -sk --max-time 5` で取得し、
     時刻・対象名・HTTP code・成否・probe hostをJSONL（`readyz-samples.jsonl`）へ記録する。IP・credential・bastion名は書かない。
   - 判定: 「VIP失敗」または「更新中ノード以外のCP直接失敗が2台以上」が同一tickで成立する状態が3分（既定180秒）継続したら
     `HALT` markerと `readyz-summary.json`（verdict=halt, reason, 継続開始時刻）を書き、exit 2で終了する。
     一過性（3分未満で回復）は記録のみでHaltしない。probe host全滅（SSH不達）は安全側に失敗として数える。
   - 停止: stop file（upgrade完了時にworkflowが作成）または `--duration`（観測窓）で終了。exit 0。
   - probe / clock / sleepは環境変数で差し替え可能にし、fixtureテストで時間を進めずに検証する。
2. `upgrade-k8s.yml`
   - `workflow_dispatch` inputに `readyz_watch`（boolean、既定false）と `readyz_observe_minutes`（空=役割別既定: CP 30 / worker 15 / golyat-4 30）を追加。
     既定falseなので既存の通常経路は無変更（有効化はCI・レビュー後にownerが判断）。
   - 各 `upgrade-*` jobに `if: inputs.readyz_watch` のstepを追加: probe host用SSH config追記 → watcherをbackground起動 →
     （既存の `Upgrade <node>` stepはそのまま）→ `always()` でstop/判定（HALTならjob失敗、再試行しない）→ artifact upload。
     job失敗により `post-check` と後続jobは既存の `needs` 条件でskipされる。
   - `post-check` jobに観測窓stepを追加（全CP対象、更新中ノードなし）。HALTならjob失敗。timeoutを観測窓に合わせて延長。
3. テスト・CI
   - `tests/upgrade-k8s/readyz-watch-test.sh`: fixture scheduleで all-ok / 一過性 / VIP 3分継続 / 2CP継続（更新中ノード除外）/
     probe不達 / stop file / artifact内容（IP・secret非含有）を検証。bbでworkflow構造（step順・if条件・既存stepの不変）を回帰確認。
   - `.github/workflows/test-upgrade-k8s-readyz-watch.yml`: 上記テストとshellcheckを実行。
   - `actionlint` / `ghalint` / `shellcheck` をローカルでも実行。

## スコープ外（変更しない）

- Kubernetes manifest、Argo、cron、Secret、cluster設定、ansible role / playbook。
- 実Kubernetes update / drain / Applyの起動。featureは既定off。
- 複数run横断のHalt台帳（前回runのHALT artifactを次回dispatchのpre-checkで参照する）は後続候補。

## Rollback

本PRのrevertのみ。本番側に成果物を配置しないため、クラスタ側の戻し作業はない。
