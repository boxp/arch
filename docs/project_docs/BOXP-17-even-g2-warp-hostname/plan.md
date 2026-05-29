# BOXP-17: Even G2 WARP private hostname

## Goal

`boxp/even-g2-lab` の main branch app を、Cloudflare WARP 接続中の端末からだけ到達できる hostname として公開する。

## Design

- ECR repository: `even-g2-client-main`
- GitHub Actions role: `even-g2-lab-main-gha-role`
- Hostname: `even-g2-main.b0xp.io`
- Cloudflare DNS: proxied CNAME `even-g2-main -> <k8s tunnel cname>`
- Cloudflare Tunnel: existing k8s tunnel with `warp_routing.enabled = true`
- Tunnel ingress: `even-g2-main.b0xp.io -> http://even-g2-main.even-g2-lab.svc.cluster.local:80`

## Tasks

- [x] Add ECR repository and lifecycle policy.
- [x] Add GitHub Actions OIDC role scoped to `boxp/even-g2-lab` main.
- [x] Add proxied tunnel hostname record.
- [x] Add tunnel ingress rule for the Kubernetes service DNS name.
- [ ] Run terraform fmt.
- [ ] Run targeted terraform init/validate where practical.
- [ ] After apply, confirm `even-g2-main.b0xp.io` reaches the service through the k8s `cloudflared` connector.

## Verification Note

This workspace does not have `terraform`, `tofu`, `kubectl`, or `kustomize` installed. Terraform formatting/validation should run in the arch PR CI.
