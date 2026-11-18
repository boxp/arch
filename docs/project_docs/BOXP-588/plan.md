# BOXP-588: 有効な条件を票の項目（Conditions）にして、履歴の Notes と分ける

正本: Obsidian `Projects/model-usage-attribution/active-conditions-design.md`（Owner が 8章 A＝段階実装を承認、2026-11-18）。
旧案（#15226: prompt を作るときに Notes の語句から「残す条件」を見分けて古い Notes を省く）は取り下げた。言い回しは無限にあり、漏れる例を必ず作れるため。

## 段階

| 段階 | 内容 | 入力の削減 | PR |
|---|---|---|---|
| 1 | Conditions 項目（CD-NN）の解析、登録と取消の命令、版（rev）への組込み、prompt での案内、Hermes skill の書き方 | なし（何も省かない） | #15338（merge 済み） |
| 1.5 | 命令が書いた項目の記録（`conditions_seal`）と今の Conditions 節を比べ、手での削除・書換え・取消を見つける検査（下の「段階 1.5」） | なし | 別 PR。段階 3 より前に入れる |
| 2 | 植込み試験（言い回しを変えた既知の制約を実票の写しに混ぜ、抽出と独立確認が拾う数を数える）と、BOXP-360 での 1 票の移行試行 | なし | 別作業（コード変更なし） |
| 3 | 棚卸し済みの時点（`conditions_through`）より前の Notes だけを prompt から省く。対象は一覧にある移行済みの票（既定は BOXP-241 の 1 票）。それ以外は全文のまま | あり | この PR（下の「段階 3」） |

③（同じファイルへの重大指摘が続いたら設計の見直しを促す）は独立した #15327。

## 段階 1（#15338）で入れたもの

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
- **Conditions 節が無い票と、節に空でない行が無い票の版は、変更前と同じ値**（テストで固定）。配備しても既存の票の ack は無効にならない。
- 今の票だけを見て決まる検査を 2 つ入れる。どちらも、版を ack した後も、該当の行が票にある間は続く（v1 でも従来の票でも同じ）。
  - 読めない行。Conditions 節の空でない行は、決まった形の項目行（`- CD-NN【種別】本文`）、項目行の下の字下げした行（子）、読めない行のどれかで、読み飛ばす行は無い。形が違う行、本文が空の行、同じ ID が 2 行以上ある行のほか、ID が無い・数字でない行（`- CD-XX【制約】…`）、箇条書きでない文、code fence の区切り、上に項目の無い字下げ行も読めない行になる。CD-NN の ID が無い行は節の中の位置で `LINE-n` と呼ぶ。code fence の中の項目行も隠れず、項目として扱う。
  - Owner の返答が無い【承認】（由来が Owner の経路でない、または `reply_id` / `event` が無い）。
  - この間、done の結果は保留になり、hook は merge・配備の命令を拒否する。blocked の結果は保留にしない（担当が Owner に渡す手段なので。直せるのは Owner の経路）。continue も保留にしない。
- **命令が見ているのは「run の間かどうか」ではなく、呼び出した process に `CODEX_TASK_BOARD_RUN_ID` があるかどうか。** Owner の経路（Hermes）は担当の run が動いている間でも登録・取消ができ、それは版の変更として担当に届いて、ack まで done / blocked が保留になる（テストで固定）。
- 発信元は `--source` に書かれた名前、担当かどうかは環境変数で判定する。どちらも担当が変えられるので、命令の拒否は誤りを止めるもので、担当が意図して偽る場合は止められない。

### 段階 1 の PR に入れなかったもの（段階 1.5 の別 PR）

- **段階 1 では、Conditions の項目を手で消す・書き換える・手書きで【取消】にする変更は検出しない。** 前の時点の Conditions と比べる検査（run の開始時の記録と終了時の比較、次の run への基準の引継ぎ、run の途中で初めて見た項目の記録、Owner による現状の受入れ命令）はこの PR から外した。停滞レビュー BOXP-610 の判断による。理由は 2 つ。(1) 基準のファイルも発信元の名前も環境変数も担当が書けるので、今の置き場所では閉じた保証にならない。(2) 段階 1 は何も省かず、Owner の返答は Notes にも残って毎回全文で渡るので、検出が無くても変更前より悪くならない（担当は今でも Summary や Notes を書き換えられる）。
- この検査は、古い Notes を省いて Conditions だけが条件を運ぶようになる段階 3 より前に、別 PR で入れる。そこで先に決めること: 基準を担当が書けない場所に置けるか。置けないなら「誤りと手編集を見つける点検で、意図した偽りは対象外」と範囲を限って書く。外したコードは branch `boxp-588-conditions-detection` に残してある。

