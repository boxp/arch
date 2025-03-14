# IAM User for Cursor with read-only access to the entire AWS account
resource "aws_iam_user" "cursor_readonly" {
  name = "cursor-readonly"
  path = "/"
}

# Create access key for the Cursor user
resource "aws_iam_access_key" "cursor_readonly" {
  user = aws_iam_user.cursor_readonly.name
}

# Attach the AWS managed ReadOnlyAccess policy to the Cursor user
resource "aws_iam_user_policy_attachment" "cursor_readonly_policy" {
  user       = aws_iam_user.cursor_readonly.name
  policy_arn = "arn:aws:iam::aws:policy/ReadOnlyAccess"
}

# Output the access key and secret key (sensitive)
output "cursor_readonly_access_key" {
  value = aws_iam_access_key.cursor_readonly.id
}

output "cursor_readonly_secret_key" {
  value     = aws_iam_access_key.cursor_readonly.secret
  sensitive = true
}