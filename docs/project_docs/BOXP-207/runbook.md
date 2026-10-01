# BOXP-207: apply が実行されないときの runbook

main への push で動く `apply`（`.github/workflows/apply.yaml`）が、GitHub の保護機能によって実行されないまま終わることがある。この文書は、その状態の見分け方と復旧手順をまとめる。調査の根拠は [plan.md](plan.md)、過去分の棚卸しは [unapplied-inventory.md](unapplied-inventory.md) にある。

## 何が起きるか

GitHub は 2026-07-28 から、public repository の workflow file を「悪意がある可能性あり」と判定すると、write 権限を持つ人が承認するまで run を実行しない（[changelog](https://github.blog/changelog/2026-07-28-github-actions-holds-potentially-malicious-workflows-for-approval/)）。設定で無効にはできない。

boxp/arch では次のように現れる。

- main 上で `apply.yaml` の内容が変わると、変更後の最初の run から実行されなくなる。2026-07-30 以降の変更 11 回すべてで起きた。
- 同じ内容の `apply.yaml` の run を 1 件承認すると、次に `apply.yaml` が変わるまでは通常どおり実行される。
- 承認前に積まれた run は、承認後も自動では実行されない。
- `test.yaml`（`pull_request_target`）でも、`wc-plan.yaml` を変更した PR #13090 の merge 後に同じことが 1 回起きた。

実行されなかった run は jobs が 0 件で、数秒で終わる。表示は 2 通りあり、時期によって切り替わる。

| 表示 | run の画面 |
| --- | --- |
| `action_required` | 「GitHub detected that this workflow file may be malicious. It will not run until someone with write access approves it.」のバナーが出る |
| `failure`（jobs 0 件） | job が 1 つもないまま失敗になる。terraform の失敗ではない |

`failure` の表示のときは、Actions の一覧では普通の失敗と区別がつかない。job が 1 つでもあれば、この文書の対象ではない通常の失敗である。

## 気づく方法

- 通知: Hermes の cron が 15 分間隔で GitHub API を照会し、Kohako 経由の Telegram で知らせる（2026-10-01 の owner 決定。設定は arch の外にある）。
- 手元での確認:

  ```bash
  scripts/list-blocked-workflow-runs.sh
  ```

  `apply.yaml` と `test.yaml` の直近 30 件を調べ、未実行の run を一覧する。`failure`（jobs 0 件）も拾う。最新の完了 run が未実行なら終了コード 2 を返す。read-only で、承認や rerun はしない。
- `apply.yaml`、`test.yaml`、`wc-*.yaml` を変更する PR を merge した直後は、通知を待たずに [apply の一覧](https://github.com/boxp/arch/actions/workflows/apply.yaml) を開いて確認する。

## 復旧手順

1. 未実行の run のうち、いちばん新しいものを開く。
   - `action_required` の一覧: <https://github.com/boxp/arch/actions/workflows/apply.yaml?query=is%3Aaction_required>
   - `failure` 表示の場合は `scripts/list-blocked-workflow-runs.sh` が出す URL を使う。
2. write 権限のあるアカウントでログインしたブラウザで承認する。バナーがあればバナーから承認し、`failure` 表示なら「Re-run all jobs」を押す。承認すると run attempt 2 として実行される。
3. 実行された run が success することを確認する。失敗した場合は通常の apply 失敗として扱う（下の「stale plan で失敗した場合」）。
4. `scripts/list-blocked-workflow-runs.sh` をもう一度実行し、`latest=ran` になっていることを確認する。以後の push は attempt 1 で実行される。
5. 承認前に積まれた run を「過去の未実行 run の扱い」に従って確認する。

`test.yaml` の場合も同じで、PR の画面から未実行の run を開いて承認する。承認後は、他の PR の run も通るようになる。

## 過去の未実行 run の扱い

承認前に積まれた run を、まとめて承認したり rerun したりしない。理由は次の通り。

- tfaction の apply は、PR で作った plan file を適用する。古い run の plan は、その後の apply で実環境が変わっていると stale になり、失敗する。
- 失敗した apply は target ごとに follow-up PR を作る。数十件を rerun すると follow-up PR が大量にできる。
- 後から同じ target の apply が成功していれば、それ以前の未適用分はそこで一緒に適用されている。

代わりに target 単位で確認する。

1. 未実行だった run の commit が変更した target を調べる（Renovate の PR なら、タイトル末尾の括弧がディレクトリになっている）。
2. その target について、未実行 run より後に成功した apply があれば、対応は不要。
3. なければ、変更の中身を見る。
   - aqua のツール更新や provider のバージョン更新だけなら、実環境への変更はない見込みなので、次にその target を変更する PR の plan で確認すれば足りる。
   - リソース定義の変更が含まれるなら、その target を変更する小さな PR を作り、plan に未適用の差分が出ることを確認してから merge して apply する。複数の target がある場合は、依存される側（IAM や tfaction の role など）から先に行う。

## stale plan で失敗した場合

承認した run や、その後の apply が「Saved plan is stale」などで失敗した場合は、`apply.yaml` の `create-follow-up-pr` が follow-up PR を作る。follow-up PR の plan を確認して merge すれば、新しい plan で apply される。失敗した run を rerun し続けない。

## してはいけないこと

- 承認を自動化しない。GitHub は承認を、write 権限者の認証済み Web セッションで行うものと定めている。bot や token による自動承認、保護機能の回避は行わない。
- 未実行の run を一括で承認・rerun しない。
- `failure`（jobs 0 件）を terraform の失敗と決めつけて、原因調査を別のチケットに回さない。まず jobs の件数を見る。

## 未確認の点

- `action_required` の run を `gh run rerun` で実行できるかは試していない。これまでの承認が Web の操作か rerun かは、API からは区別できない。
- 判定の条件は GitHub が公開していない。`apply.yaml` と `wc-plan.yaml` には `toJSON(secrets)` があり、同じ Renovate の PR で変更された他の workflow（`apply-ansible.yml` など）は止まっていないため、この記述が判定の対象になっている可能性が高いが、検証はできていない。

## 止まり始める回数を減らす設定

`renovate.json5` で、`.github/workflows/**` の更新を週 1 回・1 PR にまとめ、automerge を無効にしている。merge する人が、その場で上の復旧手順 1〜4 まで行う。
