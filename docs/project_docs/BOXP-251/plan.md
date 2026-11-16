# BOXP-251: Novel Board の Draft 段階の Review Instructions を無視せず反映する

## 調査結果（原因は prompt 組み立て側、出力の無視ではない）

- `candidate-action` は `Draft` + agent 割当を無条件に `:write` にし、`## Review Instructions` を見ていなかった。
- localllm route の `writer-user-prompt` は `:revise` のときだけ Review Instructions を含めていた。Draft からの初稿（`:write`）と Backlog の要件整理（`groom-user-prompt`）では Requirements / Outline と参照資料だけが prompt になり、人間の指示は一切渡っていなかった（NOVEL-6 の write run / localllm groom run の `prompt.md` に `Review Instructions` 見出しが無いことを文字列検索で確認。内容は読んでいない）。
- cloud route（claude / codex）は管理ノート全文を渡していたが、Goal 文が Requirements / Outline だけを指すため指示は努力目標だった。

## 操作仕様（Draft + agent 割当）

| Review Instructions | action | 結果 |
| --- | --- | --- |
| 空 / `TBD` などの未記入 | `:write` | 従来どおり初稿を書いて Review へ（互換維持） |
| 指示あり、まだ反映していない | `:regroom` | 本文を書かず Requirements / Outline へ反映し、`Draft`（担当 boxp）へ戻す。反映内容 / 未反映 / 次の操作を Change History と Run History に記録。指示欄は消さない |
| 指示あり、反映済み（同じ文面） | `:write` | 初稿を書き始め、指示を「執筆時に守る人間の指示」として prompt に渡す |

- 「反映済み」の判定は、成功した run が開始時に読んだ指示文の fingerprint（空白・空行を除いた SHA-256）を `~/.novel-board/instructions/NOVEL-N.edn` に記録し、同じ文面かどうかで決める。指示を書き換えると再び反映から始まる。失敗した run は記録しないので、未反映の指示は次の割当で再び反映対象になる。
- 曖昧な場合（指示が「初稿を書いて」のような文面でも）は安全側に倒し、まず Requirements / Outline へ反映して Draft で止める。初稿を始めるには同じ指示のまま agent をもう一度割り当てる（1 手多いが、本文生成や承認が勝手に始まらない）。
- Backlog の groom にも指示があれば補足として渡し、成功時に反映済みとして記録する（Draft で同じ指示のまま割当すれば初稿開始）。Review の revise は従来どおり「指示が空でなければ改稿」で変更なし。
- 起動契機は従来どおり担当（assignee）の指定のみ。指示を書いただけでは起動しない。Done は再実行しない。

## 変更

- `docker/codex-workspace/novel-board/novel_board_runner.bb`
  - `candidate-action`: Draft の分岐を上表のとおりに。
  - `writer-user-prompt`: `:write` でも指示を含める。`groom-user-prompt`: `:groom` に補足指示、`:regroom` に反映指示（`## Requirements` / `## Outline` / `## Applied` / `## Unapplied` を出力させる）。`cloud-prompt`: `:regroom` の Goal と、`:groom` / `:write` での指示への言及。指示欄の編集禁止を明記。
  - `run-groom!`: `:regroom` 対応。cloud route は Requirements / Outline の fingerprint が変わらない場合と、run 中に Review Instructions が変更された場合を失敗にする。
  - `finish-run!`: `:regroom` は成功 / 失敗とも Draft（origin）へ、Change History に反映 / 未反映 / 次操作を追記。
  - `process-card!`: 成功した run の指示 fingerprint を記録。Run History の started 行に指示の扱いを明記。
  - `append-section-entry!` で Change History への追記を共通化。`phase-timeout-ms` は regroom も groom 上限を使う。
- `tests/codex-workspace/novel-board-runner-test.sh`: localllm の regroom → 同じ指示で write（prompt に指示あり）→ 指示変更で再 regroom（原稿不変）、cloud の regroom と未変更失敗 → 再割当で再 regroom、Backlog groom への指示受渡しと Draft での非再適用。
- `vault-seed/Novels/README.md`, `vault-seed/Boards/Novel Board.md`: Draft レーンと Review Instructions の説明を最小限更新（live vault も同内容へ）。

## 検証

- `bb novel_board_runner.bb test`（自己テスト）と black-box テスト 47 件 PASS。
- codex review 指摘: localllm の regroom で計画が元と同じなら失敗にし、指示を反映済みとして記録しない（cloud route と同じ扱い）。対応済み。
- 配備後: 新 Pod の runner が arch main の sha と一致することを確認し、隔離 vault / root で配備済み runner を tick して Draft 指示 → regroom → Draft 戻し → 同じ指示で write 開始を確認。NOVEL-6 の再割当・再生成・レーン移動は行わない。
