# BOXP-718: 不要な Gemini API キーの撤去

## 背景
BOXP-704 で Gemini API キーが漏出した可能性がある。Gemini は agy subscription でまかなえるため、
Owner はキーを発行元で失効し、SSM パラメータごと消すことを承認した。Grafana キーは今回変更しない。

## 変更
- boxp/lolice: codex-workspace の 5 コンテナから `GEMINI_API_KEY` env を削除し、
  ExternalSecret `codex-workspace-gemini`（`/lolice/codex-workspace/gemini-api-key` を参照）を削除。
  README と langfuse chainsaw fixture（秘密値の漏れ検査は Grafana の合成値で継続）を追従。
- boxp/arch: `terraform/aws/codex-workspace/ssm.tf` の `aws_ssm_parameter.gemini_api_key` を削除
  （tfaction apply で SSM パラメータが消える）。`docker/codex-workspace/entrypoint.sh` の
  session env / runuser whitelist から `GEMINI_API_KEY` を削除。
- 残すもの: runner が agent 起動時に `GEMINI_API_KEY` 等を取り除く denylist（安全側の防御）、
  Grafana キー、agy 認証、Google OAuth、Gemini 前払い残高の dashboard（BOXP-463、キーとは独立）。

## 順序
1. lolice PR を merge → Argo sync で Pod から参照が消え、ExternalSecret と Secret が消える。
2. arch PR を merge → tfaction apply で SSM パラメータ削除。image 再ビルドで entrypoint も反映。
3. 発行元（Google AI Studio / Cloud Console の project 589733646023）でのキー削除は Owner の操作。
   担当は GCP の権限を持たない。削除後に無課金の models.list が 400/403 になることで確認する。

## 確認
- `aws ssm get-parameter` 相当（tfaction apply の結果）でパラメータが無いこと。
- `kubectl get externalsecret,secret -n codex-workspace` に gemini が無いこと、Pod env に無いこと。

仕様先行・Lean は対象外（設定と資格情報の撤去のみで、状態遷移の規則が無い）。
