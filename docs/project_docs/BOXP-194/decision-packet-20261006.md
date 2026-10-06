# BOXP-194 Decision Packet: 低リソースcontrol-planeにおける更新Go/No-Go基準と低リスク改善候補（2026-10-06、読み取り専用）

2026-10-06 09:57 / 10:00 UTCのowner指示に基づく。control-plane（CP1〜CP3）はOrange Pi Zero 3（4CPU / 3.9GiB RAM / eMMC、swapなし）であり、サーバー水準の「leader changeゼロ・無停止」を更新再開の条件にしない。本書は (1) 最小Go/No-Go基準、(2) 現在値とbaselineの比較、(3) hardwareを替えずに試せる低リスク改善候補を、ownerの判断材料として整理する。本runで実施したのはKubernetes API GET、許可済みSSHでの読み取り、Prometheus集計値の取得だけで、update / drain / Apply、package / manifest / Argo / cron変更、reboot、Pod / Node削除、etcd操作、Secret参照は一切行っていない。集計値は[baseline-observation-20261006.json](baseline-observation-20261006.json)に保存した。

## 0. ownerに求める判断

| ID | 判断事項 | 本書の推奨 |
|---|---|---|
| D1 | 3章の最小Go/No-Go基準（開始条件・停止条件・許容する揺らぎ）を採用するか | 採用を推奨。しきい値は原則としてbaseline実績の最長値を上回る位置に置き、更新中に「baseline内の揺らぎ」で止まらないようにした。ただし冗長性を失う事象（H2 / H4）はbaselineより短い安全側の運用上限にしている |
| D2 | 観測時間の配分 | 各CP更新後30分、各worker更新後15分、worker-4（GPU）更新後30分（GPU推論確認を含む）、全7台完了後60分（自動観測）。ownerの「1時間ぐらい」を全台完了後の観測に割り当てる解釈であり、各ノード1時間にする場合は合計で約8時間になる |
| D3 | 更新前に実施する改善候補 | 5章のA2（readyz記録とHalt連動）はH2の主判定に必要で未実装のため、更新再開前に別ticketで実装する（G6）。K1（kubelet再起動による常駐メモリ回収）は更新手順自体に含まれるため追加作業なし。E1（etcd heartbeat / election timeoutの実機反映とkubeadm-config整合）は更新と同じ静的Pod再生成を伴うため、更新の前後どちらで行うかを決める。他は更新後に別ticketで扱う |
| D4 | 1.36 patch更新の再開可否 | 現baselineでは「監視経路からapiserver 3台すべてが観測不能になった事象（API自体の停止実績ではない。2.1.1参照）とetcd全memberのleaderなしは32日間で3回・各2分以内（CP NotReadyの5分超は9回・最長11分）、揺らぎ級は自己回復」であり、3章の基準で監視すれば1台ずつの更新は実行可能と判断する。再開はownerの明示指示で行う |

## 1. baselineの定義と取得範囲

- 期間: 2026-09-04 00:00〜2026-10-06 10:00 UTC（32.4日、Prometheus保持範囲の先頭から現在まで）。日単位の値はUTC日で、10-06は00:00〜10:05の部分集計。
- 「停止級事象」は30秒scrapeを1分バケットに丸め、連続するバケットを1つのrunとして継続時間を数えた。scrape欠落はrunを分断する。
- Node Ready数はkube-state-metrics由来のため、Readyの低下はkubeletの実停止だけでなく、kube-controller-managerがlease喪失後にNodeをUnknownへ遷移させた場合も含む。
- 今回の観測は前回RCA第2報（[rca-20261006.md](rca-20261006.md)）の集計と重なるが、問い（「何が原因か」ではなく「何を止める条件にするか」）が違うため、別の集計軸（継続時間・同時性）で取り直した。

## 2. baselineと現在値

### 2.1 停止級事象の実績（32.4日、1分解像度）

| 事象 | run数 | 最長 | 合計 | 備考 |
|---|---|---|---|---|
| apiserver 3台すべてscrape不可（監視経路からの観測不能。API停止の実績ではない） | 3 | 2分 | 5分 | 09-17 03:47、10-01 07:50、10-02 07:43 UTC。解釈は2.1.1 |
| apiserver 2台以上scrape不可（同上） | 10 | 6分 | 26分 | |
| etcd 全memberがleaderなし（quorum喪失相当） | 3 | 2分 | 4分 | 上記3件と同じエピソード |
| etcd いずれかのmemberがleaderなし | 9 | 3分 | 13分 | |
| CP Ready数 < 3 | 49 | 11分 | 160分 | 5分超は9回（約2回/週）。最長11分は09-30 03:01（旧dry-run中）と09-11 00:16 |
| CP Ready数 ≤ 1 | 3 | 2分 | 5分 | |
| 全Node Ready数 ≤ 5 | 10 | 4分 | 18分 | |
| API 5xx比率 > 5%（1分平均） | 1 | 1分 | 1分 | 10-02 07:41。20%超は0 |
| etcd container再起動 | 0 | - | - | 現在のrestart数1〜2は期間前のもの |
| kubelet / CRI-O再起動、kernel OOM / I/Oエラー / RCU stall、filesystem read-only | 0 | - | - | 3CPのuptime 38〜48日 |
| Longhorn volume degraded（robustness=2） | 8 run（6 volume） | 13.0分（単一volumeのrun経過時間） | サンプル被覆33.5分（67サンプル×30秒）/ run経過時間合計34.0分 | 10-02、10-04。faulted（robustness=3）は0サンプル。volume別の連続時間は2.1.2。現在はLonghorn APIで18 volume healthy |

