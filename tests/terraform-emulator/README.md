# Terraform AWS Emulator テスト

longhorn の制御プレーン構成を隔離した AWS Emulator に apply し、期待値・冪等性・ドリフト検知・不正な設定の検知・復元・削除を検証する。

```bash
tests/terraform-emulator/run.sh longhorn [--base-ref origin/main]
```

Docker、curl、gpg/gpgv が必要。`TMPDIR` と `TF_EMULATOR_CACHE_DIR` で一時ディレクトリと RPM キャッシュを指定できる。base ref の対象が存在する場合は旧設定から現設定への更新も検証する。

実 AWS 認証情報が環境にある場合は拒否し、エミュレーターの認証情報だけを使う。実 state/backend は使わず、ローカル state を Docker ボリュームに置く。apply 時は内部ネットワークで外部 AWS への名前解決を確認し、テレメトリーを無効化する。init のみプロバイダー取得のためオンラインで実行する。

AWS provider v6 の S3 Control ListTagsForResource はアカウント ID のホスト接頭辞を使用し、エミュレーターに到達できない。provider override でアカウント ID の取得を省略すると S3 GetBucketTagging にフォールバックする。override は backend/provider の接続設定のみを変更し、リソースは変更しない。

IAM ポリシーの評価、SCP、実際のクォータ、S3 Control/tag API 経路、リージョン分離、アカウント ID に基づく ARN、データプレーンの忠実性は保証しない。

AWS Emulator の LTS RPM は AWS 配布物を署名検証して使用する。プロジェクトは CC0-1.0、vendor 部分は Apache-2.0。バージョンは `emulator.env` に固定し、Renovate が週次で更新する。AWS CLI と Terraform も Renovate の更新に追従する。

別ターゲット追加時は `targets/<target>/` に独立した期待値の `verify.sh`、`drift.sh`、`red-mutation.tf`、`verify-destroyed.sh` を作り、対象の aqua Terraform バージョンとロックファイルを用意する。接続設定以外の override が必要な構成は安全性を別途確認する。

ドリフト・不正設定の負例には公開アクセス遮断と IAM ポリシーを使う。現行ロックの provider 6.59.0 では、バージョニングのドリフト復元時に MFA Delete を送信し、エミュレーターが MFA ヘッダーを要求するため、この復元経路は対象外とする。
