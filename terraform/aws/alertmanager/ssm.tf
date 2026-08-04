# Alertmanager のメール通知に使うシークレット。
#
# 2026-08-01 に shanghai-1 がハングした際、ControlPlaneNodeNotReady (critical) は
# 死亡の約10分後に発火して3日間鳴り続けていたが、Alertmanager の receiver が
# すべて名前だけで通知設定を持っていなかったため誰にも届かなかった。
# 詳細: docs/project_docs/shanghai-node-resilience/plan.md
#
# 値はダミーで作成し、実値は手動で更新する (このリポジトリの他の SecureString と同じ方式)。
# 参照側: boxp/lolice の argoproj/prometheus-operator/external-secret-alertmanager.yaml

# Resend の API キー。SMTP のパスワードとして使う (ユーザ名は固定で "resend")。
resource "aws_ssm_parameter" "resend_api_key" {
  name        = "/lolice/alertmanager/RESEND_API_KEY"
  description = "Resend API key used as the SMTP password for Alertmanager email notifications"
  type        = "SecureString"
  value       = "dummy-value-to-be-updated-manually"
  lifecycle {
    ignore_changes = [value]
  }
}

# 通知先メールアドレス。個人のアドレスを public リポジトリに置かないため SSM 経由で渡す。
resource "aws_ssm_parameter" "alert_email_to" {
  name        = "/lolice/alertmanager/ALERT_EMAIL_TO"
  description = "Destination address for critical Alertmanager notifications"
  type        = "SecureString"
  value       = "dummy-value-to-be-updated-manually"
  lifecycle {
    ignore_changes = [value]
  }
}

# 送信元アドレス。Resend で検証済みのドメインである必要がある。
resource "aws_ssm_parameter" "alert_email_from" {
  name        = "/lolice/alertmanager/ALERT_EMAIL_FROM"
  description = "From address for Alertmanager email notifications (must be a Resend-verified domain)"
  type        = "SecureString"
  value       = "dummy-value-to-be-updated-manually"
  lifecycle {
    ignore_changes = [value]
  }
}
