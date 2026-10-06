# BOXP-194: control-plane不安定の読み取り専用RCA

2026-09-30 04:15 / 04:39 UTCの指示が本runの範囲。旧Kubernetes patch更新計画は実行しない。

1. 旧runのCP2 restart、CP3 readyz失敗、etcd遅延、CP3 NotReadyをUTC時系列で整理する。
2. 許可済みSSHと限定的なKubernetes GET、etcd endpoint health、既存metrics取得で現在状態を確認する。既存Podへのexecはetcdctl endpoint healthの読み取りだけに限定する。
3. ホスト負荷・サービス稼働・既存ログの集計とmetricsの短区間差分を照合し、事実と仮説を分ける。調査自体の負荷とログ保持範囲も明示する。
4. IP、private endpoint、credentials、Secret、raw logsを含めない要約を独立レビューし、旧更新準備PRと分離したdocs-only PRでReviewへ提出する。

update/drain/Apply、workflow dispatch、snapshot作成/restore、package変更、reboot、Pod/Node削除、etcd member操作、manifest変更、Argo sync、Secret参照/出力は実施しない。復旧変更は根拠・影響・rollbackをレビュー可能にした後、別途明示指示が必要。Task Board laneはrunnerが管理する。

本調査の完了は更新完了・復旧完了・更新再開許可を意味しない。