### prompt

- 既存の TODO の案内の後に、Conditions の読み方と登録の命令を 1 段落足す（有効な件数、読めない行があればその ID）。
- **票の本文は全文のまま。何も省かない。** Conditions 節は票の本文の一部としてそのまま入る。

### Hermes

- `docker/hermes-agent/skills/obsidian-task-board/SKILL.md` に、Owner の返答を記録するとき承認を【承認】、取次ぎで足した注意を【制約】として登録する手順を追加。helper の写しを同期。

## 段階 1.5: 命令を通さない変更の検出（`conditions_seal`）

**範囲を先に書く。これは誤りと、Conditions 節だけの手編集を見つける点検である。担当が意図して偽る場合（記録も一緒に書き換える・消す、発信元や環境変数を偽る）は対象外で、見つけない。** 記録は票と同じファイルの front matter にあり、担当は書ける。担当が書けない置き場所は今の実行環境に無い（runner も Hermes も担当と同じ利用者で動き、vault は共有）。停滞レビュー BOXP-610 が「先に決めること」とした点への答えがこれである。

### 仕組み

- `conditions add` と `conditions cancel` は、自分が書いた項目について `ID:hash`（項目行と子の行の hash の先頭 12 桁）を front matter `conditions_seal` に記録する。命令が触らなかった項目の記録は変えない。
- `conditions add` の新しい ID は、節にある ID と記録にある ID の両方より大きい番号にする。末尾の項目が手で消された後でも、その ID は再利用されず、削除の報告（`removed-outside-commands`）は残る。Owner の経路が `conditions accept` で記録を改めた後は、記録から消えた ID は再び使われうる。
- 検査は今の票だけを読む。run の記録ディレクトリには何も置かず、run から run へ引き継ぐ基準も無い（#15338 から外した方式は、基準ファイルの持ち方に穴が続いたので使わない。branch `boxp-588-conditions-detection` のコードは使っていない）。
- `conditions_seal` と Conditions 節が違うとき、項目ごとに次のどれかを報告する。
  - `CD-NN:removed-outside-commands`: 記録にある ID が節に無い（削除、ID の付け替え）。
  - `CD-NN:changed-outside-commands`: 行または子の行が記録と違う（本文の書換え、手書きの【取消】、取り消した項目を有効に戻す、由来の変更、取消理由の追加）。行内の空白の数だけの違いは変更としない（版の hash と同じ扱い）。
  - `CD-NN:added-outside-commands`（ID の無い行は `LINE-n`）: 命令が書いていない行がある。
- 報告がある間の扱いは、段階 1 の 2 つの検査と同じ: done の結果は保留、hook は merge・配備の命令を拒否、continue と blocked は通す。ack しても消えない。次の run でも票がそのままなら同じ報告が出る。prompt の Conditions の案内に該当の ID と「厳しい方の読みに従い、節は触らず blocked を返す」を出す。
- 解き方は 3 つ。(1) 項目を命令が書いたとおりに戻す。(2) Owner の経路が `conditions cancel` で取り消す（Owner の経路からは記録と違う行も取り消せる。担当の process と Owner の経路でない発信元からは拒否）。(3) Owner の経路が `conditions accept ID --reason 理由 --source 発信元` を実行する。節は変えず、今の節を新しい記録にし、受け入れた違いを Notes に 1 行残す。版は変わらない。`accept` は `--source` が Owner の経路で、`CODEX_TASK_BOARD_RUN_ID` が無い process からだけ動く。
- 記録を直した後の命令は、直前からあった違いを消さない（`add` や別の項目の `cancel` を実行しても、手で書き換えられた項目の報告は残る）。

### 見つけないもの

- `conditions_seal` も一緒に書き換えた、または消した変更。
- **`conditions_seal` がまだ無い票。** この PR より前に項目を登録した票（配備時点で BOXP-588 など）は検査されず、次に `add`・`cancel` が項目を書いた時点、または `accept` が実行された時点の節が最初の記録になる（同じ内容の `add` の再実行は何も書かないので記録も作らない）。それより前の手編集は分からない。
- 発信元（`--source`）と環境変数の偽り（段階 1 と同じ）。
- 配備の途中で古い helper が項目を登録した場合、記録のある票ではその項目が `added-outside-commands` と報告される（codex-workspace と hermes-agent の image が別々に入替わる間だけ起こりうる）。Owner の経路の `accept` で解く。

