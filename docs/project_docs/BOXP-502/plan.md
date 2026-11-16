# BOXP-502: sd-webui.b0xp.io の Access を本人限定にする

## 背景
BOXP-498 で Owner が承認した案A。`sd-webui.b0xp.io` の Access policy は `include = login_method(GitHub IdP)` のみで、GitHub でログインした全員を許可する定義だった。

## 変更
- `terraform/cloudflare/b0xp.io/stable-diffusion/access.tf`
  - `stable_diffusion_access` policy を `comfyui_owner` と同型（既存の本人メール値を include、GitHub IdP を require）へ in-place 更新。
  - 本人メール値は既存の正規値（`comfyui_owner_emails`）を `owner_emails` へ改名して共有。値は不変・推測なし。
- application / policy の ID、ComfyUI policy の実体、tunnel / DNS、他アプリは変更しない。新 IdP / token / Secret なし。

## 検証
1. PR CI（fmt/validate/tflint/conftest/trivy）と tfaction plan で、差分が `stable_diffusion_access` の update in-place 1件のみであることを確認。
2. merge 後 tfaction apply の成功を確認。
3. 実効 policy を非秘密 metadata（include/require の種別）で読み戻し、GitHub 全員 allow / bypass が残らないことを確認。
4. 未認証アクセス（ルート / API / WebSocket パス）が Access のログインへリダイレクトされることを確認。302 のみで本人限定とは判定しない。
5. 他アカウントでの拒否・本人ログイン成功は実アカウントがないため未試験として明示。既存 session（session_duration 24h）の影響を記録。

## Rollback
PR revert → tfaction apply で旧 policy（GitHub login_method include）に戻る。