#### 2.1.1 「apiserver scrape不可」の解釈（codex-review指摘対応）

上の表の「apiserver scrape不可」はPrometheusの`up{job="apiserver"}`が0または欠落した時間で、API自体が停止した実績ではない。Prometheus・ネットワーク・scrape経路（CNI）の障害でも同じ値になる。VIP経由や各CP直接の`readyz`成否はPrometheusに履歴がない（blackbox probe未導入）ため、32.4日間のAPI可用性実績は本書では評価できない。3件の「3台すべて不可」の窓（前後各5分、30秒解像度）で他のscrape対象を照合した結果は次の通り。

| 項目 | 09-17 03:40〜03:56 | 10-01 07:42〜07:58 | 10-02 07:35〜07:51 |
|---|---|---|---|
| Prometheus自身（self scrape、取り込みサンプル率） | up継続、取り込み継続（最小約4,200 samples/s） | up継続、取り込み継続（最小約6,100） | up継続、取り込み継続（最小約4,100） |
| apiserver `up` の欠落（33サンプル中） | CP1 2 / CP2 14 / CP3 9 | CP1 3 / CP2 17 / CP3 7 | CP1 10 / CP2 15 / CP3 7 |
| apiserver `up`=0 | CP1 3 / CP2 2 / CP3 0 | CP1 1 / CP2 0 / CP3 1 | CP1 4 / CP2 1 / CP3 0 |
| etcd `up`=0（CP別） | 0 / 10 / 2 | 0 / 11 / 2 | 10 / 10 / 3 |
| kubelet `up`=0（CP別、最大） | 3 / 14 / 6 | 2 / 14 / 4 | 12 / 13 / 7 |
| node-exporter `up`=0（3CP / 4 worker） | 4・14・8 / 2・2・2・1 | 2・14・5 / 0・2・1・2 | 12・17・7 / 4・4・5・2 |
| 窓内で再起動カウンタの増加が記録された時刻（kube-state-metrics経由） | apiserver CP1 03:49:30 / CP2 03:50:00 / CP3 03:48:30、kube-vip 03:45:30・03:48:30・03:49:30 | apiserver CP1 07:52:30 / CP2 07:51:30 / CP3 07:51:00、kube-vip 07:43:30・07:50:00・07:51:00・07:51:30 | apiserver CP1 07:49:30 / CP2 07:45:00、kube-vip 07:37:00・07:45:00・07:49:30 |

読み取り: (a) Prometheus自身は3窓とも稼働し取り込みを続けており、Prometheus停止による欠落ではない。(b) 「3台すべて不可」は`up`=0だけでなく系列の欠落（staleness）を含み、apiserverの`up`=0自体は各CPで0〜4サンプル（0〜2分）に留まる。(c) 同じ時間帯にworker 4台のnode-exporterも30秒〜2.5分到達不能になっており、CP上のetcd / kubelet / node-exporterは最大7〜8.5分到達不能だった。つまりPrometheusからはクラスタ全体の到達性が揺らいでおり、apiserver単独の停止とは切り分けられない。(d) 一方で3窓すべてで、同一窓内にapiserver（2〜3台）とkube-vip（2 Pod）の再起動カウンタ増加が記録されている。「3台すべて不可」の1分バケット（03:47 / 07:50 / 07:43）との時間差は、apiserverが+1.0〜+6.5分（09-17: +1.5 / +3.0 / +2.5、10-01: +2.5 / +1.5 / +1.0、10-02: +6.5 / +2.0）、kube-vipは−6.5〜+4.0分でバケットより前の増加（03:45:30、07:43:30、07:37:00）も含む。カウンタはkube-state-metricsをscrapeして得るため、実際の再起動時刻は欠落区間内にある可能性があり、scrape断との同時性や前後関係はこのデータでは確定できない。同一窓内にcontrol-plane側の事象（再起動）があったことは示すが、scrape断の原因がapiserver停止だとは断定しない。したがって「3台すべてscrape不可」は「監視経路からapiserver 3台を観測できなかった時間」に限定して扱う。VIP到達性・認証経路・etcd依存のreadinessが失敗していても`/metrics`のscrapeは継続し得るため、この値はAPI停止時間の上限にも下限にもならず、D4や再開判断の安全根拠には使わない。実際のAPI可用性は、更新中と更新後観測で`readyz`の成否を記録して評価する（3.5、5章A2）。

#### 2.1.2 Longhorn degradedのvolume別連続時間（codex-review指摘対応）

`longhorn_volume_robustness`（30秒サンプル）で値2（degraded）になった期間を、volume別に「60秒以内のギャップは連結」として連続runに分けた。faulted（値3）は0サンプル。

