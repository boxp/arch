# BOXP-539: 本人 portfolio とひとはこ portal の継続更新を本番反映まで自走させる

## 承認範囲

Owner は家経由で、両サイトを architecture 図と同じく定期更新し本番まで反映することを承認した。
更新ごとの stage 受入と本番承認は求めない。Owner は気になった点を後から指摘する。
新しい課金、権限、他サイトの変更は対象外。

## 対象

| サイト | 公開 URL | Pages project | 更新元 | 反映先 |
|---|---|---|---|---|
| 本人 portfolio | https://b0xp.io/ | `shanghai` | Medium `@boxpketaro` の feed、Speaker Deck `boxp` の feed、GitHub `boxp` の公開 repo | `apps/portfolio/src/content/{articles,talks,projects}.json` |
| ひとはこ portal | https://hitohako.b0xp.io/ | `boxp-hitohako` | YouTube channel `UCS8gl96UiidzwHrn9bugOKg` の feed | `apps/hitohako/src/data/archives.json` など |

公開済みの情報だけを使う。非公開の vault、個人情報、内部の掲載判断はサイトにも public PR にも出さない。
実績は作らない。ひとはこさんの肩書 (変身ヒロイン VTuber)、boxp はプロデューサー、hero とデザインは保持する。

## 経路

1. codex-workspace の cron job `site-refresh` (agent なし、`:runner "command"`) が 6 時間ごとに `site_refresh.bb tick` を実行する。
2. tick は 4 つの公開元を読み、main の `docs/site-refresh/baseline.json` にない項目だけを差分とする。
   差分がなければ agent を起動しない。
3. 差分があればチケットを 1 枚作る (Ready、担当 codex)。処理中のチケットがあれば Notes に集約する。
   同じ差分の key では二重に起票しない。チケットが閉じても基準が進まなければ 2 回で止め、Backlog に通知する。
4. 公開元の取得に 3 回続けて失敗したら、異常のチケットを作る。取得の失敗を「項目が消えた」とは読まない。
5. 担当 agent は差分を確認してサイトのデータを直し、`baseline.json` を進める PR を作る。通常の CI、review、merge を通す。
6. main への merge で、既存の deploy workflow が stage に続いて本番へ配備する。
   - 配備の前に、本番で配信中の deployment ID を戻し先として記録する。
   - 本番設定で build し、stage 設定の混入がないことを検査する。失敗したら配備しない (前の版が配信を続ける)。
   - 配備のあと実 URL を取得し、build の `index.html` と一致するまで待つ。一致しなければ記録した版へ自動で rollback し、job を失敗にする。
7. 担当 agent は実 URL で新しい内容を確認してから done にする。

## 変更

- `docker/codex-workspace/site-refresh/` に `site_refresh.bb` と `README.md` を追加し、Dockerfile で image に入れる。
- `recurring-events/vault-seed/Infrastructure/Codex Cron/jobs.edn` に job を追加する。
- `docs/site-refresh/baseline.json` を追加する。初期の基準は、各サイトの最後の受入 (portfolio は 2026-11-06 の BOXP-442、ひとはこは 2026-11-09 の BOXP-478) までに公開された項目とする。それより後の公開活動は、最初の差分として実経路で処理する。
- `deploy-portfolio.yml` と `deploy-hitohako.yml` に、main push で本番へ配備する job を追加する。
- `apps/portfolio/src/lib/diagrams.ts` は本番でも両図を出す (BOXP-442 で承認済み)。全体図のサムネイルは引き続き repo に置かず、配備時に secret から復元する。
- `promote-*-production.yml` は固定版を配備する `promote` を外し、`inspect` と `rollback` だけを残す。
- infra-diagram-refresh の README の「portfolio 本番は自動で更新しない」を、本票の承認に合わせて直す。

## 確認

- `tests/codex-workspace/site-refresh-test.bb`: 差分なし、差分あり、重複 tick、処理中への集約、取得失敗の連続、再起票の上限。
- PR の CI、codex review (P0/P1 なし)、merge。
- merge 後の本番配備 run の成功と、両サイトの実 URL の HTML が build と一致すること。
- image の反映後、tick を手動で実行して起票を確認し、2 回目の tick が二重に起票しないことを確認する。
- 次の定期実行を status で確認する。

## レビュー指摘への対応 (codex review P1)

- 本番 job だけの排他では、古い commit の stage が遅れて終わると古い版が最後に本番へ出る。`deploy-portfolio.yml` と `deploy-hitohako.yml` は workflow 全体の concurrency で main の run を push 順に直列化し、待機中の古い run は新しい run に置き換える。
- `seed-baseline` は GitHub にも cutoff を適用する。前回受入日より後に作成された公開 repo は基準に入らず、最初の差分として処理する。現時点の実データでは該当 repo がなく、再生成した基準は `docs/site-refresh/baseline.json` と一致した。
