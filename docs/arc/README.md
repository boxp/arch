# ARC (actions-runner-controller) on Lolice Cluster

## 概要

actions-runner-controller (ARC) は、Kubernetes 上で GitHub Actions の
self-hosted runner をオンデマンドに管理するコントローラーです。Lolice cluster
の amd64 worker に runner を配置することで、`boxp/arch` の Ansible CI を
高速化し、private repository で発生しやすい GitHub-hosted runner の rate limit
問題を解消します。

## デプロイ方針

ARC のインストール・設定は **`boxp/lolice` リポジトリの ArgoCD** で管理します。
Helm chart の設定は `lolice` 側で ArgoCD Application として定義してください。

runner scale set の Helm リリース名は `arc-runners` を使用します。これにより
ワークフローの `runs-on: arc-runners` が runner を正しく選択できます。

## GitHub App の設定

1. GitHub の **Settings > Developer Settings > GitHub Apps** から GitHub App を作成します。
2. `boxp/arch` など対象リポジトリにインストールします。
3. Repository permissions で **Actions: Read and write** と
   **Administration: Read and write** を付与してください。
4. GitHub App の秘密鍵を `arc-runners` namespace の `arc-github-secret` Secret として
   Lolice クラスタに登録します（詳細は lolice の ArgoCD Application 定義を参照）。

## ワークフローの設定

Ansible の実行ジョブは `runs-on: arc-runners` を指定します。ARC runner scale set
はデフォルトで Helm リリース名（`arc-runners`）をラベルとして使用するため、
`[self-hosted, linux, x64]` ではなく `arc-runners` を指定する必要があります。
PR コメントを投稿する `plan-ansible` の `comment` ジョブは GitHub-hosted runner
（`ubuntu-latest`）のままです。

## フォールバック戦略

self-hosted runner が停止してジョブを実行できない場合は、対象ワークフローの
`runs-on: arc-runners` を一時的に `runs-on: ubuntu-latest` へ戻し、
変更を commit・push します。ARC 復旧後に self-hosted 指定へ戻してください。

## 運用上の注意

- runner は CPU 500m / メモリ 512Mi を要求し、CPU 4 / メモリ 8Gi を上限とします。
  worker の空き容量と他ワークロードへの影響を監視してください。
- `minRunners: 1` により常時 1 runner を確保し、`maxRunners: 4` まで自動的に
  スケールします。キューの滞留や worker の資源状況に応じて見直してください。
- GitHub App の秘密鍵・PAT は Git に保存せず、`arc-runners` namespace の Secret
  として安全に管理・定期ローテーションしてください。
