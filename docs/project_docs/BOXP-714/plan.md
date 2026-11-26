# BOXP-714: Pi Web Agent からローカル LLM と既存 Pi ツールを試す

## 目的

本人が希望した tg-prplx/pi-web-agent（Pi のブラウザ UI）を、既存 Pi とローカル LLM につないだ本人限定の試用環境として用意し、
実ブラウザでローカルモデルによる Obsidian 検索・Web 検索・試験用ノート追記を一往復確かめる。

## 制約（チケットより）

- 既存 Pi・コハコ・推論環境の通常利用を妨げない。
- 無認証公開・新課金・クラウドモデルへの自動切替・私的ノート本文の外部送信をしない。

## 方式

| 候補 | 判断 |
| --- | --- |
| codex-workspace 内で 127.0.0.1 待ち受け＋SSH ポート転送 | **第 1 段で採用**。vault と local-llm に既に届き、k8s/Cloudflare の変更なしで本人限定（SSH 鍵）にできる |
| Cloudflare Access（本人 email＋GitHub）付きの URL | 第 2 段の候補。スマホから開きやすいが、codex-workspace の Service/NetworkPolicy（lolice）と Access/tunnel（arch）の変更が要る |
| 別 Pod に分離 | vault（codex-workspace の PVC）を共有できないため今回は不採用 |

- Pi の設定は試用専用の `PI_CODING_AGENT_DIR`（local-llm の gemma4-26b だけ）。起動は `env -i` で、クラウドの API キー環境変数を渡さない。
- 既に読み込まれている gemma4-26b だけを出す（router の別モデルへ切り替えて他の利用者を待たせない）。
- ガード拡張（`scripts/pi-web-trial/extension/`）: bash を外す、ファイル系の道具を vault 内（隠しフォルダ除く）に限定、書き込みは `Projects/pi-web-agent-trial/sandbox/` の `.md` に限定、`web_search`（DuckDuckGo HTML、検索語だけ送信）を追加し、このチャットで読んだ本文と 16 文字以上同じ並びを含む検索語は止める。
- 現行仕様: Obsidian `Projects/pi-web-agent-trial/spec.md`（spec-index: `pi-web-trial-guard`）。

## Lean 形式モデル

状態は「読んだ本文の集合」が増えるだけで、判定は入力 1 件ごとの関数に閉じる。順序の規則（読んだ後の検索だけ止まる）は直接テストで確かめられるため、Lean モデルは作らない（標準の適用外: 入出力関数を直接テストで覆える）。

## 検証

- 自動試験: `node --test scripts/pi-web-trial/test/`（期待値は仕様の例から作成。実装前に失敗を確認）。
- 実ブラウザ（Playwright コンテナから 127.0.0.1:4317、PC 1440×900 / スマホ 390×844）: ローカルモデルで grep による vault 検索、web_search、sandbox への追記、bash の不使用、vault 外の read の拒否。
- 本人端末からの SSH 転送での利用は本人受入として残る。

## 次の段（同チケット内）

- スマホから開きやすい Cloudflare Access 付き URL（lean-reading と同じ「本人 email＋GitHub」方式、tunnel 側 JWT 検証）を検討。
