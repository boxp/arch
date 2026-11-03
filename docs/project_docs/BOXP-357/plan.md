# BOXP-357: Task Board の担当更新後に票だけ boxp へ戻る不整合の修正

## 観測（BOXP-354, 2026-10-29 UTC）

両 pod の `ob sync` ログと runner ログから、次の順序を確認した。

| 時刻 | hermes-agent replica | codex-workspace replica |
| --- | --- | --- |
| 00:34:08.47 | 票 upload（Notes 追記版） | 00:34:08.85 Accept |
| 00:34:08.93 | 盤 upload（Ready / codex-sol） | 00:34:09.35 Accept |
| 00:34:26.94 | | runner tick: `sync-ticket-statuses!` が盤 lane `Ready` を古い票（review / boxp）へ投影し、票全体を書き直す |
| 00:34:28.70 | 票 upload（update 版: ready / codex-sol）。ob は同一ファイルを約 20 秒間隔でしか再 upload しない | |
| 00:34:28.86 - 29.04 | | 票 upload（ready / boxp）。server 上で後勝ち |
| 00:34:29.23 | codex-workspace の票を Accept。codex-sol が消える | |
| 00:34:57 - 00:41:59 | | 354 は候補にならない（assignee boxp） |
| 00:41:48 | 再 update | 00:42:00 着手 |

原因: Obsidian Sync はファイル単位の後勝ちで、2 つの replica が同じファイルを同時に書くと片方の書き込みが失われる。runner は lane を正本として票の status を投影するが、そのとき盤だけが届いていて票がまだ古い replica を基準に、票全体を書き戻していた。helper の update は票と盤を別々のファイルとして書き、Notes 追記と frontmatter 更新も別の書き込みになる。そのため盤が先に届く窓が普通に起きる。

## 整合ルール

- lane（status）の正本は盤のカード。runner は従来どおり lane を票の status へ投影する。
- 担当（assignee）と着手判定の正本は票の frontmatter。カードの `assignee::` は表示用の写しで、runner はこれを着手判定に使わない。盤には、カードは agent を指しているのに票は boxp という Ready カードがすでに多数あるため。
- helper の `create` / `update` / `request-codex` は、毎回新しい改訂 token を票の `board_rev:` とカードの `rev::` の両方に書く。
- 新しい token を発行するのは、lane か assignee が変わる update のときだけ。Notes や本文だけの update は今の token を引き継ぐ。
- runner は、カードに `rev::` があって票の `board_rev` と一致しない間は、その票は「同期途中」とみなす。投影の書き込みも着手もせず、ログに残す。
  - まずはもう一方のファイルの到着を待つ。閾値（既定 300 秒）を超えても一致しなければ、片側だけ書けた失敗として WARN を出し、新しい側に合わせて古い側を直す。
  - 票のほうが新しい場合は、helper が書いた完全な状態とみなし、カードを票に合わせて直す。盤ファイルは全カード共通なので、別カードの書き込みで巻き戻されることがある。
  - カードのほうが新しい場合は、票の frontmatter をカードに合わせて直す。
  - 閾値を待たずに直すと、helper がもう一方のファイルを書き込んでいる途中のところを上書きしてしまう。
- 実行中に新しい改訂（helper による再割当）が届いた場合、古い run の完了処理は lane / assignee を上書きしない。新しい指示を残し、次の tick で通常どおり拾わせる。
- runner が完了時に票の assignee を boxp にするときは、カードの `assignee::` も同じ書き込みで揃える。

## 実装

- `docker/hermes-agent/skills/obsidian-task-board/bin/task-board.bb`
  - rev token の生成と書き込み。`update --note` で Notes 追記と frontmatter 更新を 1 回の票書き込みにまとめる。
  - `show` で整合性（rev 一致、assignee 一致、重複カード）を報告する。
  - `verify-dispatch` で同期後の状態（同期途中 / 着手待ち / 着手済み / 巻き戻り）を 1 回だけ判定する。sleep しない。
- `docker/codex-workspace/task-board/task_board_runner.bb`: 上記の保留、superseded 判定、カードの assignee 同期。
- `docker/hermes-agent/skills/obsidian-task-board/SKILL.md`: 更新、同期後の検証、着手確認の手順。
- `tests/codex-workspace/task-board-runner-test.sh`: 回帰テスト。

## 検証

- unit / black-box テスト（CI）、独立 review。
- 配備後、実同期の往復（hermes の update が codex-workspace に届くこと）と、通常 scheduler による pickup を確認する。