| 日時（UTC、run開始） | volume（PVC名） | replicaノード（当時のメトリクス上の`node`） | 連続時間 |
|---|---|---|---|
| 10-02 08:21 | storage-loki-0 | worker-4 | 1.0分（+ 08:23に0.5分） |
| 10-02 08:21 | prometheus-k8s-db | worker-4 | 8.5分 |
| 10-02 08:22 | tikv-tidb-cluster-tikv-2 | worker-4 | 1.0分 |
| 10-02 08:24 | codex-workspace-home | worker-4 | 5.5分 |
| 10-02 09:05 | etcd-snapshots | worker-3 | 2.0分 |
| 10-02 09:07 | prometheus-k8s-db | worker-4 | **13.0分**（最長） |
| 10-04 11:02 | tikv-tidb-cluster-tikv-0 | worker-4 | 2.5分 |

合計は8 run・6 volume・67サンプルで、サンプル被覆時間は33.5分（67×30秒）、run経過時間の合計は34.0分（連結した60秒以内のギャップ1箇所0.5分を含む）。この2値は定義が違うため一致せず、2.1の表には両方を記載した。H6のしきい値の根拠には「run経過時間」（最長13.0分）を使う。単一volumeの連続degradedの最長は13.0分で、すべて自己回復している。baselineにはノードdrainを伴う期間が含まれていない（更新run未実施）ため、drain中に更新対象ノード上のreplicaが停止して起きるdegradedは別扱いにする（3.2 H6、3.3）。

### 2.2 揺らぎ級事象の実績（日単位）

| 指標 | 09-04〜09-28（25日） | 09-29〜10-05（7日） | 10-06（部分） |
|---|---|---|---|
| etcd leader change / 日（member最大） | 0〜4、例外09-17=14、中央値1 | 8, 11, 20, 16, 5, 15, 0 | 3（すべて05:15以前） |
| apiserver再起動 / 日（3台合計、exit 137） | 0〜4 | 2, 3, 8, 4, 5, 4, 1 | 3 |
| kcm / scheduler / kube-vip再起動 / 日（3台合計） | 0〜8 / 0〜5 / 0〜7 | 1〜13 / 0〜10 / 2〜16 | 3 / 2 / 4 |
| etcd heartbeat送信失敗 / 日（member別） | 0〜604 | 0〜516 | 2〜94 |
| etcd slow apply / 日（3台合計） | 3,005〜17,981 | 13,116〜35,186 | 11,425 |
| etcd WAL fsync p99（日、ms） | CP1 32〜49、CP2 11〜15、CP3 11〜19 | CP1 43〜55、CP2 13〜25、CP3 14〜16 | 47 / 16 / 18 |
| CP MemAvailable日最小（MiB） | 205〜1,399（多くは220〜320） | 202〜282（10-05 CP1のみ712） | 273 / 227 / 259 |
| CP MemAvailable < 512MiBの時間 / 日 | 0〜461分 | 14〜364分 | 36〜106分 |
| CP major page fault日最大（/秒） | 0.5〜244 | 20〜253 | 148〜221 |
| CP iowait日最大（5分平均、%） | 1〜63 | 2〜78 | 21〜47 |
| apiserver WSS日最大（MiB） | 1,169〜2,764 | 1,629〜2,380 | 2,165〜2,299 |
| API 429 / 日 | 0〜30 | 10-01: 17,449、10-02: 4,285、他0〜280 | 1 |
| pods LIST / 日 | 14,800〜15,900 | 10-02から31,700〜38,400 | 16,145（10時間。同じ比率で継続） |

09-29以降の悪化は前回RCAで整理した通りで、本書では「baselineにはこの悪化期間も含まれる」ことだけを確認する。10-05はleader change 0、10-06は05:15以降0である。

### 2.3 現在値（2026-10-06 05:15〜10:05 UTC、前回RCA第2報の観測終了後）

| 項目 | 値 | baselineとの関係 |
|---|---|---|
| leader change / CP component再起動 / apiserver scrape断 / Node NotReady | すべて0（4時間50分） | 最も静かな状態。32日間に同程度の静穏区間は複数ある（例: 09-21、09-23、10-05） |
| Node / etcd / Longhorn | 7 Ready、etcd 3 member healthy（leader CP3）、18 volume healthy | 正常 |
| CP MemAvailable 4h50m最小（MiB） | CP1 1,230 / CP2 331 / CP3 638 | CP2はbaseline日最小（202〜316）に近く、余裕が最も小さい |
| CP major fault 4h50m最大（/秒） | 9〜18 | 逼迫しきい値（50）未満 |
| etcd slow apply 4h50m | 131 / 282 / 76 | 1日換算で約2,400件、baseline下限相当 |
| apiserver WSS 現在（MiB） | CP1 1,085 / CP2 1,665 / CP3 1,365 | CP1は03:39の再起動後で低い |
| kubelet（systemdサービス）常駐 現在（MiB） | CP1 646 / CP2 612 / CP3 709 | 4.1節参照。09-04時点の200〜330から単調増加 |

## 3. 最小Go/No-Go基準（提案）

