# BOXP-201 作業計画

2026-09-30。親ticketの成果は設計とレビュー用PR。runner実装、Deployment rollout、Argo sync、cron変更、既存ticketのlane/assignee変更は別ticketで行う。本計画の承認を自律作業開始の新しい必須工程にはしない。

- [x] 指定run worktreeとgit状態、Notes、vault仕様、runner/helper/testsをread-only調査する。
- [x] 現状のlane/assignee依存と既存の自動retryを区別し、実行意図・権限境界・条件付き継続を設計する。
- [x] Policy matrix、Decision Packet、Blocked retry、WIP/通知、競合/監査/秘密保護の最小契約を記述する。
- [x] 対象path・test・rollout/rollback・人間判断境界付きの分割ticket案を作成する。実カードは作成せず、割当/起動を発生させない。
- [x] 文書のリンク・schema例・acceptance coverage・差分を検証し、commit/pushとレビュー用PR作成を行う。

成果: [設計](design.md)、[分割ticket案](implementation-tickets.md)、[owner用Decision Packet](decision-packet.md)。

検証: 4文書のローカルリンク/コードフェンス、4件のYAML例のparse、差分レビュー、git diff --check。実装変更なしのためrunner回帰testは今回実行せず、後続ticketに必須testを記載。全体security checkの`trivy config .`はcommand not foundで未実施。要求されたcodex-review/codex-review-fileスキルとterra_worker委譲先が利用できず、直接レビューした。

PR gate再試行: P1「Decision Packetの自己承認防止」を修正。packet statusと承認権限を分離し、owner専用認証経路・署名付き不変event・専用store・現在head/revision/scopeの照合・一回消費を設計へ追加。I6に偽装/未検証resolved/署名不正/認証経路へのagent書込/並行消費の拒否testを追加し、owner packetにも境界を明記する。文書のみで本番承認経路は作成しない。

再検証: リンク/フェンスと5件のYAML例parse（bb clj-yaml）、diff checkを通過。低コストCodex CLI（gpt-5.6-terra）へ独立レビューを委譲し、I7の実環境credential分離gate不足を検出、canary有効化前の必須AC/否定testとして追記した。
最終独立レビュー: gpt-5.6-terraが `CODEX_REVIEW_RESULT: clean` を返し、既知の自己承認防止とI7の分離gateを確認。

追加PR gate指摘への対応: owner要約を設計フィードバック依頼、Decision Packet YAMLを未発行テンプレートと明示した。プレースホルダを含む例を承認記録に使用せず、I6/I7検証後に完全SHA・現在revision・具体UTC期限を確定した別packetを発行する。今回の回答から実行許可を生成しない。

今回の再検証: 4文書のリンク/フェンス、5件YAML例parse、git diff --checkを通過。gpt-5.6-terra独立レビューはsandboxの読取エラー後に全文と差分を入力して再実行し、`CODEX_REVIEW_RESULT: clean`。Trivyは引き続き実行ファイル不在。

PR全体の独立レビュー追加指摘: I6のACをローカルmock/契約検証へ限定し、実サービス/store実装・配置とcredential分離はI7の責務と明示。配置先・運用責任者確定までI7未完了、human-dependent effect無効とする。

追加独立指摘対応: issuance=templateを承認/実行入力で拒否し、issuedもhead/期限の具体値を検証。制御原本はagent書込不可、owner/runnerの変更権限と単調revision/event、budget epochを越えない消費累積を明記。I1/I2/I3/I6/I7へ拒否testと配布gateを追加。

今回のPR gate指摘対応: lease非対応の旧runnerに対するwriter fencingを明文化。I7に旧Deployment replica=0・全起動元抑止・全host/helper/agent子process不在・旧credential/mount/起動権限剥奪・単調writer_generationの必須gateと否定testを追加した。切戻しも対称に停止/剥奪し、legacyからv2対象を隔離できなければ復帰しない。文書だけの変更であり、これらの本番操作は後続I7の別PR/owner判断で行う。

今回の検証: 4文書のリンク/フェンス・5 YAML例parse・git diff --check成功。低コストgpt-5.6-terra CLIの全文入力による独立レビューはcleanで、旧writer fencingと対称rollbackを確認。terra_workerは利用不可、review skillsは未検出、Trivyは実行ファイル不在。本番操作は行っていない。

全体レビュー追加指摘: 目的とscopeの一致に必要な不変要求snapshot・ticket要求版・SHA-256をcontrol原本の必須fieldにし、ownerだけが新要求を発行する契約を追加。I1/I2/I3に改変/別目的/agent本文変更の拒否とNotes更新の非影響を記載。digestを意味的達成の証明にせず、固定ACに対するinspectを必須とした。
