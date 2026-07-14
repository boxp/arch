# BOXP-113 実装計画

## 目的

Lolice cluster の amd64 worker 上に actions-runner-controller (ARC) を導入し、
`boxp/arch` の Ansible CI を self-hosted runner で実行できるようにする。

## 実施内容

### フェーズ1（このPR）
1. `k8s/arc` に namespace、ARC controller / runner scale set の Helmfile、認証
   Secret 作成手順のテンプレートを追加する。
2. デプロイ、認証、フォールバック、リソース・スケーリング運用を文書化する。

### フェーズ2（ARC デプロイ後）
ARC が Lolice クラスタ上に実際にデプロイされ、self-hosted runner が稼働確認できたら:
1. Ansible の apply、plan、test ジョブを `[self-hosted, linux, x64]` runner に切り替える。
2. 動作確認・速度比較を行い、フォールバック戦略を最終決定する。

> **注意**: ワークフローの `runs-on` をいきなり self-hosted に変更すると、runner が
> デプロイされていない状態では CI が永久に pending になる。そのためフェーズ分割を採用。
