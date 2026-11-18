# BOXP-613: ミューテーションテストで検出力を点検し役目を失ったテストを整理する

参考: https://zenn.dev/mizchi/articles/mutation-test-quality / `@mizchi/mutator` 0.3.0 同梱 skill `mutation-test-loop`
前段: [BOXP-600](../BOXP-600/plan.md)（kohako-studio の 4 対象へ report-only で導入）

## 範囲と方針

- 対象は BOXP-600 の既存 4 対象（web `markdown.ts`/`sync.ts`, bff `notifications.ts`/`status.ts`）と、
  そこで「意味ある見逃し」「未到達」と残した箇所の周辺に限る。全 repo 一括削除・一律スコア gate・本番変異実行はしない。
- 本番コードは変更しない（テストと `mutator.accepted.json` だけ）。
- 手順: `--kill-matrix`（全変異 × 覆う全テストを早期終了なしで実行）で
  「何も殺さないテスト」「他のテストに完全に包含されるテスト」を列挙 → 生存変異を
  未実行 / 入力不足 / assert 不足 / 等価 / 未到達 / 実行失敗 に分類 → 意味ある見逃しはテストで潰す →
  等価だけ理由付きで accept → 削除・統合の候補は「そのテストだけが表す仕様があるか」を読んで判断する。
- 変異を殺せないこと・包含されていることだけでは削除しない。削除/統合の前後で全体スコアと
  そのテストが担っていた変異が他のテストに殺されていることを実測で確認する。

## 結果: web（markdown + sync）

| 段階 | Killed | Survived | NoCoverage | スコア |
|---|---|---|---|---|
| BOXP-600 終了時 | 427 | 102 | 181 | 61.2% |
| 本件 テスト補強後 | 630 | 19 | 11 | 95.6% |
| 等価 19 件を accept 後 | 630 | 0（Ignored 19） | 11 | 98.4% |

（Timeout 26–27 件は無限ループ化した変異で、検出扱い。CompileError 約 330 件は型不一致で実行前に除外。）

### 改善したテスト（意味ある見逃し）

