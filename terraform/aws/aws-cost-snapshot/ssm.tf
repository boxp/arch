resource "aws_ssm_parameter" "snapshot" {
  for_each = toset(["summary", "services", "daily", "status", "s3_usage"])

  name  = "/lolice/aws-cost/${each.key}"
  type  = "SecureString"
  value = jsonencode({ schema = "aws-cost/v1-draft", state = "uninitialized" })

  tags = {
    Project = "lolice"
    Purpose = "aws-cost-snapshot"
  }

  lifecycle {
    ignore_changes = [value]
  }
}
