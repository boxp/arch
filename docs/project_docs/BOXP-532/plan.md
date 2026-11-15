# BOXP-532 公式混雑時の通知抑止

- 正規 producer は `docker/hermes-agent/sunrise/watch.py`。既存設定に原因別の通知抑止はなく、公式 20100946 の `congestion` 分類のみ障害メッセージの生成を省く。
- unknown、原因、連続失敗数、観測日時、正常値と既存通知時刻を保持し、他原因の連続失敗・6時間抑止と空席通知を維持する。設定、state、配送先、cron は変更しない。
- 合成入力だけで3回以上、6時間超、各 tick の別プロセス起動、混雑から他原因への遷移、混雑と空席の同時発生を確認する。既存の sunrise 回帰テストを実行し、CI の既存 Sunrise monitor job で実行する。
- 通常のレビュー・CI・merge 後は Hermes image の既存配備経路で反映し、実効 revision と次の通常 tick を確認する。私的な設定や state は公開しない。

## 検証結果

- 合成26試験成功。新規プロセスごとの stdout capture で、継続混雑、6時間超、別原因通知後の混雑、混雑復旧の無出力を確認。unknown/正常値/連続数/日時/通知履歴を保持し、混在する空席遷移は出力する。
- 同じ回帰試験を変更前 producer に適用すると混雑通知により2試験失敗し、修正版では成功する。
- `git diff --check` 成功。Trivy は組込み checks で全体走査済み。変更のない Hermes Dockerfile の DS-0002/DS-0026 は既存指摘。
- PR の現 head に対する通常 CI と独立 P0/P1 gate は runner で確認する。merge・正規配備・配備版照合・自然 tick は後続の確認が必要であり、実環境での混雑無通知はまだ観測していない。
