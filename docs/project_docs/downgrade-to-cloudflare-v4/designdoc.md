# Cloudflare Provider v4へのダウングレード設計書

## 概要

このドキュメントでは、プロジェクト内で使用されているCloudflare Terraformプロバイダーをv5.0.0からv4.52.0へダウングレードするための詳細な手順を記載します。

## 背景と目的

現在のプロジェクトではCloudflare Provider v5.0.0が使用されていますが、特定の理由によりv4系の最新バージョン（v4.52.0）へのダウングレードが必要となりました。v4.52.0は2024年2月5日にリリースされた、v4系の最終バージョンです。

## 対象範囲

### terraform/cloudflare ディレクトリ配下
- terraform/cloudflare/boxp.tk
- terraform/cloudflare/boxp.tk/portfolio
- terraform/cloudflare/boxp.tk/hitohub/prod
- terraform/cloudflare/boxp.tk/hitohub/stage
- terraform/cloudflare/b0xp.io/k8s
- terraform/cloudflare/b0xp.io/portfolio
- terraform/cloudflare/b0xp.io/prometheus-operator
- terraform/cloudflare/b0xp.io/argocd
- terraform/cloudflare/b0xp.io/longhorn
- terraform/cloudflare/b0xp.io/hitohub/prod
- terraform/cloudflare/b0xp.io/hitohub/stage

### templates ディレクトリ配下
- templates/cloudflare

## 実装手順

### 1. 作業前の準備

### 2. バージョン指定の変更

以下の各ディレクトリのbackend.tfファイル内のrequired_providersブロックを変更します：

#### 2.1 プロジェクトディレクトリの変更

以下の各ディレクトリに対して同じ変更を行います：

```bash
# 以下のスクリプトを実行して一括変更
for dir in terraform/cloudflare/boxp.tk \
           terraform/cloudflare/boxp.tk/portfolio \
           terraform/cloudflare/boxp.tk/hitohub/prod \
           terraform/cloudflare/boxp.tk/hitohub/stage \
           terraform/cloudflare/b0xp.io/k8s \
           terraform/cloudflare/b0xp.io/portfolio \
           terraform/cloudflare/b0xp.io/prometheus-operator \
           terraform/cloudflare/b0xp.io/argocd \
           terraform/cloudflare/b0xp.io/longhorn \
           terraform/cloudflare/b0xp.io/hitohub/prod \
           terraform/cloudflare/b0xp.io/hitohub/stage \
           templates/cloudflare; do
  # backend.tfファイルを編集
  sed -i 's/version = ">= 4"/version = "= 4.52.0"/g' $dir/backend.tf
  echo "Updated $dir/backend.tf"
done
```

各ファイルを個別に確認し、以下のように変更されていることを確認します：

```hcl
required_providers {
  cloudflare = {
    source  = "cloudflare/cloudflare"
    version = "= 4.52.0"
  }
}
```

#### 2.2 テンプレートディレクトリの変更

テンプレートディレクトリも同様に変更します：

```bash
sed -i 's/version = ">= 4"/version = "= 4.52.0"/g' templates/cloudflare/backend.tf
```

### 3. プロバイダーのダウングレード実行

各ディレクトリでTerraformを初期化し、プロバイダーをダウングレードします：

```bash
# 以下のスクリプトを実行して一括処理
for dir in terraform/cloudflare/boxp.tk \
           terraform/cloudflare/boxp.tk/portfolio \
           terraform/cloudflare/boxp.tk/hitohub/prod \
           terraform/cloudflare/boxp.tk/hitohub/stage \
           terraform/cloudflare/b0xp.io/k8s \
           terraform/cloudflare/b0xp.io/portfolio \
           terraform/cloudflare/b0xp.io/prometheus-operator \
           terraform/cloudflare/b0xp.io/argocd \
           terraform/cloudflare/b0xp.io/longhorn \
           terraform/cloudflare/b0xp.io/hitohub/prod \
           terraform/cloudflare/b0xp.io/hitohub/stage; do
  # ディレクトリに移動
  cd $dir
  # Terraformを初期化してプロバイダーをダウングレード
  terraform init -upgrade
  # プロジェクトルートに戻る
  cd -
done
```

## 考慮事項とリスク

1. **互換性の問題**: v5からv4へのダウングレードにより、機能や構成に互換性の問題が発生する可能性があります。
   - **対策**: 各ディレクトリで`terraform plan`を実行して、変更による影響を事前に確認します。

2. **API変更**: Cloudflare APIの変更により、特定の機能が動作しなくなる可能性があります。
   - **対策**: 変更後に機能テストを実施して、すべての機能が期待通りに動作することを確認します。

3. **ステート破損**: バージョン変更によりTerraformステートファイルに互換性の問題が発生する可能性があります。
   - **対策**: 作業前にステートファイルのバックアップを取得しておきます。

## ロールバック手順

ダウングレードに問題が発生した場合は、以下の手順でロールバックします：

1. 変更前にバックアップした.terraform.lock.hclファイルを復元します：
   ```bash
   # バックアップから.terraform.lock.hclファイルを復元
   for file in $(find backup -name ".terraform.lock.hcl"); do
     target_file=${file#backup/}
     cp $file $target_file
   done
   ```

2. バージョン指定を元に戻します：
   ```bash
   # 以下のスクリプトを実行して一括変更
   for dir in terraform/cloudflare/boxp.tk \
              terraform/cloudflare/boxp.tk/portfolio \
              terraform/cloudflare/boxp.tk/hitohub/prod \
              terraform/cloudflare/boxp.tk/hitohub/stage \
              terraform/cloudflare/b0xp.io/k8s \
              terraform/cloudflare/b0xp.io/portfolio \
              terraform/cloudflare/b0xp.io/prometheus-operator \
              terraform/cloudflare/b0xp.io/argocd \
              terraform/cloudflare/b0xp.io/longhorn \
              terraform/cloudflare/b0xp.io/hitohub/prod \
              terraform/cloudflare/b0xp.io/hitohub/stage \
              templates/cloudflare; do
     # backend.tfファイルを編集
     sed -i 's/version = "= 4.52.0"/version = ">= 4"/g' $dir/backend.tf
   done
   ```

3. 各ディレクトリでTerraformを再初期化します：
   ```bash
   for dir in terraform/cloudflare/boxp.tk \
              terraform/cloudflare/boxp.tk/portfolio \
              terraform/cloudflare/boxp.tk/hitohub/prod \
              terraform/cloudflare/boxp.tk/hitohub/stage \
              terraform/cloudflare/b0xp.io/k8s \
              terraform/cloudflare/b0xp.io/portfolio \
              terraform/cloudflare/b0xp.io/prometheus-operator \
              terraform/cloudflare/b0xp.io/argocd \
              terraform/cloudflare/b0xp.io/longhorn \
              terraform/cloudflare/b0xp.io/hitohub/prod \
              terraform/cloudflare/b0xp.io/hitohub/stage; do
     cd $dir
     terraform init -upgrade
     cd -
   done
   ```

## まとめ

このドキュメントでは、Cloudflare Terraformプロバイダーをv5.0.0からv4.52.0へダウングレードするための詳細な手順を記載しました。作業を進める際は、各ステップを慎重に実行し、変更による影響を常に確認しながら進めることが重要です。
