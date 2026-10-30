# BOXP-373: Webhookの正当な無通知と応答欠落の区別

## 調査結果

2026-10-30 UTC、本文・資格情報を転記せず、配備sourceとevent/run/result metadataを照合した。

- 直近の11警告はtask-boardの異なるlane event。16:47:17のBOXP-363、16:58:40–57のBOXP-54/38/297/215/286/285/284/305/282/306。全11件が各票の同一eventの`[kohako-event] handled ... result=silent`に一致。同一eventの再配送連投ではない。業務報告が必要だったのに消えた、とこれら11件からは判断できない。旧警告すべての分類が完了したとは扱わない。
- Hermes共通`gateway/run_turn_persistence.py`は、成功した単独silence markerを`reply_expected=None`のWebhookでも人への応答欠落として警告へ置換する。Webhook adapterの自律無通知判定より前に置換されるため、警告がTelegramへ配送される。task-board routeは未登録票・既対応・重複等でsilenceを明示的に要求しており不整合がある。
- 稼働imageは`sha-88638ef`、image ID `sha256:2d7ff9d6e7d40ccfc0be4fd39da85ee2a93ed7c1eae8e6537849f11d772128f7`。arch最新mainのbaseはHermes v0.22.5（digest固定）。稼働Podのkohako-g2-contextは1.4.0、pre_llm_call/pre_tool_callの2hookで通知decisionは撤去済み。警告の生成主体は同pluginではない。
- 23:29–23:30の360/367/369/372/373各Opus run終了は、73-byteの同一認証エラー（OAuth session expired and could not be refreshed）。stderrは本票で0 bytes。silence警告とは別の障害。利用枠超過やリセット時刻は実証していない。既存Claude認証の正常化が復旧条件で、新鍵/API fallbackや盲目的再試行は行わない。
- dispatcherは稼働。直近ログは通知休止時間（02–09 JST）によるdefer。関連票の最新10eventはpending/attempts=0/redeliveries=0であり、その未配送を警告の再送と混同しない。

公式資料と上流source（2026-10-30確認）:

- https://hermes-agent.nousresearch.com/docs/user-guide/messaging
- https://github.com/NousResearch/hermes-agent/blob/main/gateway/platforms/webhook.py
- https://github.com/NousResearch/hermes-agent/blob/main/gateway/run_turn_persistence.py
- https://github.com/NousResearch/hermes-agent/issues/110952 （人からの応答欠落を可視化する上流修正。今回の証拠付き無通知まで一律muteしない）
- https://status.claude.com/api/v2/summary.json （23:11更新、全サービスoperational。個別OAuthや利用枠の正常性を保証しない）

確認したmain sourceにもWebhookイベントのreply_expected指定がなく、同じ共通判定が存在するため、上流修正版の一律更新で解消すると断定できない。将来は同等の証拠判定と配送receiptが上流に入った時点で本patchを撤去する。

## 最新票Notesからの引継ぎ（再実行なし）

| 票 | 既存の実作業状態 | 残作業・停止条件 |
| --- | --- | --- |
| 360 | arch#14236のhead 405302145、17:09時点でCI/review通過 | merge/反映の最新状態確認とSLI v1/Hermes joinは未完。23:30 runはOAuthで即時停止 |
| 366 | lolice#961 merge、plugin1.4.0をreadback済み、承認済み再作成1回を消費 | Ownerの新規独立指示/G2実機E2Eは未確認。再起動枠を本票に流用しない |
| 367 | 配備経路は反映済み。370読取解決/371旧branch試行の是正はarch#14243 | pilot再試験は未達。23:29再試行はOAuthで即時停止 |
| 369 | arch#14242、P1 lock競合修正/試験途中の成果あり | 未保存子成果を保全、最新head・review指摘確認から。23:29再試行はOAuthで即時停止 |
| 372 | lolice#969とarchの既存Codex子成果あり | 二重委譲せず検証から。subscription収集/画面readbackは未達。23:29再試行はOAuthで即時停止 |

## 実装方針

1. image build時の限定patchで共通shaperとWebhook送信に証拠判定を挿入。対象はdefault profile/task-board routeと厳密なBOXP event IDのみ。internal化・認可/承認/Board lock変更はしない。
2. 同一eventのhelper形式Notes receiptが一意にsilent、agent成功、単独silence markerという3条件が揃う場合だけ既存の警告置換を免除する。未知・矛盾・空出力・failedはeventと復旧条件付きの通知にする。必要かもしれない通常報告は消さず未確認metadataを添える。
3. 最終応答・例外通知・起動後回復の配送時だけ（途中経過とは分離して）、永続領域へevent/classification/state/時刻のみ記録し、排他とfsyncで同一eventの送信を一度に制限。本文・宛先・資格情報は保存しない。sentは通知の配送完了であり業務成功を意味しない。未解決通知のclassificationはunresolvedのまま保持する。
4. intent後のcrash/送信失敗はuncertainとして止め、通知先とreceiptのread-only照合を復旧条件にする。自動再送・業務再実行・既存イベントのreplayはしない。手動復旧でもOwnerが配送有無を確認するまでreceiptを削除しない。
5. base sourceのanchorが変わればbuildを失敗させる。原子的でない未知の上流構造へ推測patchしない。

## 検証と反映条件

- SFW fixtureは一時vault/receiptと偽adapterだけを使い、実モデル/実通知/実会話を使わない。成功・要判断・重複・既対応silence・空出力・例外・再送・競合・記録破損・他platformの保持を回帰する。
- 稼働Podからsourceコード3ファイルだけを一時領域へ取得し、patchの初回/再適用と構文compileを確認。稼働Podのファイルは編集しない。
- 独立codex-review、image build、CIを確認する。最終結果は票Notesへ記録。
- **本PRはmerge保留**。mainへmergeするとimage build/Image UpdaterによりHermes再作成が起こり得る。本票では追加再作成が未承認なので、CI/review完了後に「このimage patchの反映でHermes再作成1回」を一点相談する。
- 承認後のみ通常merge→image更新→rollout回数/稼働image/patch/receipt storageをreadback。既存eventを再実行せず、新規の隔離fixture/実通知確認が許可された範囲を区別して記録する。未配備・実通知未確認のまま完了扱いにしない。

## 検証記録

- Python標準unittest: SFW隔離18件（ホストは17件pass・image内接続1件skip、固定Hermes baseでは18件すべてpass）。マーカーに本文が併記されたケース、最終前の途中経過、配送先認可失効、crash-left回復も含む。
- 稼働source3ファイルへのpatch初回/再適用、構文compile成功。
- ローカルのimage全体build成功（`boxp373-hermes-fixture`、18件の回帰もbuild内で実施）。本番Pod・本番設定は変更なし。
- image buildで先に見つかった既存のBabashka 1.13.229 checksum不整合を是正。同じversionの公式release asset digest、公式`.sha256`、実downloadのSHA256がすべて`64fb984991c6e68f44e8a9391176a9bb411f9b9ae9959a6bca5307c75a7414da`に一致したため固定値のみ更新。version変更・checksum検査の無効化なし。出典: https://github.com/babashka/babashka/releases/tag/v1.13.229
- 独立codex-reviewで途中経過とfinalの分離、配送先例外、本文付きマーカー、起動後回復の指摘を受け、修正と回帰を追加した。最終review/CIの結果は票Notesを参照。

- Trivy config全体検査を実行。変更対象Dockerfileのbaseline比較では既存DS-0002/DS-0026のみで増加なし（root実行/HEALTHCHECK未設定）。今回それら既存設計は変更しない。
