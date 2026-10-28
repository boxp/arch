# BOXP-349 実行時切替

## 目的と現在地

前回の合成評価（BOXP-344）は完了成果として保全する。ジョブごとのGitOps切替を廃止し、閉じた個人研究評価で新キャラ1名と資料画像1枚まで検証する。本PRはruntime制御の基礎実装と権限判断用の具体案。配備済み・実新キャラ完了とは扱わない。

## 計画

1. 完了: 正本board-pilot.md/board-integration.md、arch #14205/lolice #920以降、専用worktreeと現在のAPI権限を確認。
2. 完了: 指定delegate.pyでterraへ永続phase controllerと合成負例試験を委譲し、親がverifyと試験を確認。
3. 完了: 親が明示credentialを使う条件付きKubernetes transport、部分更新失敗の負例試験、必要な最小権限/所有契約案を追加。
4. 実施: 独立コードレビュー・CI・PR作成。新RBACを無断で付与しない。
5. 未実施: Ownerの最小権限判断後、専用実行主体とcredential配送、Argo所有契約・全入口readback callback、再起動node leaseの実装/統合。通常Boardの汎用画像job/参照契約と公平性上限を完成する。
6. 未実施: 独立レビュー・CI・merge後、一度の恒久GitOps配備。Git操作なしの切替・復帰と段階別時刻を実測。
7. 未実施: 通常localllm依頼から原典をlocalだけで参照し、新キャラ設定・brief・必要な実画像referenceを入力した約1MP Turbo画像1枚を新規pathへ配置。本文をcloudで読まず、ReviewはOwnerが内容を判断する。
8. 未実施: Gemma既定/全入口復帰、外送信なし、原文非変更と生成metadataを確認しvault owner-summaryへ記録。

## 方式

既存admissionはEnvoyの受付gate。K8s AdmissionWebhookではない。Webhook新設だけではinflight drain・GPU解放・復帰を実行できない。既存の全入口gate/arbiter + 小さな専用workerを選ぶ。同一GPU所有Pod内でのruntime管理ならAPI scale権限を避けられるが、llama/Qwenイメージ・volume・process lifecycle・probeを再編する必要があり、現構成からの変更が大きい。新operator/CRDは作らない。

Kubernetesの複数objectに跨る原子更新は仮定しない。node lease下で全体snapshotを照合し、各更新にUID/resourceVersion/旧値のtestを付ける。復帰はgate=verifyを先にし、その後Gemma=1。途中失敗はpendingを維持し、再送しない。非協調管理者/旧GitOps切替が並行実行されない所有境界は配備時に整える必要がある。

## 判断と未確認

新権限案は [runtime-authorization.yaml](runtime-authorization.yaml)、Argo設定案は [argo-ownership.patch.yaml](argo-ownership.patch.yaml)。両方ともdocs内の未配備案で、kustomizationから参照しない。

現主体の `patch deployments/scale -n local-llm` と `patch configmaps/llama-server-admission -n local-llm` はno。新権限未承認はfake試験停止の理由にはしない。実配備の判断だけ保留する。Ownerへの一判断は「この専用SAへの限定権限と、3フィールドのみのruntime所有を承認するか」。代案はAPI権限を増やさず同一GPU所有Podへ再編する方式で、その場合は別途Pod/process管理実装が必要。

現コードのmax_windowは新しい生成dispatchの開始上限であり、稼働中生成の強制中断や厳密な文章starvation上限ではない。既存LiveAdapterの一回限りnode marker、固定合成2件の制約、通常Board未接続、長文/streaming中の実機試験も未解決。権限承認だけで本票完了とはしない。

## 初期化と権限上の限界

初回配備・resource再作成に備え、Gitの受付初期値をclosed:runtime-bootstrap、Qwenを0にする変更が必要（未適用）。readbackだけで作成前の安全を保証しない。既存gate open値のままignoreだけ配備しない。

Scaleのread-only実APIでUID/resourceVersionを確認した。replicas=0はspecから省略されるため、transportはScaleのspec全体に旧値test/replaceを行う。実APIのpatchは未試験。RBACはConfigMap内のfieldを限定できず、受付専用ConfigMapのnameに制限する。credential配送・runnerから独立したworkerの配置も未完了。

公式資料: [Argo差分除外](https://argo-cd.readthedocs.io/en/stable/user-guide/diffing/)、[同期時RespectIgnoreDifferencesと初回作成の制約](https://argo-cd.readthedocs.io/en/stable/user-guide/sync-options/)、[RBAC resourceNames/subresource](https://kubernetes.io/docs/reference/access-authn-authz/rbac/)。差分検知の除外だけでは同期時の所有分離にならないため、対象名付き除外と同期オプションを組み合わせる。

## rollback

本PRは有効なクラスタ構成を変更しない。配備後に戻すときはQwen停止/Pod消失/GPU FD空→Gemma起動/health/固定短文推論→受付openを確認してから、Git側をGemma=1/Qwen=0/open:<復帰確認token>へ整合する通常PRを先に用意し、その値の確認とともにArgoの3フィールド所有をGitへ戻す。途中の所有除外削除やopenへの単純revertはしない。結果不明jobの再生成、強制kill、lock/marker削除、model/PVC削除は禁止。
