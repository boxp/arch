# BOXP-194: control-plane不安定の読み取り専用RCA

2026-09-30 04:15 / 04:39 UTCの指示が本runの範囲。旧Kubernetes patch更新計画は実行しない。

1. 旧runのCP2 restart、CP3 readyz失敗、etcd遅延、CP3 NotReadyをUTC時系列で整理する。
2. 許可済みSSHと限定的なKubernetes GET、etcd endpoint health、既存metrics取得で現在状態を確認する。既存Podへのexecはetcdctl endpoint healthの読み取りだけに限定する。
3. ホスト負荷・サービス稼働・既存ログの集計とmetricsの短区間差分を照合し、事実と仮説を分ける。調査自体の負荷とログ保持範囲も明示する。
4. IP、private endpoint、credentials、Secret、raw logsを含めない要約を独立レビューし、旧更新準備PRと分離したdocs-only PRでReviewへ提出する。

update/drain/Apply、workflow dispatch、snapshot作成/restore、package変更、reboot、Pod/Node削除、etcd member操作、manifest変更、Argo sync、Secret参照/出力は実施しない。復旧変更は根拠・影響・rollbackをレビュー可能にした後、別途明示指示が必要。Task Board laneはrunnerが管理する。

本調査の完了は更新完了・復旧完了・更新再開許可を意味しない。

## 2026-10-06 追補（review-fix run、読み取り専用RCA第2報）

RCA PR #13021はレビュー指摘なしでmergeされていたため、残っていた「根本原因の確度」「追加観測」「復旧 / 更新再開の安全条件」を埋めることを本runの範囲とした。2026-09-30 04:15 / 04:39の禁止事項（update / drain / Apply、reboot、Pod / Node削除、etcd member操作、restore、manifest変更、Argo sync、Secret参照）は維持した。

1. 現在状態をAPI GETとSSH（journalパターン件数）で再観測し、当日の4イベントをUTC時系列化する。
2. monitoring namespaceのPrometheus 31日履歴をpromtoolの集計値だけで取得し、leader change全41バケットについてCPごとのメモリ / fault / IO / CPU / apiserver WSSを照合する。（初版時点の記述。バケット数は改訂で46件に訂正、下記「2026-10-06 改訂」参照）
3. 30日トレンドとapiserver要求構成（verb / resource）から恒常負荷と09-29以降の変化を分ける。
4. 結果を[rca-20261006.md](rca-20261006.md)と[rca-observation-20261006.json](rca-observation-20261006.json)に保存し、docs-only PRでReviewへ提出する。復旧案は提案のみで未実施。

【初版時点の結論・改訂で撤回済み】初版の結論は「control-planeのメモリ逼迫（apiserver WSS約2GiB超、MemAvailable約200〜300MiB、swapなし）→major page fault→同一eMMC上のetcd停滞→liveness失敗でapiserver SIGKILL→leader change」の連鎖だった。下記「2026-10-06 改訂」でapiserver SIGKILLを必要条件とする記述を撤回し、確度を中〜高へ見直した。Kubernetes 1.36 patch更新の再開は、復旧案の実施とleader change / 再起動の収束を確認するまで推奨しない。

### 2026-10-06 改訂（codex-review指摘対応、読み取り専用）

PR #13308へのCodexレビューで「全leader change / apiserver再起動で同一連鎖を高確度で確認」という結論が、広い横断条件（major fault / iowait / MemAvailable低下 / scrape欠落のいずれか）にしか裏付けられていないと指摘された。対応としてPrometheusの範囲クエリ（集計値のみ、Kubernetes APIへの追加GETはPrometheus Pod名確認1回とexecのみ）でleader changeバケット46件をイベント単位に分類し直し、観測事実と仮説を分離した。結果、apiserver再起動はleader changeの必要条件ではない（46件中24件は再起動なし、再起動25バケット中11件はleader changeなし。この「25バケット」はCP別件数の合計で、改訂3でユニーク時間バケット23件・延べ13 / 12件へ訂正）として連鎖の記述を撤回し、「メモリ逼迫→etcd停滞→leader change」の確度を高から中〜高へ下げ、未説明4件を明記した。復旧案と更新再開条件は提案のまま未実施で、本番操作は行っていない。

### 2026-10-06 改訂2（codex-review 2巡目指摘対応、読み取り専用）

改訂1に対するCodexレビューで2点の指摘を受けた。(1) 照合窓（終端15分前〜10分後）が終端後の値を含むため、leader changeの結果として起きた逼迫・slow applyを原因側に数える逆因果を排除できない。(2) 「7日間」と表記した集計範囲は実際には09-29 00:00〜10-06 05:15 UTCの7日5時間15分である。対応として、05:19 UTCに取得済みの同じ範囲クエリ出力を再利用し（新規のPrometheus / Kubernetes API問い合わせなし）、先行区間だけの窓3種類で46バケットを再分類した。厳密先行（終端15分前〜5分前）では逼迫が先行するのは46件中25件（54%、平常時比約3〜12倍）で、残り21件は、同時または直後にのみ観測された17件（因果の向き判別不能）と、照合窓内でも逼迫を検出できない4件（未説明）に分かれる。これを受けて「メモリ逼迫→etcd停滞→leader change」の確度を中〜高から中へ下げ、改訂1の42件（91%）は窓内の相関としてのみ記載し、期間表記を実範囲へ訂正した。復旧案と更新再開条件は提案のまま未実施で、本番操作は行っていない。

