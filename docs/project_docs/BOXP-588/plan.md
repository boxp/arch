# BOXP-588: 有効な条件を票の項目（Conditions）にして、履歴の Notes と分ける

正本: Obsidian `Projects/model-usage-attribution/active-conditions-design.md`（Owner が 8章 A＝段階実装を承認、2026-11-18）。
旧案（#15226: prompt を作るときに Notes の語句から「残す条件」を見分けて古い Notes を省く）は取り下げた。言い回しは無限にあり、漏れる例を必ず作れるため。

## 段階

| 段階 | 内容 | 入力の削減 | この PR |
|---|---|---|---|
| 1 | Conditions 項目（CD-NN）の解析、登録と取消の命令、版（rev）への組込み、prompt での案内、Hermes skill の書き方 | なし（何も省かない） | ○ |
| 1.5 | Conditions を前の時点と比べ、手での削除・書換え・取消を見つける検査（下の「この PR に入れないもの」） | なし | 別 PR。段階 3 より前に入れる |
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
| 【承認】 | Owner が許した範囲 | `--source` が Owner の経路（`hermes-agent`・`owner`・`boxp`）で、Owner の返答（`--reply-id` か `--event`）があるとき。環境変数 `CODEX_TASK_BOARD_RUN_ID` がある process（runner が起動した担当）からは命令が拒否する |
| 【制約】 | 禁止、範囲の限定、他票との取決め、止める条件 | 誰でも |
| 【要確認】 | 有効か判断できないもの。制約として扱う | 誰でも |
| 【取消】 | 無効になった項目。行・本文・由来は残る | 登録した発信元か Owner の経路。Owner 由来の項目（【承認】、または由来が Owner の経路の項目）は、`--source` が Owner の経路で、`CODEX_TASK_BOARD_RUN_ID` が無い process から |

### 命令（`task_board_todos.bb`）

- `conditions add ID --kind 承認|制約|要確認 --text 本文 --source 発信元 [--reply-id R|--event E] [--note-at 日時]`
- `conditions cancel ID CD-NN --reason 理由 --source 発信元 [--reason-kind 取消|置換|履行済み] [--replaced-by CD-MM]`
- `conditions list ID [--json]`
- 登録と取消は Notes にも 1 行残す。同じ種別・本文・発信元の再実行は何もしない。

### 版（rev）と保留

- CD 項目を既存の TODO の版に含める。作業中に条件が足されたり取り消されたりすると、既存の仕組み（ツール境界の通知、ack、古い版の結果の保留）でそのまま担当に届く。新しい通知や予算は作らない。
- **CD 項目が 1 件も無い票の版は、変更前と同じ値**（テストで固定）。配備しても既存の票の ack は無効にならない。
- 今の票だけを見て決まる検査を 2 つ入れる。どちらも、版を ack した後も、該当の行が票にある間は続く（v1 でも従来の票でも同じ）。
  - 読めない行（形が違う、本文が空、同じ ID が 2 行以上）。
  - Owner の返答が無い【承認】（由来が Owner の経路でない、または `reply_id` / `event` が無い）。
  - この間、done の結果は保留になり、hook は merge・配備の命令を拒否する。blocked の結果は保留にしない（担当が Owner に渡す手段なので。直せるのは Owner の経路）。continue も保留にしない。
- **命令が見ているのは「run の間かどうか」ではなく、呼び出した process に `CODEX_TASK_BOARD_RUN_ID` があるかどうか。** Owner の経路（Hermes）は担当の run が動いている間でも登録・取消ができ、それは版の変更として担当に届いて、ack まで done / blocked が保留になる（テストで固定）。
- 発信元は `--source` に書かれた名前、担当かどうかは環境変数で判定する。どちらも担当が変えられるので、命令の拒否は誤りを止めるもので、担当が意図して偽る場合は止められない。

### この PR に入れないもの（段階 1.5 の別 PR）

- **段階 1 では、Conditions の項目を手で消す・書き換える・手書きで【取消】にする変更は検出しない。** 前の時点の Conditions と比べる検査（run の開始時の記録と終了時の比較、次の run への基準の引継ぎ、run の途中で初めて見た項目の記録、Owner による現状の受入れ命令）はこの PR から外した。停滞レビュー BOXP-610 の判断による。理由は 2 つ。(1) 基準のファイルも発信元の名前も環境変数も担当が書けるので、今の置き場所では閉じた保証にならない。(2) 段階 1 は何も省かず、Owner の返答は Notes にも残って毎回全文で渡るので、検出が無くても変更前より悪くならない（担当は今でも Summary や Notes を書き換えられる）。
- この検査は、古い Notes を省いて Conditions だけが条件を運ぶようになる段階 3 より前に、別 PR で入れる。そこで先に決めること: 基準を担当が書けない場所に置けるか。置けないなら「誤りと手編集を見つける点検で、意図した偽りは対象外」と範囲を限って書く。外したコードは branch `boxp-588-conditions-detection` に残してある。

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

- `bb tests/codex-workspace/task-board-todos-test.bb`: 解析（節の外・fence 内・読めない行・重複）、版（項目なしは不変、項目の各部分で変わる）、保留（v1 / legacy、未受領）、今の票だけで決まる検査 2 つ（`conditions-problems`: done は保留、continue と blocked は通る。削除や書換えは検出しないことも固定）、命令（発信元、`CODEX_TASK_BOARD_RUN_ID` の有無、再実行、取消の形）、hook（`conditions-hook`: ack 後も merge 拒否）、run の間の Owner 経路の取消（`conditions-owner-path-during-a-run`: 担当の process は拒否、Owner の経路は成功、担当には版の変更として届き ack まで保留）、prompt の案内。
- `tests/codex-workspace/task-board-runner-test.sh` の `test_conditions_midrun`: 実際に runner を回し、run 中に手で書かれた返答なしの【承認】で done が保留になること、次の run でも残っていれば保留が続くこと、run の間に Owner の経路が取り消すと未受領の版として保留になり、その次の run で done になること、prompt に Conditions 節と案内が全文で入ること。
- 既存の runner テスト全 shard。

## 配備と確認

- merge → codex-workspace と hermes-agent の image 配備 → runner の復帰を確認。
- 実反映の確認: 配備後の prompt に案内が入ること、既存の票の rev が配備前と同じこと、この票（BOXP-588）で実際に項目を登録・一覧できること。

## 切戻し

revert。登録済みの `## Conditions` 節は票に残るが、旧 helper では版に含まれないだけで害はない。

## 残ること

- 段階 2 の植込み試験と BOXP-360 の移行試行（抽出 → 別担当の独立確認 → 【要確認】だけ Owner に提示）。止める条件: 独立確認の後も漏れが残る、または Owner 由来の条件の漏れが 1 件でも見つかる。
- 段階 1.5 の検査（上記）。
- 段階 3 の省略（`conditions_through`）と棚卸しの命令。
- dotfiles 側の task-board skill の説明文の同期（helper の写しは dotfiles には無い）。
