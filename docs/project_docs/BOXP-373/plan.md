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
- mainへのmergeはimage build/Image UpdaterによりHermes再作成を伴い得る。00:05:59の票Notesで追加再作成は承認済み。実反映・再起動は親が実施する。
- 承認後のみ通常merge→image更新→rollout回数/稼働image/patch/receipt storageをreadback。既存eventを再実行せず、新規の隔離fixture/実通知確認が許可された範囲を区別して記録する。未配備・実通知未確認のまま完了扱いにしない。

## 検証記録

- Python標準unittest: SFW隔離18件（ホストは17件pass・image内接続1件skip、固定Hermes baseでは18件すべてpass）。マーカーに本文が併記されたケース、最終前の途中経過、配送先認可失効、crash-left回復も含む。
- 稼働source3ファイルへのpatch初回/再適用、構文compile成功。
- ローカルのimage全体build成功（`boxp373-hermes-fixture`、18件の回帰もbuild内で実施）。本番Pod・本番設定は変更なし。
- image buildで先に見つかった既存のBabashka 1.13.229 checksum不整合を是正。同じversionの公式release asset digest、公式`.sha256`、実downloadのSHA256がすべて`64fb984991c6e68f44e8a9391176a9bb411f9b9ae9959a6bca5307c75a7414da`に一致したため固定値のみ更新。version変更・checksum検査の無効化なし。出典: https://github.com/babashka/babashka/releases/tag/v1.13.229
- 独立codex-reviewで途中経過とfinalの分離、配送先例外、本文付きマーカー、起動後回復の指摘を受け、修正と回帰を追加した。最終review/CIの結果は票Notesを参照。

- Trivy config全体検査を実行。変更対象Dockerfileのbaseline比較では既存DS-0002/DS-0026のみで増加なし（root実行/HEALTHCHECK未設定）。今回それら既存設計は変更しない。

## P1 retry 実装・検証

- 固定版の起動時復旧は保存された最終メッセージから単独マーカーを検出するが、agent の成功・失敗を復元しない。Notes の `result=silent` だけでは失敗後の配送前クラッシュを区別できないため、対象 task-board の復旧マーカーは `recovered_outcome_unknown` として event と照合手順を含む通知にする。成功した実行でもクラッシュ後は同じ通知になる。実行中に成功と silent receipt を確認できた場合の無通知は維持する。
- SFW fixture で失敗・成否不明・成功の各復旧を確認し、silent receipt があっても通知されること、失敗時の通常処理と成功時の正当な無通知を確認した。ホストの `python3 -m unittest discover -s docker/hermes-agent/patches -p 'test_task_board_delivery.py' -v` は18件中17件成功、image内専用1件スキップ。
- digest固定 Hermes v0.22.5 の隔離コンテナ（ネットワーク無効）へ fixture を渡し、patchを2回適用して4対象ファイルの SHA-256 が一致することを確認。同 image 内の unittest は18件すべて成功。実配送や稼働環境の変更はしていない。
- 親の独立reviewで追加検出した「要確認通知のsentが後続の必要報告を抑止する」P1も修正。要確認通知は `.notice.json`、業務報告は `.json` で別receiptとし、eventの排他を共有する。同一eventへの無制限な再送は許可せず、各通知/報告はそれぞれ一度。未確認metadata付きでも本文を持つ報告は業務報告として重複を抑止する。
- 最終版はホスト19件中18件pass/接続1件skip、image全体build内19件すべてpass。未解決通知→成功/要判断の報告→各重複を回帰し、通知が報告を消さないことを確認。指定helper委譲の証跡verifyも成功した。

## PR14248 gate P1: 復旧接頭辞とreceipt

- 固定Hermes v0.22.5の`_redeliver_claimed_obligations`は、保存本文の前に`RECOVERED_MARKER`等を付けてから`adapter.send`を呼ぶ。復旧通知を送信本文の先頭だけで判定すると業務報告のreceiptを消費する。
- 起動配送は接頭辞付加前の保存本文から通知かを判定し、内部metadataで渡す。通知と業務報告のreceiptは引き続き別々で、eventの排他とunknown時のfail-closedを維持する。旧patch適用済みsourceへの再適用にも対応する。
- SFWホスト試験は21件中19件成功、image専用2件skip。digest固定baseのネットワーク無効コンテナで初回・再適用後の4ファイルのSHA-256一致と21件成功を確認。実際の起動配送メソッド、上流`RECOVERED_MARKER`、偽adapter、一時receiptを接続し、復旧通知と後続業務報告それぞれの重複抑止を確認した。旧patch適用済みfixture imageでも再適用後21件成功。実event・外部配送・本番変更は行っていない。

## PR gate P1: queued first response

- 固定baseの `_run_agent_deliver_first_response` は通常shaperより先に応答を送るため、対象task-boardでは同じNotes照合と失敗判定を適用し、queued送信にfinal metadataを付ける。証拠付きsilentだけ抑止し、失敗・証拠不明は要確認通知にする。
- 親検証でqueued専用receipt案を修正。同一eventのqueued報告・通常fallback・起動回復は同じ業務receiptを共有し、送信済み/未確定とも二重配送を防ぐ。次のinbound eventは独自source/event IDにより別receiptを持ち、必要報告を保持する。要確認通知は業務報告と分離する。
- ホスト `python3 -m unittest discover -s docker/hermes-agent/patches -p 'test_task_board_delivery.py'` は23件中20件成功、固定image専用3件skip。digest固定v0.22.5のネットワーク無効コンテナへfixtureを `docker cp` し、patchを2回実行後に5ファイルのSHA-256一致、同unittest 23件成功。実際のqueued経路の3メソッドと一時vault・偽adapterを接続し、silent、失敗、未知、後続報告、重複、および未確定時のfallback停止を確認した。実配送・本番変更なし。親によるimage全体buildも成功（`boxp373-hermes-queued-fixture`、23試験全pass）。同imageの5対象ファイルはpatch再適用後もSHA-256一致。親修正後も通常/復旧fallback重複抑止と別event後続報告の保持を確認。

## PR14248 gate P1: streaming と queued 配送

- 固定 Hermes v0.22.5 では stream consumer が final metadata を付けずに送信する。default profile の task-board event に限り、通常 runner と proxy の両方で consumer を生成せず、最初の最終送信から shaper と receipt を通す。途中 commentary も同 consumer で送信されるため対象では無効化する。他の route/platform は既存設定を維持する。
- queued 経路の `_already_streamed` 強制上書きを撤去し、旧patchからの更新も可能にする。queued・通常final・復旧fallbackのreceipt共有、unknown時のfail-closed、既存の認可・lockを維持する。
- ネットワーク無効の固定 Hermes fixture imageで未適用sourceと旧queued patch適用済みsourceそれぞれに初回・再適用し、6対象ファイルのSHA-256一致、24試験全成功を確認。実際の固定sourceの通常runnerとproxyのconsumer生成メソッドに接続し、streaming ON時の対象抑止と別routeの維持を確認。queued・通常final・fallback・silence証拠不足・uncertain receiptの既存回帰も実行した。実通知・本番操作は行っていない。

- 親検証: image全体build `boxp373-hermes-stream-fixture` 成功、build内24試験すべてpass。ホスト20pass/4skip、指定helperの委譲証跡verify成功、Trivy全体検査の対象Dockerfileは既存DS-0002/DS-0026のみ。