### 2026-10-06 改訂3（codex-review 3巡目指摘対応、読み取り専用）

改訂2に対するCodexレビューで、「apiserver再起動25バケット（CP1 9 / CP2 8 / CP3 8）」がCP別件数の合計であり、同一5分バケットで複数CPが再起動した行を含むためユニークな時間バケット数ではなく、leader changeバケット数（46件、時間バケット単位）と分母が一致しないまま「11件はleader changeを伴わない」と比較していると指摘された。対応として、05:19 UTCに取得済みの同じ範囲クエリ出力を再利用し（新規のPrometheus / Kubernetes API問い合わせなし）、再起動をCP×バケット延べ数25件、ユニーク時間バケット23件（10-01 07:55は3CP同時）、連続バケットを統合したエピソード20件の3単位に正規化した。leader change照合窓（終端15分前〜10分後）の内外は延べ13 / 12件、ユニーク11 / 12件、エピソード9 / 11件で、改訂1・2の「14 / 11件」は延べ数かつ窓端の扱いが異なる値だったため訂正した。結論（再起動はleader changeの必要条件ではなく、再起動の約半数はleader changeを伴わない）は変わらない。復旧案と更新再開条件は提案のまま未実施で、本番操作は行っていない。

### 2026-10-06 改訂4（codex-review 4巡目指摘対応、読み取り専用）

改訂3に対するCodexレビューで、leader changeを5分バケット単位で46件として扱う集計が、連続バケットを同一障害エピソードと明記していながら「42 / 46」「25 / 46」「平常時比の濃縮率」および根本原因の確度評価にそのまま使われており、長時間の単一障害（10-01 07:45〜07:55、10-02 07:25〜07:45等）が複数回分として水増しされると指摘された。対応として、05:19 UTCに取得済みの同じ46件分類データを再利用し（新規のPrometheus / Kubernetes API問い合わせなし）、apiserver再起動と同じ「連続5分バケット統合」の定義でleader changeを32エピソードへ、感度分析として15分以内ギャップ統合で29エピソードへ正規化した。エピソード単位では照合窓内の逼迫一致は32件中28件（88%）とほぼ変わらないが、先頭バケットの先行区間での逼迫先行は32件中14件（44%、15分統合では29件中14件 48%）で半数に満たない。濃縮率は窓内外の時間シェア比であり独立イベント数ではないため確度根拠から外した。これを受けて「メモリ逼迫→etcd停滞→leader change」の確度を中から中〜低へ下げた。結論（apiserver再起動は必要条件ではない、構造的なメモリ逼迫は観測事実）は変わらない。復旧案と更新再開条件は提案のまま未実施で、本番操作は行っていない。

### 2026-10-06 改訂5（codex-review 5巡目指摘対応、読み取り専用）

改訂4に対するCodexレビューで、「復旧・再開の安全条件」の案1がstatic Pod manifestへのmemory request追加をapiserverのメモリ圧迫低減策として列挙しているが、requestだけでは使用量は上限されずkubeletのallocatable / eviction判定が変わるだけで逼迫は減らない、と指摘された。対応として案1を「apiserverの使用量そのものを下げる手段（恒常負荷削減、watch cache縮小）」と「request / limit・kubelet予約の設計（使用量は下げない。limitはOOM-killという別経路の再起動を招き、`systemReserved` / `evictionHard`はallocatableを減らして他Podのevictionを早めるだけで、critical priorityのstatic Podも退避されないことは保証されない）」に分離し、後者を単独の負荷低減策として提示しないよう改めた。さらにCLI独立レビュー（改訂5の1巡目）で、`--target-ram-mb`はv1.24で削除済み、`--default-watch-cache-size`は1.36のflag一覧に存在しない、`--watch-cache-sizes`は組み込みリソースの`#0`による無効化だけが有効でCRDに効かない、memory requestはallocatable計算を変えない、critical priorityのstatic Podも退避されないとは保証されない、という4点を指摘された。上流のkube-apiserver flag一覧で確認のうえ、案1を「オブジェクト数・サイズの削減による常駐量の削減」「要求負荷・更新量の削減（常駐量は直接減らない）」「組み込みリソース限定のwatch cache無効化（etcd負荷増の代償を明記）」に書き直し、request / limit・予約の記述を訂正した。2巡目で、static Podの退避順位に効くのは`spec.priority`の実値である点、要求負荷削減とwatch cache常駐量削減の区別、plan.md側に残っていた`--target-ram-mb`の旧記述も訂正した。なお、レビュー5巡目で「critical static Podは公式にeviction対象外であり、退避されない保証はないという記述は不正確」との指摘があったが、v1.36公式のNode-pressure Evictionページ「Self healing for static pods」節は資源圧迫下でkubeletがstatic Podを退避し得ると記す一方、Guaranteed Scheduling For Critical Add-On Podsはcriticalなstatic Podはevictされないと記しており公式文書間で一致しない。6巡目の指摘に従い、どちらかに断定せず両文書を出典として併記し、kubeadmが生成する`priority: 2000001000`と`priorityClassName`の両フィールドとkubeletの実挙動を確認対象とする記述に改めた。集計値・確度評価・結論は変更なし。復旧案と更新再開条件は提案のまま未実施で、本番操作は行っていない。

