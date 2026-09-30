# BOXP-201 作業計画

2026-09-30。親ticketの成果は設計とレビュー用PR。runner実装、Deployment rollout、Argo sync、cron変更、既存ticketのlane/assignee変更は別ticketで行う。本計画の承認を自律作業開始の新しい必須工程にはしない。

- [x] 指定run worktreeとgit状態、Notes、vault仕様、runner/helper/testsをread-only調査する。
- [x] 現状のlane/assignee依存と既存の自動retryを区別し、実行意図・権限境界・条件付き継続を設計する。
- [x] Policy matrix、Decision Packet、Blocked retry、WIP/通知、競合/監査/秘密保護の最小契約を記述する。
- [x] 対象path・test・rollout/rollback・人間判断境界付きの分割ticket案を作成する。実カードは作成せず、割当/起動を発生させない。
- [x] 文書のリンク・schema例・acceptance coverage・差分を検証し、commit/pushとレビュー用PR作成を行う。

成果: [設計](design.md)、[分割ticket案](implementation-tickets.md)、[owner用Decision Packet](decision-packet.md)。

検証: 4文書のローカルリンク/コードフェンス、4件のYAML例のparse、差分レビュー、git diff --check。実装変更なしのためrunner回帰testは今回実行せず、後続ticketに必須testを記載。全体security checkの`trivy config .`はcommand not foundで未実施。要求されたcodex-review/codex-review-fileスキルとterra_worker委譲先が利用できず、直接レビューした。