設計方針: (a) 停止条件はbaselineで「起きていない、または最長でも2分以内」の事象に置き、継続時間のしきい値は原則としてbaseline最長値を上回る値にする。例外はH2 / H4で、3台中2台の冗長性を失った状態を更新中に許容する理由がないため、baseline最長値（6分）より短い安全側の上限にした。(b) baselineで日常的に起きる短時間の自己回復（leader change、apiserver / kcm / scheduler / kube-vipの再起動、数分のNotReady）は記録するだけで止めない。(c) 更新中のノード自身は「更新手順で止まる」ため、停止条件は原則として更新中ノード以外に適用する。(d) 既存のPrometheus alert（BOXP-179で導入済み）と同じしきい値はそのまま流用する。

### 3.1 開始条件（Go、各ノードのdispatch直前に確認）

| # | 条件 | 根拠 |
|---|---|---|
| G1 | 7 Node Ready、etcd 3 member up / healthy、VIP経由と3CP直接のreadyz成功、Longhorn 18 volume healthy | 現在値はすべて満たす |
| G2 | 直近30分にleader change 0、CP component（apiserver / kcm / scheduler / etcd / kube-vip）の再起動 0、Node NotReady 0 | leader changeの5分系列から実測: 「直近30分にleader changeなし」の状態は32.4日間の96.4%の時点で成立し、最悪日（10-01）でも86.5%。成立しない区間は46回で最長110分（60分超は2回）。無期限の待ちにはならない。component再起動とNotReadyはleader changeと同時に起きるため、これより大きく下がらないと見込むが、同じ方法での実測は未実施 |
| G3 | 3CPともMemAvailable > 400MiB かつ major fault < 50/秒が直近10分継続 | 逼迫中にdrain / 再起動を重ねない。10:05 UTCの瞬時値（CP2 565MiB、major fault 18/秒未満）は満たすが、05:15〜10:05の窓ではCP2の最小値が331MiBまで下がっており、10分継続はdispatch直前に確認する |
| G4 | 実施直前のetcd snapshotを新規作成し、非空性・hash・PVC取得・隔離restoreを確認済み（09-30 03:11のowner条件） | 09-30に手順実証済み。更新開始前に再作成する |
| G5 | 更新対象の固定SHAで全7台dry-runが成功済み | 09-30に実証済みだが、SHAが変わるため再実施 |
| G6 | H2の主判定に使うreadyz記録（5章A2: VIP経由と3CP直接の`readyz`を30秒間隔で実行し、失敗継続時にHaltし、結果をartifact / 台帳へ保存）が更新workflowと全台完了後の自動観測に実装済み | **現時点では未実装。** 既存の`upgrade-k8s.yml`と`kubernetes_upgrade` roleにあるreadyz確認は各CP更新直後の1回限り（`get --raw=/readyz`）で、定期実行・保存・Halt連動はない。A2を実装するまでH2は補助指標（scrape不可）だけで運用することになるため、A2の実装（別ticket、docs-onlyの本PRでは行わない）を更新再開の前提にする |

### 3.2 停止条件（Halt: 当該ノードで止め、次ノードへ進まない）

| # | 条件 | しきい値の根拠 | 既存alert |
|---|---|---|---|
| H1 | etcd up member < 2、または全memberでleaderなしが**2分以上**継続 | baseline最長2分（3回）。2分で既存alertと一致 | EtcdQuorumAtRisk（for 2m） |
| H2 | runnerからのVIP経由readyz失敗、または更新中ノード以外のapiserver 2台以上の直接readyz失敗 / scrape不可、が**3分以上**継続 | 主判定はrunnerが30秒間隔で記録するreadyz（3.5）。scrape不可は補助指標で、baselineの2台以上同時scrape不可は10回・最長6分（3台すべては3回・最長2分。いずれも監視経路からの観測でAPI停止の実績ではない。2.1.1）。baseline最長より短い安全側の上限で、理由は更新中に3台中2台のAPI冗長性を失った状態を続けないこと。3分は3台すべての最長（2分）を上回る | なし（新規rule候補A1） |
| H3 | 更新中ノード以外のNodeがNotReady / Unknownを**5分以上**継続 | 既存alertに一致。baselineでCP Ready<3の5分超は9回/32日あるため、更新中に当たる確率はゼロではないが「止めて回復を待つ」で足りる | ControlPlaneNodeNotReady（for 5m） |
| H4 | 更新中ノード以外で2台以上のCPが同時にNotReady / Unknownが**3分以上**継続（apiserverの同時断はH2で判定） | 同時複数CP障害はquorum喪失の前段。baselineのCP Ready ≤ 1は3回・最長2分で、3分はこれを上回る。H2と同じ上限に揃えた | なし（A1） |
| H5 | etcd container再起動、kubelet / CRI-Oのcrash、kernel OOM / I/Oエラー / filesystem read-onlyが更新中ノード以外で1件でも発生 | baseline 0件 | ControlPlaneFilesystemReadOnly |
| H6 | Longhorn volumeがfaulted 1件以上、または(a) 更新中ノード上のreplicaで説明できないdegradedが**15分以上**継続、または(b) 更新したノードがReady / uncordonに戻った後もdegradedが**15分以上**残る（rebuildが進まない） | volume別の連続degraded時間（2.1.2）: baseline 32.4日で最長13.0分（10-02 09:07 UTC、Prometheus DB volume）、他は8.5分以下、8 run・6 volumeすべて自己回復、faultedは0サンプル。15分はbaseline最長を上回る位置だが余裕は2分なので、超過時はまずLonghorn API（GET volumes）で当該volumeのrobustness / state / replicas[].hostId / rebuildStatusを確認し、rebuildが進行中なら5分延長して再判定、進行していなければHaltする。更新中ノード上のreplicaに起因するdegradedは3.3の許容範囲として扱う（baselineにdrain期間はないため、drain中の継続時間はbaselineで検証できていない）。判定手順: 観測窓中5分ごとにLonghorn API（GET volumes、読み取り）でvolumeごとのrobustness / state / replicaノードを記録する | なし |
| H7 | API 5xx比率 > 5%が**5分以上**継続 | baseline最長1分 | なし（A1） |
| H8 | 更新したノード自身の事後確認（Ready / uncordon、期待版、CRI-O、Longhorn、DNS / NetworkPolicy、worker-4ではGPU推論）が既存workflowのpost-checkで失敗 | 既存手順 | - |

