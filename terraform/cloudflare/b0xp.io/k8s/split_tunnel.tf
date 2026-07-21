resource "cloudflare_zero_trust_device_default_profile" "warp_include" {
  account_id = var.account_id

  lifecycle {
    ignore_changes = [exclude, dns_search_suffixes]
  }

  include = [
    {
      address     = "192.168.10.29/32"
      description = "ark asa"
    },
    {
      address     = "192.168.10.30/32"
      description = "minecraft"
    },
    {
      address     = "192.168.10.31/32"
      description = "starRupture"
    },
    {
      address     = "192.168.10.88/32"
      description = "Grafana"
    },
    {
      address     = "192.168.10.95/32"
      description = "llama-server"
    },
    {
      address     = "192.168.10.96/32"
      description = "Kubernetes Dashboard"
    },
    {
      address     = "192.168.10.97/32"
      description = "palserver"
    },
    {
      address     = "192.168.10.98/32"
      description = "argocd"
    },
    {
      address     = "192.168.10.99/32"
      description = "lolice"
    },
    {
      address     = "192.168.10.100/32"
      description = "Ooedo"
    },
    {
      address     = "192.168.10.101/32"
      description = "golyat-1"
    },
    {
      address     = "192.168.10.102/32"
      description = "shanghai-1"
    },
    {
      address     = "192.168.10.103/32"
      description = "shanghai-2"
    },
    {
      address     = "192.168.10.104/32"
      description = "shanghai-3"
    },
    {
      address     = "192.168.10.105/32"
      description = "golyat-2"
    },
    {
      address     = "192.168.10.107/32"
      description = "golyat-4"
    },
    {
      address     = "192.168.10.108/32"
      description = "palserver-2"
    },
  ]
}

import {
  to = cloudflare_zero_trust_device_default_profile.warp_include
  id = var.account_id
}
