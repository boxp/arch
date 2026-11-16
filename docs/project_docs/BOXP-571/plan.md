# BOXP-571: Terraform の隔離 apply テスト

## 目的と対象
longhorn を AWS Emulator で実際に apply し、期待する構成、変更検知、復元と削除を検証する。S3 バケット、バージョニング、公開遮断、暗号化、IAM ユーザー・インラインポリシー・アクセスキー、SSM SecureString はエミュレーターの制御プレーン API で扱える。他の AWS ディレクトリの ECR・OIDC 等は今回の対象外。

## 設計と安全境界
署名と鍵指紋を検証した RPM からコンテナを作る。設定を Docker ボリュームに複製し、local backend と接続先のみ override する。init は別ネットワーク、apply 等は外部アクセス不能な内部ネットワークで実行し、AWS 宛先の名前解決とアカウント ID を確認する。実 AWS の認証情報、state、backend は使用せず、テレメトリーを無効化する。ボリューム等は終了時に削除する。

## 保証しないこと
IAM ポリシー評価、SCP、実際のクォータ、S3 Control/tag API 経路、リージョン分離、アカウント ID を含む ARN、データプレーンの忠実性は保証しない。

## 検証計画
base からの更新、apply 後の独立した期待値検査、再 plan の無変更、外部変更の検知と復元、意図的な設定変更の検査失敗と復元、destroy 後の消滅を確認する。構文・静的検査と実行時の意図的な失敗も検証する。

## 依存と追従
- AWS Emulator 1.0.385（downloads.aws.com の LTS 版付き RPM、鍵指紋 `98BCF336A3BE53B734E967C52E5BF49BD940F624` で署名検証）。CC0-1.0（vendor/ は Apache-2.0）。テレメトリーは `EMULATOR_TELEMETRY=off` と `--telemetry off` で無効化し、起動ログの `telemetry: disabled` を検査する。
- Terraform は対象ディレクトリの aqua 設定、provider は対象の `.terraform.lock.hcl`（readonly）に従う。Emulator と AWS CLI イメージは Renovate で追従（Emulator は高頻度リリースのため週次）。

## ローカル実測（参考、CI 実測は PR で確認）
| phase | 秒 |
| --- | ---: |
| build（RPM キャッシュあり） | 2 |
| isolation | 3 |
| init | 24 |
| update（base → head） | 47 |
| green | 21 |
| red-drift | 23 |
| red-mutation | 33 |
| destroy | 7 |

自己検査: drift.sh を無操作にすると `Expected drift exit 2, got 0` で失敗、verify.sh の期待値を誤らせると GREEN で失敗することを確認した。
