# BOXP-113 実装計画

## 目的

Lolice cluster の amd64 worker 上に actions-runner-controller (ARC) を導入し、
`boxp/arch` の Ansible CI を self-hosted runner で実行できるようにする。

## 実施内容

1. `k8s/arc` に namespace、ARC controller / runner scale set の Helmfile、認証
   Secret 作成手順のテンプレートを追加する。
2. Ansible の apply、plan、test ジョブだけを Linux/x64 self-hosted runner に
   切り替え、PR コメントジョブは GitHub-hosted runner に残す。
3. デプロイ、認証、フォールバック、リソース・スケーリング運用を文書化する。
4. YAML とワークフローを検証し、変更をコミットして origin へ push する。
