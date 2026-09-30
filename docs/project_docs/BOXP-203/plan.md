# BOXP-203 実装計画

## 目的と境界

BOXP-201のI1としてversion付きの実行intent/control、Decision Packet、retry、notificationを検証する独立ライブラリとsynthetic fixtureを追加する。構造検証は認証や実行許可を付与しない。runnerの候補選択、結果marker、PR gate、既存ticketの動作は維持する。

## 手順

1. 設計正本と既存runner/test/CIを確認する。
2. `autonomy_policy.bb` に固定registry、型・必須field・version・scope・digest・期限のfail closed検証を実装する。診断は固定category/codeのallowlistで生成する。
3. 発行済みの具体値fixture、unknown version/route/probe、欠落、改変、期限切れ、path traversal、禁止operation、秘密sentinelの否定テストを追加する。
4. featureは常にoffとし、既存lane/routeの候補選択、model/profile、black-box testを確認する。CIに新テストを追加する。
5. 独立レビューの指摘を解消し、対象testとGitHub CI結果をPRに記録する。

## 作業分担

指定されたterra workerは利用不可のため、低コストworkerへvalidator実装とfixture/testを分担委譲する。統合、互換性検証、最終判断、PR作成はcodex-solが担当する。

## 配布とrollback

本ticketはライブラリ、fixtureと下記のCIビルド依存修正を含む。featureは環境変数を指定しても有効化できない。Deployment、Argo、cron、credential、既存ticketを変更せず、永続state migrationもしない。ソースのrollbackは本PRのmerge commitをrevertする。公開済みイメージや稼働環境がrevertで自動的に戻ることは保証しない。

## CI gate再試行

PR #13032のimage buildは既存のeven-terminal/node-ptyが要求するC++コンパイラ不足で失敗した。全CI成功の受け入れ条件を満たすため、Dockerfileの既存makeをbuild-essentialに置き換え、node-gypが使うpython3を明示する。バージョンやrunner設定は変更しない。この実行はPR buildのみでpush無効。mainへmerge後は既存workflowがGHCRへイメージを公開する。対象テスト、追加差分レビュー、GitHub image buildを確認して同じPRを更新する。

## codex-review gate再試行

前回のP1指摘（Aqua/Terraformの無関係なバージョン巻戻し）に対応し、最新mainを既存PRへ通常mergeする。mainとの最終diffに依存import/checksumの変更がないことを確認し、validator・既存runner・recurring-eventsのテストとPR全体の独立レビュー、更新headのCIを再検証する。force-pushや別PR作成は行わない。
