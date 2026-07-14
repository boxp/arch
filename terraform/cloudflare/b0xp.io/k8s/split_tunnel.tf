resource "cloudflare_zero_trust_split_tunnel" "warp_include" {
  account_id = var.account_id
  mode       = "include"

  tunnels {
    address     = "192.168.10.99/32"
    description = "cluster VIP (keepalived)"
  }
  tunnels {
    address     = "192.168.10.98/32"
    description = "codex-workspace VIP (MetalLB)"
  }
  tunnels {
    address     = "192.168.10.102/32"
    description = "shanghai-1 control plane node"
  }
  tunnels {
    address     = "192.168.10.103/32"
    description = "shanghai-2 control plane node"
  }
  tunnels {
    address     = "192.168.10.104/32"
    description = "shanghai-3 control plane node"
  }
  tunnels {
    address     = "192.168.10.101/32"
    description = "golyat-1 worker node"
  }
  tunnels {
    address     = "192.168.10.105/32"
    description = "golyat-2 worker node"
  }
  tunnels {
    address     = "192.168.10.106/32"
    description = "golyat-3 worker node"
  }
  tunnels {
    address     = "192.168.10.107/32"
    description = "golyat-4 worker node"
  }
}

import {
  to = cloudflare_zero_trust_split_tunnel.warp_include
  id = "${var.account_id}/include"
}
