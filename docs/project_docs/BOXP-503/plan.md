# BOXP-503 追補: kohako-home の依頼が立て続けに失敗する問題（2026-11-12）

## 実観測（Hermes state.db / runs_idempotency.db / agent.log）
- 08:37:49 画像添付「これはなんでしょう？」(session kohako-web-mwd5ro1v) → Hermes の `POST /v1/runs` 202 応答は 08:39:51（122秒）
- 08:38:37 同じ画像を再送 (session kohako-web-mwdap8ux) → 202 は 08:40:07（90秒）
- 08:39:05 通知返信「失敗したようです」(テキストのみ, kohako-web-mwdaq9yc) → 202 は 08:40:10（65秒、画像受付の後ろで待機）
- BFF `hermes.ts` は POST も含め全 Hermes 呼出しを 10 秒で abort → `hermes_unreachable`(unknown) → 家は失敗表示・session 切替。
- しかし Hermes では 3 run とも受理・実行・completed（run_67d05c25…/run_5f7361b6… は画像に正しく回答）。家に表示されない孤立 run と、同じ依頼の二重実行が発生していた。
- Hermes の admission は authority 単位の `_api_admissions` ロックで直列化（gateway/session_api.py:125-132）され、画像の保存・fsync・DB bind/解放確認を含むため、先行の画像受付が別 session のテキスト受付も待たせる。画像の CPU 処理単体は 0.05 秒程度で主因ではない。122 秒の内訳は既存ログでは特定不可。
- execute_code の BLOCKED（api_server は unattended）は 11/11 以降 8 回あるが、いずれも model が read_file/terminal 等の通常 tools で代替し最終回答まで completed。全 72 run 中 completed 71 / cancelled 1 で、run 失敗の原因ではない。

## 変更
- BFF: `POST /v1/runs`（run 作成）だけ待機上限を 240 秒へ延長（`CREATE_RUN_TIMEOUT_MS`）。状態確認・承認・停止などは 10 秒のまま。
- 回帰テスト: 122 秒かかる作成を待って done になること、状態確認は 10 秒で unknown になること（修正前は hermes_unreachable で fail）。

## 変えないもの
- execute_code の unattended 拒否・承認ポリシー（approvals.unattended_mode 変更や迂回はしない）、gate/toolsets、Owner 境界。
- Hermes core の admission 直列化（上流の挙動。計測が必要なら別途）。

## 検証 / rollback
- CI・codex review → merge → kohako-studio image 追従の readback。実画像送信の E2E は Owner Access JWT が必要なため Owner 操作で確認。
- rollback: 本 PR を revert。
