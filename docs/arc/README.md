# ARC (actions-runner-controller) on Lolice Cluster

## 概要

actions-runner-controller (ARC) は、Kubernetes 上で GitHub Actions の
self-hosted runner をオンデマンドに管理するコントローラーです。Lolice cluster
の amd64 worker に runner を配置することで、`boxp/arch` の Ansible CI を
高速化し、private repository で発生しやすい GitHub-hosted runner の rate limit
問題を解消します。

## 前提条件

デプロイを行う端末に、対象クラスタへ接続できる `kubectl`、`helm`、`helmfile`
をインストールしてください。OCI chart を取得できるよう、GitHub Container
Registry へアクセスできることも必要です。

## デプロイ手順

1. namespace を作成します。

   ```sh
   kubectl apply -f k8s/arc/namespace.yaml
   ```

2. GitHub App を作成します。GitHub の **Settings > Developer Settings > GitHub
   Apps** から作成し、`boxp/arch` にインストールします。Repository permissions
   では **Actions: Read and write** と **Administration: Read and write** を付与
   してください。

3. GitHub App の認証情報を Secret として作成します。GitHub App 認証を推奨し、
   実行例は [`k8s/arc/secret-template.yaml`](../../k8s/arc/secret-template.yaml)
   のコメントを参照してください。PAT 認証を使用する場合の例も同ファイルにあり
   ます。Secret 名は `arc-github-secret`、namespace は `arc-runners` です。

4. Helmfile を適用します。

   ```sh
   helmfile -f k8s/arc/helmfile.yaml apply
   ```

## ワークフローの設定

Ansible の実行ジョブは `runs-on: [self-hosted, linux, x64]` を指定します。ARC が
登録する Linux/x64 runner のみが対象となり、amd64 worker 上で実行されます。
PR コメントを投稿する `plan-ansible` の `comment` ジョブは GitHub-hosted runner
（`ubuntu-latest`）のままです。

## フォールバック戦略

self-hosted runner が停止してジョブを実行できない場合は、対象ワークフローの
`runs-on: [self-hosted, linux, x64]` を一時的に `runs-on: ubuntu-latest` へ戻し、
変更を commit・push します。ARC 復旧後に self-hosted 指定へ戻してください。

## 運用上の注意

- runner は CPU 500m / メモリ 512Mi を要求し、CPU 4 / メモリ 8Gi を上限とします。
  worker の空き容量と他ワークロードへの影響を監視してください。
- `minRunners: 1` により常時 1 runner を確保し、`maxRunners: 4` まで自動的に
  スケールします。キューの滞留や worker の資源状況に応じて見直してください。
- GitHub App の秘密鍵・PAT は Git に保存せず、`arc-runners` namespace の Secret
  として安全に管理・定期ローテーションしてください。
