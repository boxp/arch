# BOXP-548: コハコの家 ツール実行と処理状況のリアルタイム表示

## 目的

家の会話で、コハコ（Hermes）が実行中のツールの開始・進行・完了・失敗と、公開してよい途中のひとことを、実データだけでリアルタイムに見せる。内部思考・資格情報・秘匿引数は出さない。架空の進捗は作らない。

## 実データの出どころ（調査結果）

稼働中 Hermes（v0.22.5 系）の `GET /v1/runs/{run_id}/events`（SSE、`id:` = seq、`Last-Event-ID` で再開、backlog 1000 件）が以下を流す。BFF は現在 `GET /v1/runs/{id}` のポーリングしか使っていない。

| event | 内容 | 家での扱い |
|---|---|---|
| `tool.started` | `tool`, `preview`（主引数の短い表示。Hermes 側で表示用に引数を伏字化済み）, `tool_call_id` | 手順を「実行中」で追加 |
| `tool.completed` | `tool`, `duration`(秒), `error`(bool), `tool_call_id`, `preview`（結果の先頭 500 字・Hermes が強制伏字化） | 手順を「完了/失敗」に更新 |
| `message.delta` | 返答本文の断片 | ツール前に出た文は「途中のひとこと」、最後のツール後は「返答を書いています」の状態だけ（本文は従来どおり完了時に表示） |
| `message.interim` | ツール呼び出しと並ぶ公開コメント | 「途中のひとこと」 |
| `reasoning.available` | 内部思考 | **受け取っても保存も転送もしない** |
| `subagent.*`, `run.*`, 承認系 | | 表示しない（終了・承認は既存のポーリングが正） |

## 構成

- 経路: Hermes SSE → BFF（伏字・切り詰め・件数上限・思考の破棄）→ 既存の `GET /kohako/api/v1/requests/{id}` 応答に `activity` スナップショットを追加 → Web が既存ポーリング（実行中は 1 秒間隔）で描画。
  - スナップショット方式なので、再読み込み・通信断・BFF 再起動（Hermes の backlog を seq -1 から再生）後もそのまま復元できる。新しい公開エンドポイントや nginx 設定は増やさない。
  - 結果・承認・停止の判定は既存ポーリングのまま。SSE が使えない/切れた場合は表示が増えないだけで会話は従来どおり動く（進捗を捏造しない）。
- BFF `activity.ts`（新規）: イベント → 手順リストの畳み込み（純関数）、伏字（既存 `redact` + URL の認証情報/クエリ、Authorization、`--password` 等）、上限（手順 40 件、表示文 160 字、結果 200 字、ひとこと 400 字）。
- BFF `hermes.ts`: `events(runId, onEvent, signal)` SSE クライアント（再接続・Last-Event-ID・フレーム上限・404 で終了）。
- BFF `conversation.ts`: run id 判明時に購読開始、終了時に中断。手順は会話ファイルに保存しない（メモリのみ）。なでる（touch）は対象外。
- Web `activity.ts`（新規）+ `activity.css`: 応答 JSON の厳格な検証、ツール名 → 日本語ラベル、描画（textContent のみ）。
- UI: 吹き出し `#bubble` の先頭に `#activity` を置く。
  - 実行中: 1 行の現在状況（スピナー + 「Web を検索しています」+ 対象 + 経過秒）。押すと手順一覧（✓/✕/実行中、所要時間、対象、結果の抜粋）を開閉。
  - 完了後: 「ツールを 3 回使いました（うち失敗 1）」の 1 行に畳み、開けば手順を見返せる。次の依頼の開始で消える。
  - 吹き出しの中に置くので、入力欄・承認ダイアログ・停止ボタンを覆わず、BOXP-544 の縦画面レイアウト（吹き出しが会話欄へ移動）にもそのまま追従する。動きを減らす設定ではスピナーを止める。

## 並行チケットとの調整

- BOXP-544（PR #15010、縦画面の会話優先）: `home.html` は 1 行追加、`main.ts` は数か所、CSS は別ファイル `activity.css` にして衝突を最小化。先に入った方へ rebase する。
- BOXP-547（#15008、受信箱）: merge 済み。`inbox.ts` は触らない。

## 検証

- vitest: 畳み込み・伏字・思考の破棄・SSE パーサ・再接続・応答への付与、Web 側の検証とラベル。
- `verify/home/activity548.mjs`（BFF モック、PC / Pixel 7 縦）: 開始→進行→完了/失敗の表示、思考・秘密が DOM に出ない、入力・停止・承認と重ならない、外部通信 0。
- 配備後: 本番会話経路（verifier の会話と Owner 経路の実 run）でツール手順が実データで出ることを確認。検証画像は `/home/boxp/verification-artifacts/BOXP-548/` に置き vault には保存しない。

## 追記 (2026-11-14): ツール引数・出力の公開方針

伏字規則(拒否リスト)では `mysql -pabc123` や `echo 値 | …` のような任意位置の秘密値を見分け切れないため、ツール由来の文字列は許可リスト方式にする。

- terminal: 先頭のプログラム名のみ(例 `mysql …`)。引数は載せない。
- read_file / write_file / patch / skill_view: 空白・引用符を含まない 1 語(パス)のときだけ。
- web_extract / browser_navigate: 接続先のホスト名だけ(例 example.com)。パス・問い合わせ部・利用者情報は、再設定トークン等の秘密値が入り得て見分けられないため載せない。
- 途中発言や検索語に含まれる URL も同じ理由でホスト名までに縮める(例 https://example.com/…)。
- web_search / search_files / session_search: 伏字化した検索語。
- 上記以外の道具の引数、および全ての道具の出力(tool.completed の preview)は載せない。状態・所要時間のみ。
- コハコ自身の途中発言(message.interim / delta)は従来どおり伏字化して表示。
