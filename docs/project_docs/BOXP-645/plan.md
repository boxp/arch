# BOXP-645 計画

正本 BOXP-644 の全提案を実装と照合し、安全上の意味、送信状態、読み上げと共通 Studio を保ったまま家向け文言を修正する。復元は草稿の実際の移動先と件数を区別し、認証切れ・未受理確認の再送防止を維持する。Web/BFF の既存テスト、型・format・build を実行し、可能なら verify/home で画面を確認する。Owner承認のA案を実装する。認証ボタンは「再認証のため再読み込み」、応答待ち送信は「送信待ちに追加」を採用。

## 提案ごとの採否と反映箇所

監修案を基準に採用。次の調整は実仕様と安全上の意味を保持するためのもの。以下のパスは apps/kohako-studio/ からの相対パス。

| ID | 現状・実装箇所・調整 |
|---|---|
| 1-1 | 採用: web/home.html。発言代理・承認・長期記憶更新ではない境界を保持。 |
| 1-2 | 採用: web/home.html。phrases は TouchLimiter とテストで参照されるため削除しない（家は lines:false で呼ぶ）。 |
| 1-3 | 採用: web/home.html。 |
| 1-4 | 採用: web/src/home/main.ts。Owner 指定の認証ボタン名を維持。 |
| 1-5 | 採用: web/src/home/main.ts、web/src/home/reauth.ts。草稿の実際の復元先・件数で分岐。既存入力と同一で復元なしのときは案内しない。merged と送信待ち併存の場合は両方を明示。 |
| 1-6 | 採用: web/src/home/queue.ts、web/src/home/main.ts。pending は受理状況の確認を明示。 |
| 1-7 | 調整採用: bff/src/visit.ts。全文を柔らかい報告に変更。一人称「わたし」、未確認は断定しない。監修案の「読み取り以外」は実際のGrafana限定境界と異なるので「Grafana の読み取り口ではない」を維持。 |
| 2-1 | 採用: web/src/home/main.ts。 |
| 2-2 | 採用: web/src/home/main.ts。 |
| 2-3 | 採用: web/src/home/main.ts。 |
| 2-4 | 採用: web/src/home/main.ts。 |
| 2-5 | 調整採用: web/src/home/main.ts。改行・省略案内を反映。通知タイトルは信頼しない本文であり、新たなMarkdown構文との干渉を作らずプレーン表示を維持。 |
| 2-6 | 採用: web/src/home/main.ts。 |
| 2-7 | 採用: web/src/home/main.ts。 |
| 3-1 | 採用: web/home.html、web/src/home/main.ts。接続表示短縮・title補足・認証切れ・再接続中。 |
| 3-2 | 採用: web/src/home/main.ts の家専用マッピング。共通 web/src/studio/model.ts は変更なし。 |
| 3-3 | 採用: web/home.html（確認中：自宅クラスタ）。 |
| 3-4 | 採用: bff/src/visit.ts。 |
| 3-5 | 採用: bff/src/app.ts、bff/src/conversation.ts。 |
| 4-1 | 採用: web/src/home/main.ts。Owner 指定「送信待ちに追加」。 |
| 4-2 | 採用: web/home.html。 |
| 4-3 | 採用: web/home.html。 |
| 4-4 | 採用: web/home.html。 |
| 4-5 | 採用: web/home.html、web/src/home/main.ts。 |
| 4-6 | 採用: web/home.html、web/src/home/{main,queue}.ts。届いたか未確認・一時停止・再開ボタン名の整合・上から順の案内。 |
| 4-7 | 採用: web/src/home/main.ts。添付チップを B/KB/MB 表示。 |
| 4-8 | 調整採用: web/src/home/{attachments,main}.ts。上限の実値は5/5.5 MiBのため単純にMBと言い換えず、上限の注記はMiBを維持（チップは十進B/KB/MB）。判定・許容サイズは変更しない。 |
| 4-9 | 調整採用: web/home.html、web/src/home/{main,dictation}.ts。録音中・完了・500文字・30秒表示。読み上げ停止は自動再開しない事実を短く残す。 |
| 5-1 | 採用: web/src/home/main.ts、bff/src/conversation.ts。拒否のみの境界を維持。 |
| 5-2 | 採用: web/src/home/main.ts。通常送信と再読み込み後の両方で「確認して再開」へ案内。同じ受付番号の再確認を保持。 |
| 5-3 | 採用: web/src/home/main.ts。 |
| 5-4 | 採用: web/src/home/main.ts。 |
| 5-5 | Owner 指定により現行「再認証のため再読み込み」を維持。 |
| 5-6 | 調整採用: web/src/home/markdown.ts。代替名は添付画像へ。エラー原因が認証/移動だけとは限らないため対応形式の確認を省かず維持。 |
| 5-7 | 採用: web/public/kohako/offline-v1.html。 |
| 6-1 | 採用: web/src/home/{main,status}.ts。最新情報取得失敗・前回値の表示・進行中タスク取得不能を区別。 |
| 6-2 | 採用: bff/src/status.ts。 |
| 6-3 | 採用: web/src/home/{main,status}.ts。リセット時刻経過・件数に不整合あり・最新の状態にする。 |
| 6-4 | 調整採用: web/src/home/main.ts。括弧・地図案内を整理。OSMへの目的地付近の送信、Googleへの送信境界を保持。図の数値が「確認されたデータではありません」という従来の注意は、監修案より厳密なので維持。 |
| 7-1 | 採用: web/src/home/activity.ts。完了名を名詞句に統一、進行形は維持。 |
| 7-2 | 調整採用: web/src/home/activity.ts。日本語表示名・失敗/中断内訳を括弧内へ統合。提案にない「結果未確認」の内訳も保持。 |
| 7-3 | 採用: web/home.html、web/src/home/inbox.ts。 |
| 7-4 | 採用: web/src/home/inbox.ts。返信結果を先頭、受付番号を末尾、メタ情報を区切る。再送は同じ受付番号のまま。 |
| 7-5 | 採用: bff/src/push.ts。伏字と本文の扱いは維持。 |
| 8-1 | 採用: web/home.html。端末限定のお知らせが再読み込みで消える情報と停止の分離も維持。 |
| 8-2 | 採用: web/src/home/main.ts。停止・結果未確認・会話区切り・別端末追従の案内。 |
| 8-3 | 採用: web/home.html。設定補足・文体・句点を統一。 |
| 8-4 | 採用: web/src/home/main.ts。非公式 Live2D 注記を維持。 |