### 段階 3 とのつながり

段階 3（省略）の PR では、`conditions_seal` があり報告が 0 件の票だけ省略する（記録が無い・違いがある票は全文を渡す）。これは段階 3 の PR で実装し、テストで固定する。この PR では何も省かない。

### 検証

- `bb tests/codex-workspace/task-board-todos-test.bb` の `conditions-seal`（削除・書換え・手書きの取消・取消の解除・由来の変更・追加・ID の付け替え・節を空にする、の各報告。空白だけの違いは報告なし。v1 / legacy とも ack 後も done は保留で continue と blocked は通る。後の命令で違いが消えない。記録の無い票と記録ごと消した変更は報告なし＝範囲の限定を固定）と `conditions-seal-cli`（命令で登録・取消した票は報告なし。担当は違いのある項目を取り消せない。`accept` の拒否条件、節と版が不変、Notes の行、再実行は無変更。未記録の票の最初の記録。hook の merge 拒否）、`conditions-prompt`（該当 ID の表示）。
- `tests/codex-workspace/task-board-runner-test.sh` の `test_conditions_midrun`: run の間に項目を手で消すと次の run の prompt に報告が出て done が保留、その次の run も保留、Owner の経路の `accept` の後は done。

## 段階 3: 移行済みの票の古い Notes を prompt から省く（`conditions_through`）

Owner の承認（2026-11-18、家経由 reply_id=189776ac-574d-4b29-9fee-581eab696e21、選択 1＋A）: 有効化の条件を「Notes にしか無く、欠落すると害が出る、Owner に関わる漏れが 0」に改め、BOXP-241 だけ省略を有効にする。一括移行と BOXP-360 での有効化は含まない。

### 何が省かれるか

次の全部を満たす票の、次の範囲だけ。どれかが欠ければ票の本文は全文のまま渡る。語句は一切見ない。

1. 票の ID が runner の一覧に入っている。一覧は環境変数 `CODEX_TASK_BOARD_NOTES_OMISSION_TICKETS`（カンマか空白区切り）で、既定は `BOXP-241` の 1 票。どの票の ID でもない値（`none`）にすると全体で無効（空の値でも無効だが、container の entrypoint は空でない値だけを runner に渡すので、配備の設定では `none` を使う。entrypoint の 2 つの引継ぎ一覧にこの変数を足した）。票を足すのは、その票の移行（抽出 → 別担当の独立確認）と Owner の承認の後。
2. front matter に `conditions_through`（UTC の時刻）がある。
3. front matter に `conditions_seal` があり、Conditions の報告（読めない行、返答のない【承認】、命令を通さない変更）が 0 件。
4. Conditions の案内を受け取る担当（TODO 契約の対象。localllm は対象外）の implement / review-fix / blocked-retry の prompt。

省くのは、Notes 節の先頭から続く「`conditions_through` までに書かれたと行から分かるエントリ」の並びだけ。

- エントリは行頭が `- ` の行から次のそういう行の手前まで。先頭のエントリより前の行（節の説明文）は残す。
- 時刻は行の形から読む: `- 2026-01-02 03:04:05 UTC …`（秒までなので最大 1 秒後として扱う）、`- 2026-01-02T03:04:05.123Z …`、`- 2026-01-02: …`（日付だけなので、その日の終わりとして扱う）。
- 並びは、`conditions_through` より後かもしれないエントリ、または時刻が読めないエントリで終わる。**そこから後ろは、日付が古くても全部残す。**
- 省いた場所に「N 件・K KB を省いた、全文の path」の 1 行を置き、prompt の案内にも同じ件数と `conditions checkpoint` の命令を出す。
- 票のファイルは変えない。停滞判定など prompt 以外の読み取りは全文のまま。Notes 以外の節は 1 byte も変わらない。

### 残らないもの（範囲の限定）

**`conditions_through` 以前の Notes に書かれた制約は、Conditions に登録されていなければ prompt に入らない。** これを機械は補わない。受けるのは手順である: 移行は抽出と別担当の独立確認を経る（`migration-procedure.md`）。BOXP-241 では独立確認を 2 回行い、2 回目に見つかった漏れ 5 件（どれも軽い）を足してから線を引く。確認を重ねても境目の文の漏れが 0 になるとは言えない、という結果を Owner に示したうえでの承認である。省略の行と案内は全文の path を示し、古いエントリと Conditions が食い違うときは狭い方に従って Owner に聞くよう書く。

