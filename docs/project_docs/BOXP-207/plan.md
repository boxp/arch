# BOXP-207: apply が承認待ちのまま実行されない問題への対応計画

## 目的

main への push で動く `apply` が、GitHub の保護機能（2026-07-28 導入。public repository の workflow file を「悪意がある可能性あり」と判定すると、write 権限者の承認まで実行しない）によって実行されないまま放置される問題に対応する。

1. 止まったことに、Actions の画面を開かなくても気づける
2. 止まり始める回数を減らす
3. 止まっている間に実行されなかった apply を把握し、復旧できる

承認の自動化や保護機能の回避は行わない。

## 調査で分かったこと

2026-07-08〜10-01 の `apply` run 2,200 件を、各 run の commit における `apply.yaml` の内容（blob）ごとに並べて確認した。GitHub API の read-only 照会のみで、承認・rerun は行っていない。

### 未実行の run は 2 通りに表示される

`conclusion=action_required` の 224 件に加えて、`conclusion=failure` のうち 277 件が jobs 0 件だった。どちらも workflow は実行されていない。合計 501 件。

| 期間 (UTC) | 表示 |
| --- | --- |
| 07-30 01:28 〜 08-04 16:13 | `failure`（jobs 0 件） |
| 08-08 21:05 〜 08-11 07:23 | `failure`（jobs 0 件） |
| 09-08 07:43 〜 09-29 09:37 | `action_required` |
| 09-29 10:12 〜 09-30 02:11 | `failure`（jobs 0 件） |
| 09-30 03:28 〜 10-01 06:24 | `action_required` |

表示は `apply.yaml` の変更と関係なく切り替わっている（09-29 と 09-30 の切り替わりの前後で main の `.github/` は変わっていない）。「`action_required` になったタイミングで `apply.yaml` は変わっていない」という観察は正しく、そのとき変わったのは表示だけで、未実行の状態はその前から続いていた。

### 未実行の状態は apply.yaml の変更で始まり、承認で終わる

| `apply.yaml` の変更 (UTC) | 変更後の最初の run | 未実行が終わった時刻 |
| --- | --- | --- |
| 07-09〜07-25 の 8 回 | 実行された | - |
| 07-30 01:28、08-02 05:05、08-03 14:50 | 未実行 | 08-04 18:36 に boxp が 1 件を再実行 |
| 08-08 21:05 | 未実行 | 08-11 07:32 に boxp が再実行 |
| 09-08 07:43、09-08 20:15、09-30 01:36、09-30 02:05、10-01 04:52 | 未実行 | 10-01 07:01 に boxp が承認 |
| 10-01 08:24（#13077） | 未実行 | 08:26 に承認 |
| 10-01 09:23（#13090） | 未実行 | 09:40 に承認 |

- 保護機能の導入（07-28）より後の変更 11 回は、すべて変更後の最初の run から未実行になった。導入より前の 8 回（07-09〜07-25）では一度も起きていない。
- boxp が同じ内容の `apply.yaml` の run を 1 件承認（run attempt 2）すると、次に `apply.yaml` が変わるまでは attempt 1 で実行された。例外はなかった。
- 承認前に積まれた run は、承認後も実行されていない。

これは観察された対応関係であり、GitHub は判定の条件を公開していない。

### 関連する観察

- `test.yaml`（`pull_request_target`）でも、`wc-plan.yaml` を変更した #13090 の merge（10-01 09:23）後の最初の run から 3 件が `action_required` になり、10:53 の承認後は実行されている。
- 同じ Renovate の PR（#12980）で変更された `apply-ansible.yml` は、変更直後の push でも実行された。`toJSON(secrets)` を含むのは `apply.yaml`、`wc-plan.yaml`、`test.yaml` だけで、止まった workflow と一致する。
- 以前のチケットの記録にある「8 月は保留なし」「09-29〜30 の failure は Tailscale の認証エラー」は誤りで、どちらも jobs 0 件の未実行だった。

## 対応

### 1. 通知（arch の外）

2026-10-01 の owner 決定により、Hermes の cron が 15 分間隔で GitHub API を read-only で照会し、Kohako 経由の Telegram で通知する。GitHub issue による通知 workflow は arch に追加しない。

cron が `action_required` だけを見ている場合、`failure`（jobs 0 件）の表示に切り替わった期間を見逃す。同じ判定を `scripts/list-blocked-workflow-runs.sh` に用意したので、cron 側の条件をこれに合わせる。

### 2. 検知スクリプト

`scripts/list-blocked-workflow-runs.sh` を追加する。`apply.yaml` と `test.yaml` の直近の run から、`action_required` と `failure`（jobs 0 件）を一覧する。read-only。

### 3. 止まり始める回数を減らす

07-16 以降の `apply.yaml` の変更 16 回のうち 14 回は Renovate の更新で、automerge されていた。`renovate.json5` に `.github/workflows/**` を対象とする packageRule を追加し、週 1 回・1 PR に集約して automerge を無効にする。merge した人がその場で承認まで行う。

変更回数は減るが、変更のたびに承認が必要なことは変わらない。

### 4. toJSON(secrets) の除去（別 PR）

`apply.yaml` の `toJSON(secrets)` を `'{}'` に置き換える（PR #13097）。tfaction v2.3.2 は `secrets` 入力の全キーを terraform の環境変数にするため、現状はリポジトリの全 Secret が terraform に渡っている。terraform が環境変数で必要とするのは `CLOUDFLARE_API_TOKEN` だけで、これは apply step の `env` で渡している。`tfaction-root.yaml` で Secret を参照する `terraform/github/**`（`GH_TOKEN_APPLY`）には、該当する target も Secret の登録もない。

この変更は `apply.yaml` を変えるため、merge 時に 1 回は未実行になる可能性がある。効果は、その後の `apply.yaml` 変更（次の Renovate の週次 PR）で未実行が再発するかどうかで判定する。切り分けを明確にするため、この PR とは別の PR にする。`wc-plan.yaml` / `test.yaml` は、`apply.yaml` で効果を確認してから同じ変更をする。

### 5. 棚卸しと手順書

- [unapplied-inventory.md](unapplied-inventory.md): 未実行 501 件を target ごとに集計した。未カバーは 17 target・81 件で、すべてツールや provider のバージョン更新。実 apply が必要なものは見つからなかった。
- [runbook.md](runbook.md): 見分け方、承認の手順、過去の未実行 run の扱い、stale plan で失敗した場合の扱い。

## 確認

- `renovate-config-validator` で `renovate.json5` を検証する。
- `scripts/list-blocked-workflow-runs.sh` を実行し、既知の未実行 run が一覧に出ることを確認する。
- Renovate の設定変更後 2 週間の、未実行が始まった回数をチケットの Notes に記録し、対策前（09-30〜10-01 の 2 日間で 4 回）と比べる。

## 残る作業

- Hermes の cron の条件に `failure`（jobs 0 件）を加える（owner / hermes-agent）
- `toJSON(secrets)` 除去の PR を、承認できるタイミングで merge して結果を記録する
- `action_required` の run を `gh run rerun` で実行できるかの確認（boxp の了承を得て、no-op 見込みの 1 件で試す）
