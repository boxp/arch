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
    同じ経路である旨を残して後者に統合した。統合後も全体の Killed は減っていない（上表）。
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

（実測後に追記）

## 実行時間と CI への影響

- web `npm test`: 41 files / 446 tests で約 5.4 秒（BOXP-600 時点 393 tests 約 5 秒）。
- web mutator: 全件 kill-matrix 約 2 分 8 秒（ローカル 2 CPU）、テスト変更後の通常実行 約 54 秒〜2 分、
  変更なし再実行 約 8 秒。CI の mutation job は verify と並列の report-only のまま（gate 化しない）。