### 線を引く命令

`conditions checkpoint ID --through UTC時刻 --reason 何を確かめたか --source 発信元`

- `conditions_seal` が無い票、Conditions に報告がある票、未来の時刻、今の値より前の時刻は拒否（rc=4）。同じ時刻の再実行は何も書かない。
- front matter の `conditions_through` を書き、Notes に 1 行残す。版（rev）は変わらない。
- 担当も実行できる（棚卸しは、その分の Notes を全文で読んだ run が行うため）。線を戻す命令は無い。全文に戻すには、一覧から票を外すか、Owner の経路で `conditions_through` を消す。
- 未棚卸しの Notes が増えたときに棚卸しを促す仕組みは入れていない（BOXP-241 は待機中の票で Notes がほとんど増えない）。票を足すときに入れる。

### 検証

- `bb tests/codex-workspace/task-board-todos-test.bb` の `notes-omission`（線・記録が無い票と読めない線は全文／省くのは先頭の並びだけで残りは byte 一致／秒・日付だけの行の境目／後ろにある古い日付は残る／時刻の読めないエントリで並びが終わる／古い Notes の制約も語句に関係なく省かれる＝範囲の限定を固定／Conditions に報告がある間は全文／版は不変）、`conditions-checkpoint-cli`（拒否の条件、記録、再実行、後戻りしない）、`notes-omission-prompt`（一覧に無い票は全文、既定は BOXP-241、環境変数で指定・空で無効、未移行と手編集は全文で案内なし）。
- `tests/codex-workspace/task-board-runner-test.sh` の `test_notes_omission_prompt`: 実際に runner を回し、一覧にある移行済みの票は prompt から古い 2 件が消えて Conditions と線より後の Notes が入ること、一覧に無い同じ票と、Conditions を手で書き換えた票は全文が入ること。

### 切戻し

配備の設定で `CODEX_TASK_BOARD_NOTES_OMISSION_TICKETS=none` にする、または revert。票の `conditions_through` は残っても、旧 runner は読まない。

## 変えないもの

- 既存の票の内容（一括の書換えなし）、Notes の扱い、停滞判定の入力。
- gate の基準、P0/P1 の扱い、retry の上限、gate 失敗予算、継続の上限。
- TODO（TD）の動き。

## 検証

- `bb tests/codex-workspace/task-board-todos-test.bb`: 解析（節の外・読めない行・重複、節の中に読み飛ばす行が無いこと: ID の不正な行・箇条書きでない文・fence・字下げ行）、版（項目なしは不変、項目の各部分で変わる）、保留（v1 / legacy、未受領）、今の票だけで決まる検査 2 つ（`conditions-problems`: done は保留、continue と blocked は通る。削除や書換えは検出しないことも固定）、命令（発信元、`CODEX_TASK_BOARD_RUN_ID` の有無、再実行、取消の形）、hook（`conditions-hook`: ack 後も merge 拒否）、run の間の Owner 経路の取消（`conditions-owner-path-during-a-run`: 担当の process は拒否、Owner の経路は成功、担当には版の変更として届き ack まで保留）、prompt の案内。
- `tests/codex-workspace/task-board-runner-test.sh` の `test_conditions_midrun`: 実際に runner を回し、run 中に手で書かれた返答なしの【承認】で done が保留になること、次の run でも残っていれば保留が続くこと、run の間に Owner の経路が取り消すと未受領の版として保留になり、その次の run で done になること、prompt に Conditions 節と案内が全文で入ること。
- 既存の runner テスト全 shard。

## 配備と確認

- merge → codex-workspace と hermes-agent の image 配備 → runner の復帰を確認。
- 実反映の確認: 配備後の prompt に案内が入ること、既存の票の rev が配備前と同じこと、この票（BOXP-588）で実際に項目を登録・一覧できること。

## 切戻し

revert。登録済みの `## Conditions` 節は票に残るが、旧 helper では版に含まれないだけで害はない。

## 残ること

- 段階 2 の植込み試験と BOXP-360 の移行試行（抽出 → 別担当の独立確認 → 【要確認】だけ Owner に提示）。止める条件: 独立確認の後も漏れが残る、または Owner 由来の条件の漏れが 1 件でも見つかる。
- 未棚卸しの Notes が増えたときに棚卸しを促す案内（票を足すときに入れる）。
- dotfiles 側の task-board skill の説明文の同期（helper の写しは dotfiles には無い）。