### 3.3 許容する揺らぎ（記録のみ、単独では止めない）

| 事象 | 許容範囲 | 根拠 |
|---|---|---|
| etcd leader change | 観測窓（30分 / 60分）あたり3回以下 | baseline最悪日20回/日 ≒ 0.8回/時。3回/窓を超える場合は単独では止めず、H1〜H4の判定に委ねる（超過時にH1〜H4が伴うかどうかは本集計では検証していない） |
| apiserver / kcm / scheduler / kube-vipの再起動（exit 137 / 1 / 0） | 5分以内にRunningへ戻る | baselineで日常的（最大16回/日）。戻らなければH2 / H3に至る |
| 単一apiserverのscrape不可 | 10分以内 | baseline最長14分（101回）。10分を超えたら当該CPを個別確認し、H2の対象として扱う |
| いずれかのetcd memberのleaderなし | 3分以内 | baseline最長3分 |
| Node NotReady / Unknown | 5分未満で回復 | H3の裏返し |
| Longhorn degraded（更新中ノード上のreplicaに起因） | 更新中ノードがReady / uncordonに戻ってから15分以内にhealthyへ戻る | drain中はそのノード上のreplicaが停止するためdegradedになるのが通常挙動。baseline（drainなし）の単一volume連続degradedは最長13分（2.1.2）。戻らなければH6(b) |
| etcd slow apply / heartbeat送信失敗 / WAL fsync p99 < 500ms | 制限なし（件数を記録） | 既存EtcdHighFsyncDurationのしきい値（p99 > 0.5s、10分）だけを上限にする |
| CP MemAvailable低下 / major fault | 制限なし（記録） | 開始条件G3にのみ使う |
| 既存異常（検証環境のTiDB / PD CrashLoop、Argo CD OutOfSync、DNSConfigForming等） | 更新前後で件数が悪化しない限り不問 | 09-30 03:11のowner判断で形式的例外受容は不要 |

### 3.4 Halt後の扱い

1. Haltした時点で後続ノードのdispatchを止め、無条件再送・強制eviction・PDB削除・単純downgradeはしない（既存ルール）。
2. 停止事象が**30分以内に自己回復**し、その後G1〜G3を再び満たしたら、同じノードから再開してよい（owner承認は不要とする提案。baselineでは3台同時のscrape不可とetcd全memberのleaderなしは2分以内、CP NotReadyは最長11分で回復している）。
3. 30分以内に回復しない場合、またはH5 / H6が出た場合は中止し、Notes / 台帳にrun / attempt / 時刻 / SHA / gate / 状態を記録してownerへ戻す。rollbackはetcd snapshotからの復旧判断を含むためowner判断とする。
4. 既存異常の新規発生でも、3.2の各条件に該当しない限りHaltしない。

### 3.5 既存alertとの対応と自動判定

H1 / H3 / H5の一部は既存PrometheusRule `control-plane-node-rules`（BOXP-179）で既にalert化されている。H2 / H4 / H7とG2 / G3は未定義なので、5章A1として「記録用rule」を提案する。A1はH2 / H4 / H7とG2のleader change・component再起動・NotReady件数、G3のCP逼迫（MemAvailable<256MiB & major fault>50/s）を補助的に判定するもので、G1のVIP readyzやG3の「>400MiB・<50/秒が10分継続」はdispatch前のPrometheus即時クエリ / 直接readyzで別途確認する。H2の主判定であるVIP経由と3CP直接の`readyz`はPrometheusに履歴がない（blackbox probe未導入、2.1.1）ため、更新runner（GitHub-hosted）と全台完了後の自動観測scriptが30秒間隔で成否とHTTPコードを記録し、失敗が3分継続したらHaltし、結果をartifact / 台帳に残す必要がある（5章A2）。この処理は既存の`upgrade-k8s.yml`にはなく（既存のreadyz確認は各CP更新直後の1回限り）、本PRでは実装しない。実装はowner判断後に別ticketで行い、完了をG6として更新再開の前提にする。H6はLonghorn API（GET volumes）の5分間隔記録で判定する。更新workflowでの自動判定は、まずPrometheus即時クエリ（`count(up{job="etcd"}==1)`、`sum(up{job="apiserver"})`、`kube_node_status_condition`、`increase(etcd_server_leader_changes_seen_total[30m])`）で代替できる。

