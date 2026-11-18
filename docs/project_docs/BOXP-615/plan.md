# BOXP-615: Kubernetes 1.37 技術ブロッカーの定期監視漏れを修復する

## 背景

Owner の「定期的にブロッカーを確認する手筈」を確かめたところ、既存の日次 watch
（Codex Cron の command job `arch-renovate-blocker-watch`、毎日 13:30 JST、LLM なし）は
K8S-HOLD として「main の固定版」と「1.36 の EOL」しか見ておらず、
Kubernetes 1.37 への更新（BOXP-191、Owner 保留中）を止めている技術ブロッカーを追っていなかった。
Owner が是正を承認した。

## 方針

- 新しい cron は作らない。既存の watch（vault の `Projects/github-pr-hygiene/renovate-blocker-watch/watch.bb`）に
  1.37 技術ブロッカーの check を 4 件足す。通知経路も既存（BOXP-590 Notes → Hermes 中継）のまま使う。
- 一次資料だけを read-only で読む。GitHub API は認証済み `gh api` を優先し、失敗したら未認証 HTTP に切り替える。
- 判定は解消（resolved）/未解消（blocked）/取得失敗（fetch-error）に分ける。取得失敗は未解消とも解消とも扱わない。
  実行時前提・本人判断・未知は watch の判定に混ぜず、台帳に書き分ける。
- 1.37 の check は、判定が変わらなくても署名（PR や issue の状態、候補 patch、GA 版、tag/digest）が変わったら
  `changed` を 1 回だけ通知する。何も変わらなければ通知しない。初めて登録した回も通知しない。
- `resolved` は上流で条件がそろったという意味だけを持つ。1.37 の保留解除、gate 無効化の受容、クラスタの upgrade、
  BOXP-191 の再開は Owner が判断する。watch は票を作らない。

## check

| ID | resolved の条件 | 変化として通知するもの |
| --- | --- | --- |
| K8S137-NODELIFECYCLE | 正式な 1.37.x patch（v1.37.1 以降）の CHANGELOG 節に、kubernetes#141572 / #141622 の番号か同じ release-note の文言（cherry-pick を含む）が載る | PR の merge/close、issue の close、release-1.37 の `pkg/controller/nodelifecycle` への新しい commit、最新 patch の更新 |
| K8S137-LONGHORN | 1.12 以降の各 minor の最新 GA について、docs の tested 表に 1.37 が載る | GA の追加、tested 表の変化 |
| K8S137-KIND | 候補 patch（1.37 の最新正式 patch）の kindest/node tag が出る | tag/digest の追加・変化、候補 patch の更新 |
| K8S137-CALICO | 最新 GA minor の requirements に 1.37 が載る | 最新 minor や tested 表の変化 |

## 確認

1. dry-run と、テスト用 vault・スタブ helper を使って「初回は通知しない」「署名が変わったら changed を 1 回通知する」
   「判定が戻ったら re-blocked を通知する」「変化がなければ通知しない」ことを確かめる。
2. 本番の state を初期化する（静音時間帯の初回登録なので通知はない）。
3. 台帳（vault と、この repo の `docs/project_docs/BOXP-590/blockers.md`）を更新する。
4. 次回の実 cron（2026-11-19 13:30 JST）が動いたこと、最新結果、通知判定（変化がなければ通知なし）を確かめる。

## やらないこと

本番クラスタの upgrade、feature gate の変更、例外の受容、CSI/CNI の移行、保留の解除、新しい権限や課金、BOXP-191 の再開。

## 実施結果（2026-11-18）

- watch.bb に K8S137-* の 4 件を追加し、dry-run・テスト用 vault・単体確認で動きを確かめた。codex-review-file の指摘 2 件を反映した。
  - P1: master の CHANGELOG に先に載る未公開の patch 節で resolved にならないよう、最新の正式 patch 以下だけを数える。
  - P2: 取得失敗から回復した回に遷移や changed も起きたときは、通知を 1 件にまとめる。
- 本番 state の初回登録は 2026-11-18T19:38Z に行った（静音時間帯の初回登録なので通知はない）。
- Codex Cron の job 名だけ「＋K8s 1.37 技術ブロッカー」に変えた。id、schedule、command は変えていない。
