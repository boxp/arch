# IAM User for Cursor with read-only access to the entire AWS account
resource "aws_iam_user" "cursor_readonly" {
  name = "cursor-readonly"
  path = "/"
}

# Attach the AWS managed ReadOnlyAccess policy to the Cursor user
resource "aws_iam_user_policy_attachment" "cursor_readonly_policy" {
  user       = aws_iam_user.cursor_readonly.name
  policy_arn = "arn:aws:iam::aws:policy/ReadOnlyAccess"
}