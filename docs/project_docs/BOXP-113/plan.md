# BOXP-113 実装計画

## 目的

Lolice cluster の amd64 worker 上に actions-runner-controller (ARC) を導入し、
`boxp/arch` の Ansible CI を self-hosted runner で実行できるようにする。

## スコープ分担

ARC の実際のデプロイ（Helmfile・namespace・Secret）は **boxp/lolice** リポジトリで
ArgoCD により管理する（ユーザー方針）。本 PR（boxp/arch）のスコープは以下のみ。

## 実施内容

### フェーズ1（このPR）— arch 側の設定・文書化

1. **actionlint 設定**: `.actionlint.yaml` に `arc-runners` をカスタム self-hosted runner
   ラベルとして登録し、ワークフロー lint が false positive を出さないようにする。
2. **運用ドキュメント**: `docs/arc/README.md` に ARC の概要・認証方式・デプロイ手順
   （boxp/lolice 側）・Ansible CI 切り替え方針・フォールバック戦略を文書化する。

> **ARC 本体の実装について**: namespace・Helmfile・Secret の作成は boxp/lolice の
> ArgoCD 管理下で行う。arch 側には Helm ファイルを置かない。

> **ワークフロー変更はこのPRに含まない**: `apply-ansible.yml` 等の `runs-on` 変更は
> ARC 稼働確認後の別 PR で実施する。runner が未配備の状態で変更すると CI が永久に
> pending になるためフェーズ分割を採用する。

### フェーズ2（ARC デプロイ後・別 PR）

ARC が Lolice クラスタ上に実際にデプロイされ self-hosted runner が稼働確認できたら:

1. `apply-ansible.yml` / `plan-ansible.yml` / `test-ansible.yml` の `runs-on` を
   `arc-runners` へ切り替える（別 PR）。
2. 動作確認・速度比較を行い、フォールバック戦略を最終決定する。
