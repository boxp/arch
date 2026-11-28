# BOXP-756: コハコの家で読み上げON時に新着の通知と返答の本文を読む

仕様（正本）: vault `Projects/kohako-home/notice-read-aloud-spec.md`（spec_feature: kohako-home-notice-read-aloud）

## 調査結果
- 会話の返答・通知返信の返答は `deliver` → `playReply` で既に読む（他端末から追った返答は `quiet` で読まない）。
- 家の画面に出る新着通知（`initInbox` の `announce`）は吹き出しと履歴に出すだけで読んでいなかった。
- 案内の重複は BFF の `announcing`/`announced` 仮押さえで防がれており、再読込・再配信・他タブ／他端末で再提示されない。
- `canAnnounce` は読み上げ中（`speaking`）を除外するため、通知も同じ再生器で読めば新着同士・返答と重ならない。

## 変更
1. `web/src/home/noticeSpeech.ts`: 案内文の組み立て（表示と共通）、読むかの判定 `canSpeak`、URL を「GitHub のリンク」「YouTube のリンク」「リンク」/ラベルへ言い換える `spokenText`。
2. `main.ts`: 新着通知の案内時に読み上げ ON なら `playReply` で案内文全体を読む（「続きから読む」が出ている間は表示だけ）。返答の読み上げ文も `spokenText` に切り替え。
3. Service Worker・Web Push・BFF は変更しない。

## 検証
- 単体: `noticeSpeech.test.ts`（仕様の表の例から作成。実装前に失敗を確認）。
- 実ブラウザ: `verify/home/notice756.mjs`（BFF 完全モック）で ON/OFF・会話・通知・通知返信・重なり・再読込・停止を確認。
- 配備後: 配備版で同じ経路を確認する。

Lean は使わない: 新しい状態規則を足さず、既存の案内の仮押さえと再生器（世代番号）を流用し、新しく決めるのは読む文の組み立て（入出力関数）だけのため。