## 4. 本runで新たに確認した事実

### 4.1 kubeletの常駐メモリが単調増加している（確度 高、観測事実）

| ノード（各日の日最大値。2.3の「現在」は10:05時点の瞬時値で、CP3は716と709の差がこれに当たる） | 09-04 | 09-17 | 09-29 | 10-06 | 増加率 |
|---|---|---|---|---|---|
| CP1 kubelet WSS（MiB） | 200 | 402 | 573 | 647 | 約14MiB/日 |
| CP2 | 230 | 403 | 603 | 616 | 約12MiB/日（10-03以降は横ばい） |
| CP3 | 332 | 492 | 624 | 716 | 約12MiB/日 |

- kubeletのGo heap in-use（`go_memstats_heap_inuse_bytes`）も同じ傾向（CP1 199→566MiB、CP3 313→639MiB）で、goroutine数は横ばい（約350〜420）。ページキャッシュではなくヒープの増加である。
- worker（32GiB / 8GiB / 98GiB RAM）のkubeletも同様に増えている（worker-1 2.4→3.0GiB）。worker-4（v1.36.2）は09-15に一度下がってから再び増えており、1.36.2でも解消していない。原因（kubeletのどのキャッシュか）は本runでは特定していない。
- 3.9GiBのCPでは、この約400MiBの増分がMemAvailable（日最小200〜320MiB）より大きい。09-29以降の悪化（leader change増）とkubelet常駐の増加（09-29時点で約570〜620MiB）は時間的に重なるが、因果は確認していない（前回RCAの他の要因と同時期）。
- kubelet再起動（`systemctl restart kubelet`）はPodを止めず、静的Podも維持される。更新workflowはkubelet packageの更新で各ノードのkubeletを再起動するため、更新を1台ずつ進めればこの常駐が回収されると期待できる。ただし回収量は再起動後のkubelet WSSとMemAvailableを実測して初めて確定する（worker-4で09-15に一度下がった事例はあるが、CPでの実測はない）。

### 4.2 etcdのheartbeat / election timeoutがAnsible宣言と実機で食い違う（設定不一致は確度 高、影響は仮説）

- Ansible template `kubeadm-config.yaml.j2` は `heartbeat-interval=1000` / `election-timeout=10000` を宣言しているが、3CPの実etcd manifestにはどちらのflagもなく、etcd既定（100ms / 1000ms）で動いている。`tasks/kubeadm.yml` が実機manifestへ反映するのは `listen-metrics-urls` とresource requestだけ。
- `kube-system/kubeadm-config` ConfigMapのClusterConfigurationにもetcd extraArgsはない。更新roleは `kubeadm upgrade apply vX.Y.Z --yes`（`--config`なし）で、ConfigMapからmanifestを再生成するため、更新後も既定値のままになる。
- 【仮説】baselineではetcd apply遅延が1秒超〜数十秒に達するエピソードがあり、heartbeat送信失敗は日最大600件ある。既定1秒のelection timeoutがこの遅延分布の下でleader changeの一部に寄与している可能性があるが、timeoutを延ばしたときの効果は未検証で、遅延分布と障害許容度に依存する評価である。設定不一致そのものだけが観測事実。

### 4.3 その他の設定事実

- apiserver: memory request / limitなし（cpu request 250mのみ）、liveness failureThreshold 8、watch cache関連flagなし。kubeadm既定。
- kubelet: evictionHard / systemReserved / kubeReservedは既定、`failSwapOn: false`、swapBehaviorは既定（NoSwap）。
- ホスト: swap 0、Armbian zram-configは `ENABLED=true` / `SWAP=false`（zramデバイスは存在するがswapにしていない）、`vm.swappiness=100`、`vm.min_free_kbytes=8003`（約8MiB）、`vm.overcommit_memory=1`、kernel PSIなし、eMMCはmq-deadline、etcd dataはrootfsと同一デバイス（1.2GiB）。
- CP上の非control-plane Pod: calico-node（約230MiB、DaemonSet）、tigera-operator（143MiB、CP2）、goldmane（123MiB、CP1）、calico-apiserver（90 / 69MiB、CP1 / CP3）、calico-typha / whisker（CP3）、grafana-alloy（60〜71MiB、DaemonSet）、coredns 2台（CP1 / CP3）。CPはcontrol-plane taint付きで、これらはtolerationで乗っている。

## 5. hardwareを替えずに試せる改善候補（提案のみ、未実施）

いずれも本runでは実施していない。実施は別ticket / 明示指示で、1台ずつ・観測付きで行う。推奨順は「効果の確からしさ × 可逆性」で並べた。

