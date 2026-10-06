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

## 2026-10-06 追補（Decision Packet、読み取り専用）

2026-10-06 09:57 / 10:00 UTCのowner指示で、Orange Pi Zero 3級の低リソースCPに「異常ゼロ」を求めず、許容する短時間自己回復の揺らぎと更新を止める異常を、現行baselineとread-only観測から定義することが本runの範囲になった。前回までの禁止事項（update / drain / Apply、package / manifest / Argo / cron変更、reboot、Pod / Node削除、etcd操作・restore、Secret参照、設定変更）は維持した。

1. Prometheus 32.4日分（2026-09-04〜10-06）を、停止級事象の継続時間（1分解像度）と揺らぎ級事象の日次件数で集計し、現在値（10-06 05:15〜10:05 UTC）と比較する。
2. 3CPの実効設定（etcd / apiserver manifestのflag、kubelet設定、sysctl、zram、ストレージ）とkubeadm-config ConfigMap、既存PrometheusRuleを読み取り、Ansible宣言との差分を確認する。
3. 最小Go/No-Go基準（開始条件・停止条件・許容する揺らぎ・Halt後の扱い）、現在値とbaselineの比較、hardwareを替えない低リスク改善候補（期待効果・副作用・rollback・検証）を[decision-packet-20261006.md](decision-packet-20261006.md)に整理し、集計値を[baseline-observation-20261006.json](baseline-observation-20261006.json)に保存してdocs-only PRでReviewへ提出する。
4. 改善候補の実施と1.36 patch更新の再開はownerの判断（Decision Packet 0章 D1〜D4）を待ち、本runでは実施しない。

結果の要点: 停止級事象（監視経路からapiserver 3台すべてが観測不能、etcd全memberのleaderなし。前者はAPI停止の実績ではない）は32日間で3回・各2分以内、CP NotReady 5分超は9回。揺らぎ級（leader change 0〜20/日、component再起動0〜16/日）は自己回復している。新規事実として、3CPのkubelet常駐メモリが約12〜14MiB/日で単調増加（約200→650MiB、再起動なし38〜48日）していること、etcdのheartbeat / election timeoutがAnsible宣言（1000 / 10000ms）と異なり実機・ConfigMapとも既定（100 / 1000ms）であることを確認した。

### 2026-10-06 改訂（Decision Packet codex-review指摘対応、読み取り専用）

PR #13338へのCodexレビューで2点の指摘を受けた。(1) 「apiserver 3台すべてscrape不可」を「全API断」として更新可否（D4、6章）の根拠にしているが、scrape断はPrometheus・ネットワーク・scrape経路の障害でも起こり、VIP / 各CP直接の`readyz`履歴がないため、API可用性の実績として結論づけるのは不正確。(2) H6の「degradedが15分以上継続」は日別の延べ時間しか根拠がなく、単一volumeの連続degraded時間を検証していない。

対応（新規Prometheus範囲クエリ12本、集計値のみ、本番操作なし）:

1. 「3台すべてscrape不可」の3窓で、Prometheus自身のscrape / 取り込み率、CP上のetcd / kubelet / node-exporter、worker 4台のnode-exporter、container再起動を30秒解像度で照合した（Decision Packet 2.1.1）。Prometheusは3窓とも稼働し、apiserverの`up`=0は各CPで0〜2分に留まり、「3台すべて不可」は系列欠落を含む。同時にworker 4台のnode-exporterも到達不能になっており、監視経路からクラスタ全体の到達性が揺らいでいた。一方、同一窓内にapiserver 2〜3台（3台すべて不可のバケットから+1.0〜+6.5分）とkube-vip 2 Pod（−6.5〜+4.0分）の再起動カウンタ増加も記録されているが、同時性・因果は確定できない。結論として「監視経路からapiserver 3台を観測できなかった時間」へ言い換え、API停止の実績とはせず、D4 / 2.1 / H2 / 3.4 / 6章 / 7章の表現を修正した。更新中はrunnerが30秒間隔でVIP / 直接readyzを記録し（3.5、改善候補A2を追加）、scrape断は補助指標にする。readyz記録は既存workflowに未実装（既存のreadyz確認は各CP更新直後の1回限り）のため、開始条件G6として「A2実装済み」を追加し、実装は別ticketへ分離した。
2. `longhorn_volume_robustness`をvolume別に連続runへ分けた（Decision Packet 2.1.2）。8 run・6 volume・67サンプルで合計は既存集計と一致し、単一volumeの連続degraded最長は13.0分（10-02 09:07 UTC、Prometheus DB volume）、faultedは0。H6を「更新中ノード上のreplicaで説明できないdegraded 15分以上」「更新ノード復帰後もdegradedが15分以上残る」に分け、超過時のLonghorn API確認手順（rebuild進行中なら5分延長）と5分間隔の記録手順を明記した。baselineにdrain期間が含まれないことも明記し、drain起因のdegradedは3.3の許容範囲に追加した。

集計値・確度評価は変えていない。D3 / D4と6章の結論にはG6（readyz記録の実装）を更新再開の必須条件として追加した。
