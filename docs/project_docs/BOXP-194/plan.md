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
2. monitoring namespaceのPrometheus 31日履歴をpromtoolの集計値だけで取得し、leader change全41バケットについてCPごとのメモリ / fault / IO / CPU / apiserver WSSを照合する。
3. 30日トレンドとapiserver要求構成（verb / resource）から恒常負荷と09-29以降の変化を分ける。
4. 結果を[rca-20261006.md](rca-20261006.md)と[rca-observation-20261006.json](rca-observation-20261006.json)に保存し、docs-only PRでReviewへ提出する。復旧案は提案のみで未実施。

結論は「control-planeのメモリ逼迫（apiserver WSS約2GiB超、MemAvailable約200〜300MiB、swapなし）→major page fault→同一eMMC上のetcd停滞→liveness失敗でapiserver SIGKILL→leader change」の連鎖。Kubernetes 1.36 patch更新の再開は、復旧案の実施とleader change / 再起動の収束を確認するまで推奨しない。