- `markdown.test.ts` 新設: BOXP-600 で「未到達（DOM 環境が無い）」とした `renderMarkdown` を、出力木を記録するだけの
  最小の偽 document で観測。jsdom 等の依存は追加していない。`parseMarkdown` のブロック解釈（段落の終端条件、
  字下げされた記号・2 桁番号、行中の ``` / > / - を記法にしないこと、見出し段数、入れ子リスト）、
  外部リンクの `target/rel/referrerPolicy`、vault 画像の遅延読込と失敗案内（`once`）、`plainText`、
  `obsidianNoteUrl` の大文字エスケープ、`=` を持たない引数（`vault=BOXP&fileX`）の拒否。
  - 最後のものは `eq < 1 -> false` の生存変異から見つかった入力不足で、変異下では `fileX` という名前の
    ノートを開くリンクになる（本番コードは正しく拒否しており、実バグではない）。
- `sync.test.ts`: 検証済み履歴の値の写し（`toStrictEqual` で「無いフィールドを足さない」まで確認）、
  許す 4 状態、items 50/51 件と views 50 件の境界、`Seen` の 400 件上限と古い順の忘却、
  `latest` が最後の返答にだけ付くこと、終わった依頼の返答を出さないこと、stale の再通知。

### 削除・統合（役目を失ったテスト）

kill-matrix の判定（web 438 テスト中）:

- 何も殺さないテスト: 対象 2 ファイルに到達しない他ファイルのテスト（arrival/idle 等）が列挙されるだけで、
  対象を覆いながら何も殺さないテストは 0 件。
- 包含されるテスト 3 件を個別に読んだ判断:
  - **統合**: sync「この端末が既に出した発言・返答は足さない」。`planSync` 自身が同じ `markUser/markReply` を
    使って重複を防ぐため、変異の検出は「同じ履歴を 2 回流しても…」に完全包含（21 kills）。送信側の印付けも
    同じ経路である旨を残して後者に統合した。統合後の kill-matrix 再実行でも Killed 630 のまま減らず、包含判定は
    下の保留 2 件だけになった。
  - **保留（残す）**: obsidian-link「unencoded "+" and sub-delimiters…」。変異上は「slashes…」に包含されるが、
    `+` を空白に復号しない・閉じ括弧を URL に含めない、という BOXP-581 の個別の回帰仕様を表しており、
    この文字クラスの変更は変異演算子が生成しないため kill 包含は仕様の重複を意味しない。
  - **保留（残す）**: sync「他端末の進行中の依頼は、この端末が空いている時だけ追う」。`canFollow=false` と
    通知返信（`kind: 'reply'`）の追跡という他のテストに無い仕様を表す唯一のテスト。

### 等価として accept した変異（`web/mutator.accepted.json`、19 件）

catch 内の `return undefined` 削除、`$` の有無（`(.+)` が行末まで一致）、ループ末尾を越える `i++`、
`lines[lines.length]`（undefined）の正規表現判定、`Number.isFinite` 前の `typeof` 検査など。
各理由はファイル内に記録。等価と確信できないものは accept していない。

### 残した未到達（NoCoverage 11 件）

`parseMarkdown` が必ず埋める `block.items ?? []` 等の防御的な既定値と、URL 正規表現が通した文字列を
`safeUrl`/`obsidianNotePath` が拒否する分岐。到達させるには型を偽った入力が要り、仕様の検査にならないため
テストを足していない。

## 結果: bff（notifications + status）

| 段階 | Killed | Survived | NoCoverage | スコア |
|---|---|---|---|---|
| BOXP-600 終了時 / 本件開始時の kill-matrix | 435 | 174 | 11 | 70.2% |
| notifications 補強後 | 452 | 159 | 9 | 72.9% |
| status 補強後 | 587 | 27 | 1 | 95.5% |
| 等価・観測不能 27 件を accept 後 | 588 | 1（Ignored 27） | 1 | 99.7% |

### 改善したテスト（意味ある見逃し）

- `notifications.test.ts`（BOXP-613 の describe）: 既読・案内済み・返信・run id 記録が**指定した通知にだけ**効くこと
  （`i.eventId === id -> true` で先頭の通知に効いてしまう変異が 4 箇所で生存していた）、未読数、
  知らない ID の `mark`、返信の種類/空白だけ/選択肢外の拒否、送信例外時の `submit_failed`、
  送信済み返信は再開に失敗しても `submitted` のまま、再送可否の 23 時間ちょうどの境界、
  保持上限で「処理済み→既読→最古」の順に消すこと、複数桁のチケット番号。
- `status.test.ts`: プール定義（担当エージェントの対応・窓・提供状態）、観測値の ISO 化と ±8.64e9 秒の境界、
  `sourceUp`/`fileAgeSeconds`、メトリクス行の字下げ・連続空白・時刻付き・壊れた行・許可外ラベル、
  窓の状態（期限ちょうど・24 時間ちょうど・90% ちょうど・allowed_warning・値の無い観測）、
  他の窓（同じ provider を含む）の状態系列を混ぜないこと、ボードの必須フィールド/項目の型、
  ID・担当の正規化と並び、取得できない時の unavailable の形、URL 無しで取得しない・`redirect: 'error'`・
  1 MiB ちょうど/超過、キャッシュの 60 秒/15 秒ちょうどと取得先ごとの期限。
- 実バグは見つからなかった。`iso()` の上限は Date の表現範囲（8.64e12 秒）ではなく 8.64e9 秒（2243 年）だが、
  遠未来の値を null にするだけで害は無いため現状の挙動をテストに固定した。

### 削除・統合（役目を失ったテスト）

kill-matrix の判定（bff 201 テスト中）: 対象を覆いながら何も殺さないテスト 0 件、包含 2 件。

- **保留（残す）**: notifications「通知を受信順に返す」。kill は「hides legacy items…」に包含（48 kills）されるが、
  受信順という仕様は `push` を `unshift` に変えるような変異を演算子が生成しないため変異では測れない。
  順序を表す唯一のテストで、包含は仕様の重複を意味しない。
- **保留（残す）**: app.test「serves status only to authenticated principals and only by GET」。
  kill 比較の対象は include の status.ts だけ（2 kills）で、このテストの目的（app.ts の認証・メソッド制限）は
  変異対象外。範囲外のため判断材料にしない。

### accept（`bff/mutator.accepted.json`、29 件）と保留

- 等価: `Number.isFinite`/後段検査で同じく拒否される型検査の削除、`^` の有無、系列が無い時の分岐、
  同じ run id の再代入、JSON 保存で落ちる `sessionId: undefined`。
- 観測不能: 例外の文言（`createStatus` の `catch(fallback)` で捨てられ応答にもログにも出ない）、読み終えた reader の
  `releaseLock`。
- 保留（accept しない）: `notifications.ts:72` createdAt の先頭アンカー除去。現行 Node の `Date.parse` は試した前置文字を
  全て拒否したが、全入力で等価とは言えないため BOXP-600 と同じく残す。`notifications.ts:95` `flush` は
  呼び出し側のテストが無い未到達。

## 実行時間と CI への影響

| 項目 | web | bff |
|---|---|---|
| `npm test`（ローカル 2 CPU） | 446 tests 約 5.4 秒（BOXP-600: 393 tests 約 5 秒） | 216 tests 約 11.4 秒（BOXP-600: 184 tests 約 12 秒） |
| kill-matrix 全件（ローカル 2 CPU） | 約 2 分 20 秒 | 約 14 分 17 秒（開始時 15 分 6 秒） |
| テスト変更後の通常実行（ローカル） | 約 54 秒〜2 分 | 約 50 秒〜6 分 |
| PR の mutation job（GitHub-hosted, head 5c89fcf） | 36 秒 | 63 秒 |
| 参考: 同 PR の verify | 1 分 5 秒 | （共通） |

- mutation job は従来どおり verify と並列の report-only で、PR の待ち時間（最長 job）はほぼ変わらない。
  一律スコア gate・`--fail-on-survived` は入れていない（accept 済み以外の生存は bff の 1 件だけだが、
  対象範囲は 4 ファイルに限られ、gate 化の判断は対象を広げてからにする）。
- kill-matrix は早期終了しないため通常実行より重く、CI ではなく点検時に手元で使う（`npx mutator --kill-matrix`）。

## 再実行方法

```sh
cd apps/kohako-studio/web   # または bff
npx mutator --kill-matrix               # 何も殺さない/包含されるテストの列挙（点検時のみ）
npx mutator --reporter agent > /tmp/agent.json   # 生存・未到達の key 付き一覧
npx mutator accept <key> --reason '<等価・観測不能の理由>'   # 等価と確信できるものだけ
```