| ID | 候補 | 期待効果 | 副作用・リスク | rollback | 検証指標 | 推奨 |
|---|---|---|---|---|---|---|
| K1 | kubelet再起動（1 CPずつ、`systemctl restart kubelet`） | 常駐約400MiB/CPを回収し、MemAvailable日最小を押し上げることを期待する（4.1の増分から推定した上限値で、回収量は再起動後の実測で確認する） | 再起動中約10〜30秒、当該ノードのkubelet API（logs / exec / probe）が止まる。Podは継続。baselineではkubelet再起動0なので、更新手順と同じ1台ずつ・観測付きで行う。再増加は続くため根治ではない（約1か月で戻る） | 不要（再起動のみ） | `container_memory_working_set_bytes{id="/system.slice/kubelet.service"}`、MemAvailable日最小、leader change / 日 | **更新手順に内包される**。更新前の単独実施はD3で判断 |
| E1 | etcd `heartbeat-interval` / `election-timeout` を実機manifestとkubeadm-config ConfigMapへ反映 | 1秒未満〜数秒のapply / fsync停滞でfollowerが選挙を始めるケースを減らし、leader changeとそれに伴うkcm / scheduler / kube-vip再起動を減らす（数十秒級の停滞は防げない） | leader実停止時の検知がelection timeoutぶん遅れ、その間API書き込みが待たされる。10,000msは上流上限（50,000ms）内だが大きいので、まず `heartbeat 500 / election 5000`（上流推奨比1:10）から始める案も併記。etcd静的Pod再生成でmember再起動（1台ずつ）。ConfigMapを直さないと次回 `kubeadm upgrade` で消える | manifestとConfigMapの行を戻す（1台ずつ） | leader change / 日、`etcd_server_heartbeat_send_failures_total`、`etcd_server_proposals_failed_total`、apiserver書き込みp99 | 高。Ansible templateの宣言と実機の不一致を解消する意味でも先に合意が必要 |
| P1 | CP上の非必須Podをworkerへ移す（tigera-operator、goldmane、whisker、calico-apiserver、calico-typha、coredns） | CP1 / CP2 / CP3でそれぞれ約200 / 140 / 150MiBの常駐を減らす | Calico Installation CR / Tigera設定とcoredns Deploymentのaffinity変更（Argo CD管理）。typha / calico-apiserverはCPがいなくても動くが、worker全滅時にCalico API（NetworkPolicy適用）が止まる構成になる。calico-nodeとgrafana-alloyは残す | Argo CDでmanifestを戻す | 各CPのMemAvailable日最小 | 中 |
| S1 | zram swapを有効化（`armbian-zram-config` の `SWAP=true`、容量はRAMの25〜50%） | kubeletのswapBehaviorが既定（NoSwap）のためPodはswapしない。ホストプロセス（kubelet約650MiB、crio等）のcold anonページが圧縮され、apiserver / etcdバイナリ用のページキャッシュ余地が増えてmajor faultが減る可能性 | 圧縮CPU負荷、swap in / out遅延。kubelet `failSwapOn: false` は設定済みだがkubelet起動時の警告が出る。効果は未検証（zram自体は3デバイスが既に存在） | `SWAP=false` へ戻しサービス再起動、`swapoff` | major fault日最大、MemAvailable日最小、iowait | 中〜低（効果の確度が低い） |
| S2 | `vm.min_free_kbytes` を8MiBから64〜128MiBへ | kswapdが早めに回収を始め、apiserver / etcdのdirect reclaim停滞を減らす | 常時64〜128MiBをfreeに保つため使えるメモリが減る。即時反映・即時戻し | `sysctl` で元の値へ | major fault、etcd slow apply | 低（効果小、安全） |
| O1 | 観測負荷の削減（agentやrunnerの全namespace `pods` LISTを避け、field selector / Prometheus集計へ） | pods LISTが10-02以降2倍（約38,000/日）で続いている。1件あたりのapiserver一時メモリとCPUを減らす | なし | なし | pods LIST / 日、429 / 日 | 高（リスクなし、即時） |
| A2 | VIP経由と3CP直接の`readyz`を30秒間隔で記録する（更新runner / 自動観測scriptのログ、または将来的にblackbox exporterの追加） | API可用性の実績をscrape到達性と区別して評価できる。2.1.1の未解決点（32日間のAPI可用性実績がない）を以後は解消できる | scriptはrunner側の記録のみで本番側の負荷なし。blackbox exporterを入れる場合はPod 1つ分の負荷と30秒ごとのreadyz要求（軽微） | scriptは記録のみ。exporterはmanifest削除 | readyz成功率、scrape断との一致 / 不一致 | 高（リスクなし。ただし未実装で、G6として更新再開の前提。本PRでは実装せず別ticket） |
| A1 | PrometheusRuleの追加（記録用: leader change burst（30分 / 60分窓の件数）、2+ apiserver down、2+ CP NotReady / Unknown、API 5xx > 5%、CP component再起動とNode NotReadyの30分内件数、CP逼迫=MemAvailable<256MiB & major fault>50/s） | 3章のH2 / H4 / H7とG2 / G3を自動判定できる。前回RCAの未説明4件の切り分け材料 | 評価負荷は軽微。通知先を既存Alertmanagerにすると警告が増えるので severity=info または記録専用 | ruleを削除 | - | 高（リスクなし） |

