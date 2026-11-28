# BOXP-778: コハコの家の通知本文にある Obsidian ノートリンクを開けるようにする

## 原因
- 通知生成（Task Board 正式報告）は Obsidian の wiki リンク `[[パス|別名]]` を出している（例: BOXP-768 done 通知）。
- 家の通常版の本文描画 `apps/kohako-studio/web/src/home/markdown.ts` の `parseInline` が wiki リンクを解釈せず、生文字のまま表示していた。受信箱・吹き出し・読み上げは同じ関数を使う。

## 方針
- 現行仕様 `Projects/kohako-home/note-link-spec.md`（vault）を新設し、例・例外を先に決めた。
- `parseInline` に `[[...]]` を追加。別名を表示名、拡張子が無ければ `.md` を補う、`#見出し` を外す、`BOXP-N` は `Tickets/`、vault 絶対パスは相対へ。
- 既存の `obsidianNotePath` 検査（BOXP vault・open 操作のみ、`..`・`.` 始まり・絶対パス・制御文字・1500 文字超を拒否）を必ず通す。スキームらしい書き出しは拒否。不正なものは文字のまま。
- 描画は既存のノートリンク（同じタブ・押したときだけ・「Obsidianで開く」印）を使い、自動起動しない。
- 票リンク・返信・Push・Telegram は変えない。

## 検証
- 配信済み通知本文をそのまま使うテスト（`wikilink.test.ts`）を先に書き、失敗を確認してから実装。
- 配備後、家の受信箱で対象通知を PC 幅・スマホ幅で表示し、リンク先 href と票リンク・返信欄を確認。実端末での Obsidian 起動は本人確認として分けて報告。
- Lean: 状態・順序の決まりが無い入出力関数のため対象外。