## 2026-10-07 追補（F1 + F2: pre-check readiness の bounded retry と VIP 宛て変更）

2026-10-07 07:18 UTCのdry-run 1/7（GitHub Actions run 37586489887、固定SHA b337a4154）は、`pre_checks.yml`「Verify all nodes are Ready」のworker-1分がCP2直接API（`https://<CP2>:6443`、retryなし）へ問い合わせた瞬間にCP2 apiserverがliveness失敗で再起動中（07:26:16 Killing→07:27:26再起動）だったため、connection refusedで失敗した（原因まとめはObsidian `Projects/lolice-k8s-1.36-upgrade/research/boxp-194-dryrun-failure-20261007/README`）。ownerは2026-10-07 09:07 UTCに推奨案F1 + F2を小さなarch PRとして先行させることを承認した。本追補はその実装範囲を記す。

### 変更（Ansible roleの実変更、docs-onlyではない）

1. **F1（bounded retry）**: `ansible/roles/kubernetes_upgrade/tasks/pre_checks.yml`「Verify all nodes are Ready」に `until: node_status.rc == 0 and 'NotReady' not in node_status.stdout` と `retries` / `delay` を追加する。既定は `kubernetes_upgrade_pre_check_ready_retries: 12` / `kubernetes_upgrade_pre_check_ready_delay: 15`（初回+12回のretry、待ち時間は最短3分。H2の3分と揃える）。apiserverの1回のliveness再起動（今回は約70秒）を跨げる一方、永続的なAPI不達やNotReadyのままのNodeは、retryを使い切った後に従来どおり失敗する。`failed_when` はそのまま残す。kubectl自身の接続retry（今回は約2分42秒）により1回のattemptが長引く場合があるため、実時間の上限は「retry回数×（attempt時間+delay）」で3分を超えうる。
2. **F2（VIP宛て）**: worker分の `--server` をCP2直接（`hostvars[delegate].node_ip`）から新default `kubernetes_upgrade_worker_pre_check_api_server: "https://{{ cluster_vip }}:6443"` へ変更する。SSH delegate先（`kubernetes_worker_drain_delegate` = CP2）は変えないので、2026-06-22 PR #10348の「worker jobのSSH configは対象workerとCP2のみ」という制約には抵触しない。`cluster_vip` は production inventoryのcontrol_plane / workers両groupに定義済みで、apiserver証明書SANにもkubeadm-config templateで含まれている。control-plane分（自ノード直接API）は変更しない。
3. **検証（新規unittest）**: `ansible/tests/test_pre_check_ready_retry.py` と `ansible/tests/fixtures/pre_check_ready/`（local接続inventory、mock kubectl、fake sudo）。`--start-at-task` で該当taskだけを実行し、(a) CP分は自ノード直接endpoint、(b) worker分はCP2へdelegateしつつVIP宛て、(c) connection refused 2回→回復で成功（attempts=3）、(d) 永続refusedはretry上限（初回+3回）で失敗、(e) NotReady継続はretry上限で失敗、を確認する。CIの `Test upgrade input and preflight gates` step（`unittest discover -s tests`）で既存3件と一緒に走る。既存のMolecule scenario（CP、mock kubectlはReadyを返す）は変更なし。

### 範囲外（本PRに含めない）

- `health_check.yml` の同形delegate / `--server` 変更（更新後のhealth checkはpre-checkより後段で、まず本PRの効果を確認してから別途判断）。
- runner側F5、etcd / swap / workload移動 / health gate緩和、CRI-Oその他のversion変更、workflow dispatch / rerun（dry-run含む）、update / drain / Apply、snapshot / restore、Pod / Node削除、本番更新再開。
- 本PRがmergeされると固定SHAが変わるため、G5（全7台dry-run）は新SHAで最初からやり直す。実行再開時は新固定SHAと当時点の安全条件を別途扱う。

### rollback

当該2ファイル（`pre_checks.yml` の該当task、`defaults/main.yml` の追加3変数）とtest 1式の差し戻し。クラスタ側の状態変更は伴わない。
