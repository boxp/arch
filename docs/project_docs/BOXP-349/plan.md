# BOXP-349 実行時LLM/画像切替

2026-10-28 継続run。Ownerは専用SAの限定権限と名指しArgo3field移管を承認済み。同じ承認は再要求しない。

## 実装と判断

既存admissionはEnvoy受付gateでありK8s AdmissionWebhookではない。既存gate/slots/active/pending/node lease/GPU FD/固定復帰probeを再利用する専用workerを選ぶ。同一GPU Pod内process管理はイメージ/volume/ライフサイクルの再編が大きいため採らない。新operator/CRDは作らない。

GitOpsは恒久権限・Pod・安全境界を管理し、ジョブの切替にはGit commit/PR/Argo同期を使わない。SQLiteに各phase意図を先に記録、UID/resourceVersion/旧値test付き更新を行い、結果不明は再送せず観測のみで照合する。restore時はverify gate→Gemma起動→固定短文推論→open。複数objectの原子性は仮定しない。

専用SA credentialはlolice専用Podのprojected tokenに留める。通常runnerには渡さず、既存SSH/node file経路で制御metadataだけを送る。transportは2 named Scale/1 named ConfigMapのGET/条件付きPATCHだけを受理し、実行intentの永続化後は未知結果を再送しない。workerはmodel/PVC/作品/workspace/外部API keyをmountしない。必要な限定RBACはOwner承認済み。node uid1000の制御directoryを信頼する。

Argoは名指し3fieldのみignore+RespectIgnoreDifferences、自動selfHeal/pruneは維持。親子Appの独立同期に対応し、所有移管のreadback後に再作成用closed初期値を別PRで反映する。旧GPU GitOps workflowは既存GitHub APIでdisabled_manuallyを確認した（OAuth workflow scope不足につきworkflowファイル変更は含めない）。

## 手順と進捗

1. 完了: 正本board-pilot/board-integration、arch #14205/lolice #920以降、Owner承認と現在状態を実読取。BOXP-344成果は保全。
2. 完了: 指定delegate.pyでterraにrestart lease/worker基礎等を委譲しverify。親がtransportと通常Board audit連携/実reference入力/非上書き公開を統合、合成負例試験と独立レビューを実施。
3. 完了: lolice #930 CI/独立レビュー後merge、専用Pod1/1/実Scale GET/両App所有分担をreadback。#932で再作成用closed初期値を反映する。
4. 実施中: arch独立再レビュー/通常PR更新/CI/merge。
5. 実施中: 通常localllm依頼BOXP-350で新キャラ1名を必要な原典参照から通常フォルダへ新規作成。cloudは本文/画像を読まない。
6. 未実施: normal Boardの新規作成auditを確認し、local Gemmaで画像brief/必要な実参照選択→新runtime workerで約1MP Turbo画像1枚→新資料ノートから設定/画像/metadataをリンク。
7. 未実施: Git操作なし切替/各段階実測、Gemma既定/全入口受付復帰、外送信なし/既存素材不変/未確認/rollbackをvault owner-summaryに記録しOwner Review。

## 限界を誤魔化さない

新規dispatchは最大2枚/1800秒、完了後は次windowまで文章受付120秒以上を確保する。これは生成中の強制打切りや復帰障害を含む厳密なstarvation上限ではない。timeout/lease喪失/未知jobはfail closedにし、強制kill/lock解除/無断再生成は行わない。再起動CLIは同一boot・同一tokenの未完了leaseを再取得し観測のみでreconcileする。node rebootや部分書込/結果不明の自動復旧・連続queueの長期公平性は未実証。常設無制限制作を有効化するPRではない。

通常Boardのcreate audit（created=true/before hashなし/after hash一致）を画像manifestの前提とし、既存キャラへの任意追記を拒否。画像公開で設定本文を書き換えず、新規資料ノートに設定/画像/metadataをリンクし、Obsidian側の非協調編集を上書きしない。原典/私的本文/実画像はlocalのみ、既存作画資料があれば実画像をQwen refとして投入。外部API fallback/全vaultコピーは行わない。

## rollback

Qwen停止/Pod消失/GPU FD空→Gemma起動/health/固定短文推論→受付openを確認してから、Gitの3値を復帰実状態に合わせる通常PRとともにfield所有をGitへ戻す。途中でignoreだけ削除したりgateだけopenへ戻さない。model/PVC/成果画像/既存作品/lockは削除しない。旧workflowも所有契約を戻すまで再有効化しない。
