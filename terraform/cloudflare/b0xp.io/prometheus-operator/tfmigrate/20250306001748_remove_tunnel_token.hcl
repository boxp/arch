migration "state" "remove_tunnel_token" {
  actions = [
    "rm aws_ssm_parameter.prometheus_operator_tunnel_token",
  ]
  force = true
} 