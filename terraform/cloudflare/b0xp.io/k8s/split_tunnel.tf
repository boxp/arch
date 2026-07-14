resource "cloudflare_zero_trust_split_tunnel" "warp_include" {
  account_id = var.account_id
  mode       = "include"

  lifecycle {
    ignore_changes = [policy_id]
  }

  tunnels {
    address     = "192.168.10.29/32"
    description = "ark asa"
  }
  tunnels {
    address     = "192.168.10.30/32"
    description = "minecraft"
  }
  tunnels {
    address     = "192.168.10.31/32"
    description = "starRupture"
  }
  tunnels {
    address     = "192.168.10.95/32"
    description = "llama-server"
  }
  tunnels {
    address     = "192.168.10.97/32"
    description = "palserver"
  }
  tunnels {
    address     = "192.168.10.98/32"
    description = "argocd"
  }
  tunnels {
    address     = "192.168.10.99/32"
    description = "lolice"
  }
  tunnels {
    address     = "192.168.10.100/32"
    description = "Ooedo"
  }
  tunnels {
    address     = "192.168.10.101/32"
    description = "golyat-1"
  }
  tunnels {
    address     = "192.168.10.102/32"
    description = "shanghai-1"
  }
  tunnels {
    address     = "192.168.10.103/32"
    description = "shanghai-2"
  }
  tunnels {
    address     = "192.168.10.104/32"
    description = "shanghai-3"
  }
  tunnels {
    address     = "192.168.10.105/32"
    description = "golyat-2"
  }
  tunnels {
    address     = "192.168.10.107/32"
    description = "golyat-4"
  }
  tunnels {
    address     = "192.168.10.108/32"
    description = "palserver-2"
  }
}

import {
  to = cloudflare_zero_trust_split_tunnel.warp_include
  id = "${var.account_id}/default/include"
}
