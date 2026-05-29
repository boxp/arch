# BOXP-17: Even G2 WARP private hostname

## Goal

`boxp/even-g2-lab` の main branch app を、Cloudflare WARP 接続中の端末からだけ到達できる hostname として公開する。

## Design

- ECR repository: `even-g2-client-main`
- GitHub Actions role: `even-g2-lab-main-gha-role`
- Hostname: `even-g2-main.b0xp.io`
- Private IP: `192.168.10.99`
- Cloudflare DNS: DNS-only A record `even-g2-main -> 192.168.10.99`
- Cloudflare Tunnel: existing k8s tunnel with `warp_routing.enabled = true`
- WARP route: `192.168.10.99/32`

## Tasks

- [x] Add ECR repository and lifecycle policy.
- [x] Add GitHub Actions OIDC role scoped to `boxp/even-g2-lab` main.
- [x] Add DNS-only private hostname record.
- [x] Add WARP tunnel route for the Even G2 main LoadBalancer IP.
- [ ] Run terraform fmt.
- [ ] Run targeted terraform init/validate where practical.
- [ ] After apply, confirm WARP-connected device resolves `even-g2-main.b0xp.io` to `192.168.10.99`.

## Verification Note

This workspace does not have `terraform`, `tofu`, `kubectl`, or `kustomize` installed. Terraform formatting/validation should run in the arch PR CI.