## 実仕様・読み上げ・保全

- 認証・送信・承認の制御と権限、許可/拒否、冪等キー、未受理確認、データ保持、上限は変更しない。
- 家専用の状態マッピングを main.ts に置き、共通 web/src/studio/model.ts と Studio の表示は変更しない。
- 著作権/ACML/非公式Live2D/OpenStreetMap表記を維持。
- deliver の返答本文は plainText を通って端末音声/コハク音声の読み上げ対象になる。現場の途中帰還報告も返答なので対象。通知・停止・確認の setBubble はDOMの aria-live 対象だが、この経路から音声合成を新たに開始しない。録音終了/取消/見てきて/添付取消は aria-label を確認。音声の実聴、実機スクリーンリーダーは未確認。
- スマホ縦では長い送信ラベルで入力欄が縮んだため、入力欄を独立行にした。表示以外の機能は追加しない。

## 検証

- Web: typecheck/check/test（42 files・468 tests）成功。Vite API build({publicDir:false}) 成功。BFF: typecheck/check/test（15 files・220 tests）/build 成功。
- verify/home/check-docs.sh、git diff --check 成功。Node 26で実施。READMEはNode 22、CIはDocker内で同じ検査を行う。
- 新規 wording645.mjs: API完全モック・token不要、PC1280×800、スマホ縦390×844/横844×390の草稿復元通知・設定補足の横はみ出し・録音終了aria-label・送信待ちボタンの収まりを確認。縦の入力幅366px（修正前は画面上で押しつぶされた状態）。
- 検証メディア/結果: /home/boxp/verification-artifacts/BOXP-645/wording/local/ 。phone-queue-before.png と phone-queue.png が表示比較。vaultにはメディアを保存しない。
- ブラウザ環境に不足した共有ライブラリと日本語フォントはrun workspace内で展開、既存Chromium headless_shellを使用。巨大素材はcheckoutへのsymlinkで参照。子が通常buildで一時生成したpublic複製は削除済み。
- trivyは環境に未導入でローカル実行不可。CIの通常gateを確認する。
- 再認証 reauth523.mjs（PC16/スマホ16、合計32シナリオ）は全成功。PWA pwa510.mjs（PC/Pixel7）のmanifest・SW・fallback限定cache・オフライン復帰は全成功。オフライン文言を既存端末にも更新するためSW cache名をv2へ更新した。送信待ちの既存モック検証結果は追記する。本番本人認証後の実画面・実機Safari・聴感は未確認。

## レビュー・配備

- 契約helperでgpt-6.1-terraへ委任、証跡verify成功。部分実装とテストを受領し、親で残提案を実装・差分確認。
- 指定のcodex-review/codex-review-file skillsは指定先/skills検索で未発見。runnerの通常codex review gate（P0/P1のみblocking）を通過してからmergeする。
- arch PRのrequired status-checkに加えてkohako image verify等の必要CIと最新headのreviewを確認する。通常main buildはGHCRへpushする。
- 本番は現在 sha-20ca2b5。配備はloliceの argoproj/kohako-studio/.argocd-source-kohako-studio.yaml のimage shaタグを通常PRで更新しArgoCD同期後、web/BFF双方のimage一致と配備版HTML/JSを確認する。未merge・未配備。
