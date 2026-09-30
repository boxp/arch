# BOXP-203 validator契約

## 実行しない構造検証

`docker/codex-workspace/task-board/autonomy_policy.bb` はnamespace `autonomy-policy` の純粋ライブラリ。`load-file` 後に `validate-control`、`validate-decision`、`validate-retry`、`validate-notification` を呼ぶ。各関数は入力mapとtrusted contextを受け、`{:valid? boolean :diagnostic {:category keyword :code string}}` のみを返す。

`:valid? true` は構造・固定policy境界に合致するという意味であり、認証・認可・発行の真正性・実行許可を示さない。writer_generation/revisionの単調性、control storeの認証、owner署名、失効、承認の一回消費、現在ticket要求との照合、symlinkを含む実filesystemの境界は後続ticketの責務。ライブラリは起動、probe、書込、通知送信を行わない。runnerから本番経路で呼び出さず、v2は環境変数によらず常時off。

## 入力

contextの `:now` は具体的なUTC日時（末尾Z）、`:allowed-repos` は許可repoのvector/set、`:allowed-paths` は許可されたrepo相対path prefixのvector/set。入力自身から許可範囲を取得しない。複数repoを扱う際はcontextのpath境界が各repoで共通に適用されるため、repoごとに個別検証する。入力mapのkeyはnamespaceなしkeywordまたは対応するstringを受理し、正規化時の衝突を拒否する。

controlはschema_version=2、packet/retry/notification policyはschema_version=1。既知keyの完全一致で検査し、未知keyや欠落を拒否する。objective要求snapshotのUTF-8 SHA-256を検算する。path検査はlexicalな相対path検査で、実pathの権限付与には使わない。

decision/retryはcontextの `:control` とticket/revision/scopeを照合する。I1の具体的なissued packetでは `:scope` に `scope-digest` が返すcontrol scopeのSHA-256を格納する。設計の自由文scope説明を権限として受理しない。scope digestはkeyword化したmapのkeyをEDN表現順でソートした `pr-str` のUTF-8 SHA-256。vector順序を保持する。この形式はローカルfixture契約で、承認event署名のcanonical packet digestではない。

contextに任意の `:artifact-head` を指定するとdecision/retryの完全SHAを現在headと照合する。省略時はSHAの構造のみを検証する。将来の実行認可では省略可能な構造検証だけに頼らず、現在headの照合を必須とする。

retryの初期probe registryは `github-checks` のみで、resourceは `owner/repo#PR番号`、category/actionは `ci-pending` / `inspect-ci`。期限は現在から24h以内、attemptsは3回未満、backoffは正数かつ非減少。期限内の過去next_checkは確認時刻が到来した契約として受理する。fixtureは外部APIを呼ばない。notificationは設計のWIP/budget/notification policy構造を検査するもので、自由文outboxや送信先の認可は扱わない。予算上限は初期設計の6steps/60minutes、WIP上限は2/1/1/1に固定する。

## 公開diagnostic

`public-diagnostic` は固定category/codeのallowlistから新規mapを生成する。任意属性、例外本文、入力自由文、ticket/repo/path/artifact/URLを公開しない。unknown categoryも固定の拒否診断へ落とす。validatorは入力や例外を保存・表示しない。

## 検証とrollback

synthetic fixtureの `issuance: issued` は構造例で、実owner発行や承認ではない。固定clockで新旧version、必須field、scope/digest/head、期限、traversal、禁止operation、秘密sentinelを検証する。

```bash
bb tests/codex-workspace/autonomy-policy-test.bb
tests/codex-workspace/task-board-runner-test.sh
tests/codex-workspace/recurring-events-test.sh
```

CIは既存Task Board runner workflowに新validator testを加える。Deployment/Argo/cron/credential/既存ticketの変更、永続state migrationはない。rollbackはPRのmerge commitを通常のrevert PRで戻すだけでよい。
