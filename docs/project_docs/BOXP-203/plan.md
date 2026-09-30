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

本ticketはライブラリとfixtureのみ。featureは環境変数を指定しても有効化できない。Deployment、Argo、cron、credential、既存ticketを変更せず、永続state migrationもしない。rollbackは本PRのmerge commitをrevertするだけでよい。
