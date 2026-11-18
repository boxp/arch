# BOXP-588: 有効な条件を票の項目（Conditions）にして、履歴の Notes と分ける

正本: Obsidian `Projects/model-usage-attribution/active-conditions-design.md`（Owner が 8章 A＝段階実装を承認、2026-11-18）。
旧案（#15226: prompt を作るときに Notes の語句から「残す条件」を見分けて古い Notes を省く）は取り下げた。言い回しは無限にあり、漏れる例を必ず作れるため。

## 段階

| 段階 | 内容 | 入力の削減 | この PR |
|---|---|---|---|
| 1 | Conditions 項目（CD-NN）の解析、登録と取消の命令、版（rev）への組込み、prompt での案内、Hermes skill の書き方 | なし（何も省かない） | ○ |
| 2 | 植込み試験（言い回しを変えた既知の制約を実票の写しに混ぜ、抽出と独立確認が拾う数を数える）と、BOXP-360 での 1 票の移行試行 | なし | 別作業（コード変更なし） |
| 3 | 結果が良ければ、棚卸し済みの時点（`conditions_through`）より前の Notes だけを prompt から省く。移行していない票は全文のまま | あり | 別 PR |

③（同じファイルへの重大指摘が続いたら設計の見直しを促す）は独立した #15327。

## この PR（段階 1）で入れるもの

### 票の形

`## Acceptance Criteria` の後に `## Conditions` 節を置く（最初の登録時に helper が作る。既存の票は書き換えない）。

```markdown
## Conditions

- CD-01【承認】今回は設計のみ。merge・配備はしない
  - 由来: hermes-agent reply_id=…
- CD-02【制約】docker/hermes-agent/** は変更しない
  - 由来: claude-fable@BOXP-546 （Notes 2026-11-14 00:46:47）
- CD-03【要確認】受信箱の形は変えない、が今も有効か不明
  - 由来: claude-fable
- CD-04【取消】外部送信は 1 日 1 回まで
  - 由来: hermes-agent reply_id=…
  - 取消理由: 置換（CD-01） …
  - 取消者: hermes-agent reply_id=…
```

| 種別 | 意味 | 登録できる発信元 |
|---|---|---|
| 【承認】 | Owner が許した範囲 | Owner の経路（`hermes-agent`・`owner`・`boxp`）だけ。Owner の返答（`reply_id` か `event`）が必須。Task Board の run の中からは不可 |
| 【制約】 | 禁止、範囲の限定、他票との取決め、止める条件 | 誰でも |
| 【要確認】 | 有効か判断できないもの。制約として扱う | 誰でも |
| 【取消】 | 無効になった項目。行・本文・由来は残る | 登録した発信元か Owner の経路。Owner 由来の項目は Owner の経路だけ（run の外） |

### 命令（`task_board_todos.bb`）

- `conditions add ID --kind 承認|制約|要確認 --text 本文 --source 発信元 [--reply-id R|--event E] [--note-at 日時]`
- `conditions cancel ID CD-NN --reason 理由 --source 発信元 [--reason-kind 取消|置換|履行済み] [--replaced-by CD-MM]`
- `conditions list ID [--json]`
- 登録と取消は Notes にも 1 行残す。同じ種別・本文・発信元の再実行は何もしない。

### 版（rev）と保留

- CD 項目を既存の TODO の版に含める。作業中に条件が足されたり取り消されたりすると、既存の仕組み（ツール境界の通知、ack、古い版の結果の保留）でそのまま担当に届く。新しい通知や予算は作らない。
- **CD 項目が 1 件も無い票の版は、変更前と同じ値**（テストで固定）。配備しても既存の票の ack は無効にならない。
- run の開始時の Conditions を `todo-start.edn` に記録し、終了時と比べる。規則外の変更（項目の削除・書換え、決まった形でない取消（本文と由来を残し、取消理由と取消者を足す）、Owner の返答のない【承認】、読めない行の出現、開始時に読めなかった行の変更（取消への書換えや形の修正を含む。種別も由来も確かめられないので run の間はそのまま残し、Owner 経路で直す））があれば、done / blocked の結果を保留にする（既存の TODO 保留と同じ扱い）。continue の結果は保留にせず、Notes に検出を記録する。
- 読めない行が票に残っている間は、v1 でも従来の票（legacy）でも、新しい版を ack しても done / blocked は保留になり、merge・配備の命令は拒否される。
- 同じ比較を作業中の hook（merge・配備の直前、終了時）でも行う。規則外の変更が残っている間は、新しい版を ack しても merge・配備の命令は拒否される。項目を元どおりに戻せば解ける。
- 発信元は票に書かれた名前で判定する。誤りと手編集を見つける仕組みで、発信元を偽った書込みまでは防がない（担当は今も票の全体を書ける）。

### prompt

- 既存の TODO の案内の後に、Conditions の読み方と登録の命令を 1 段落足す（有効な件数、読めない行があればその ID）。
- **票の本文は全文のまま。何も省かない。** Conditions 節は票の本文の一部としてそのまま入る。

### Hermes

- `docker/hermes-agent/skills/obsidian-task-board/SKILL.md` に、Owner の返答を記録するとき承認を【承認】、取次ぎで足した注意を【制約】として登録する手順を追加。helper の写しを同期。

## 変えないもの

- 既存の票の内容（一括の書換えなし）、Notes の扱い、停滞判定の入力。
- gate の基準、P0/P1 の扱い、retry の上限、gate 失敗予算、継続の上限。
- TODO（TD）の動き。

## 検証

- `bb tests/codex-workspace/task-board-todos-test.bb`: 解析（節の外・fence 内・読めない行・重複）、版（項目なしは不変、項目の各部分で変わる）、保留（v1 / legacy、未受領、規則外の変更）、命令（権限、run の中かどうか、再実行、取消の形）、prompt の案内。
- `tests/codex-workspace/task-board-runner-test.sh` の `test_conditions_midrun`: 実際に runner を回し、run 中に Owner 由来の項目を手で消すと done が保留になること、continue では Notes に記録されること、prompt に Conditions 節と案内が全文で入ること。
- 既存の runner テスト全 shard。

## 配備と確認

- merge → codex-workspace と hermes-agent の image 配備 → runner の復帰を確認。
- 実反映の確認: 配備後の prompt に案内が入ること、既存の票の rev が配備前と同じこと、この票（BOXP-588）で実際に項目を登録・一覧できること。

## 切戻し

revert。登録済みの `## Conditions` 節は票に残るが、旧 helper では版に含まれないだけで害はない。

## 残ること

- 段階 2 の植込み試験と BOXP-360 の移行試行（抽出 → 別担当の独立確認 → 【要確認】だけ Owner に提示）。止める条件: 独立確認の後も漏れが残る、または Owner 由来の条件の漏れが 1 件でも見つかる。
- 段階 3 の省略（`conditions_through`）と棚卸しの命令。
- dotfiles 側の task-board skill の説明文の同期（helper の写しは dotfiles には無い）。
