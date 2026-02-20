# migration "state" "rm_r2_bucket" {
#   actions = [
#     "mv aws_security_group.foo aws_security_group.foo2",
#     "import aws_security_group.foo foo",
#   ]
# }

# migration "multi_state" "rm_r2_bucket" {
#   from_dir = "../foo"
#   to_dir   = "."
#   actions = [
#     "mv aws_security_group.foo aws_security_group.foo2",
#   ]
# }