保留 / 不採用（前回RCAの結論を維持）: apiserver liveness failureThreshold緩和（自己回復経路を遅らせる）、apiserver memory request / limit（使用量は下がらず、limitはOOM-kill経路）、組み込みリソースのwatch cache無効化（etcd負荷増）、kubelet eviction / systemReservedの再設計（apiserverの使用量を下げない）、kernel PSI有効化（reboot前提）。

## 6. 1.36 patch更新再開に関する評価

- baselineのうち監視経路からapiserver 3台すべてが観測不能になった事象 / etcd全memberのleaderなしは32日間で3エピソード（各2分以内）で、いずれも更新作業とは無関係に起きている。前者はAPI停止の実績ではなく（2.1.1）、VIP経由のAPI可用性実績は本書では評価できていない。そのため更新中はrunnerのreadyz記録（A2）を主判定にし、scrape断は補助指標に留める。CP NotReadyの5分超（9回、最長11分）と2台以上のapiserver同時断（10回、最長6分）はこれより多く、H2〜H4でHaltし3.4で再開する運用を前提にする。この頻度では、1台あたり30〜60分の更新 / 観測窓に当たる確率は低く、当たった場合も3.4の「30分以内の自己回復」で再開できる。
- 更新手順のdrain / kubelet再起動 / 静的Pod再生成はCPのメモリ逼迫を一時的に強める可能性がある。K1の効果（kubelet常駐回収）が実測通りなら更新後のCPは更新前より余裕が増えると期待できるが、これは仮説で、1台目の更新後に実測して2台目以降の判断材料にする。CP1→CP2→CP3の順で1台ずつ進めれば、常に2台のetcd memberが安定側にある。
- 一方、E1を更新後に回す場合、更新中のetcd election timeoutは既定1秒のままで、baselineと同じ頻度のleader changeを許容しながら進めることになる（3.3の範囲）。
- したがって更新再開の阻害要因は「異常ゼロでないこと」ではなく、G6（A2のreadyz連続記録・Halt連動・保存の実装。未実装のため別ticketで先に実施）、G4（実施直前snapshot）とG5（固定SHA dry-run）の再実施、およびD1〜D3のowner判断である。G6が未実装の間はH2の主判定が存在しないため更新を再開しない。

## 7. 取得方法と限界

- Kubernetes API GET: nodes、leases、pods、events（件数）、configmaps（kubeadm-config / kubelet-config）、prometheusrules、longhorn volumes。
- SSH（3CP、読み取りのみ）: free / meminfo / sysctl / zram設定 / ブロックデバイス設定、etcd・apiserver manifestのflag名、kubelet config.yamlの設定キー、直近1時間のkubelet journalパターン件数（0件）。raw logs・証明書パス・IPは本書に転記しない。
- Prometheus: CP1のadmin kubeconfig経由でPrometheus Pod内のpromtoolを実行し、範囲クエリ（日単位32本、1分解像度を週分割で30本、その他8本）と即時クエリ約25本の集計値のみ取得。codex-review指摘対応（2.1.1 / 2.1.2）で範囲クエリ12本（scrape断3窓の`up` / container再起動 / Prometheus取り込み率、Longhorn robustnessの日別・2日分）を追加取得した。本調査のAPI負荷はこのexecとGET数十回で、2.2のpods LIST増加には寄与していない（LISTはpods全体で数回）。
- 限界: audit logなし、PSIなし、container logは直近1時間。kubelet常駐増加の内訳（どのキャッシュか）はpprof未取得のため不明。VIP / 各CP直接の`readyz`履歴はなく、apiserverのscrape不可はAPI停止の実績ではない（2.1.1）。Longhornのfaulted / degraded区別はPrometheusの`longhorn_volume_robustness`の値（2 / 3）で行い、volume別連続時間は30秒サンプルを60秒以内のギャップで連結して数えた（2.1.2）。baselineにノードdrain期間は含まれない。1分バケット化のため30秒〜1分の瞬断は「1分」として数えている。

## 8. 参照

- 前回RCA: [rca-20260930.md](rca-20260930.md)、[rca-20261006.md](rca-20261006.md)（改訂5）、[rca-observation-20261006.json](rca-observation-20261006.json)
- 今回の集計: [baseline-observation-20261006.json](baseline-observation-20261006.json)
- 既存alert: lolice `monitoring/control-plane-node-rules`（BOXP-179 runbook参照）
- etcd公式 [Tuning](https://etcd.io/docs/v3.6/tuning/)（heartbeat / election timeoutの上流推奨: election timeoutはheartbeatの10倍、上限50,000ms）、[Performance](https://etcd.io/docs/v3.6/op-guide/performance/)
- Kubernetes v1.36 [Swap memory management](https://kubernetes.io/docs/concepts/cluster-administration/swap-memory-management/)（swapBehavior既定NoSwap）、[kubeadm upgrade](https://kubernetes.io/docs/reference/setup-tools/kubeadm/kubeadm-upgrade/)（ClusterConfigurationはkube-system/kubeadm-configから読む）
